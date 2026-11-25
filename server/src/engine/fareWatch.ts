// "Monitor this fare for me": re-quotes watched routes on a timer and notifies (web + WhatsApp) when it drops.
import { db, uid, convs, messages } from "../db.ts";
import { pushToConv, trace } from "../bus.ts";
import { liveQuote } from "./fares.ts";
import { getFlags } from "../integrations/flags.ts";
import { sendWhatsApp } from "../integrations/whatsapp.ts";
import { cityName, langKey, rupee } from "./i18n.ts";

interface Watch { id: string; conv_id: string; origin: string; dest: string; date: string; base_fare: number; start_fare: number; target: number; last_quote: number; status: string }

export function createWatch(convId: string, origin: string, dest: string, date: string, baseFare: number, currentFare: number, dropPct = 5) {
  db.prepare("UPDATE fare_watches SET status = 'cancelled' WHERE conv_id = ? AND status = 'watching'").run(convId);
  const id = uid();
  const target = Math.round((currentFare * (1 - dropPct / 100)) / 10) * 10;
  db.prepare("INSERT INTO fare_watches (id, conv_id, origin, dest, date, base_fare, start_fare, target, last_quote, created) VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    id, convId, origin, dest, date, baseFare, currentFare, target, currentFare, Date.now(),
  );
  trace("engine", convId, { step: "fare watch", route: `${origin}→${dest}`, date, currentFare, target });
  return getWatch(convId);
}

export const getWatch = (convId: string) =>
  db.prepare("SELECT * FROM fare_watches WHERE conv_id = ? ORDER BY created DESC LIMIT 1").get(convId) as unknown as Watch | undefined;

async function fire(w: Watch, quote: number) {
  db.prepare("UPDATE fare_watches SET status = 'fired', last_quote = ?, fired = ? WHERE id = ?").run(quote, Date.now(), w.id);
  const conv = convs.get(w.conv_id);
  if (!conv) return;
  const l = langKey(conv.lang);
  const save = w.start_fare - quote;
  const text =
    l === "hi"
      ? `📉 किराया गिरा! ${cityName(w.origin, l)} → ${cityName(w.dest, l)} अब ${rupee(quote)} (पहले ${rupee(w.start_fare)}, बचत ${rupee(save)})। अभी बुक करें।`
      : `📉 Price drop! ${cityName(w.origin)} → ${cityName(w.dest)} is now ${rupee(quote)} (was ${rupee(w.start_fare)}, save ${rupee(save)}). Book now.`;
  const card = { type: "fare-alert", origin: w.origin, dest: w.dest, date: w.date, quote, was: w.start_fare, save };
  messages.add(conv.id, "bot", text, { cards: [card], notify: true });
  pushToConv(conv.id, { type: "message", role: "bot", text, payload: { cards: [card], notify: true }, ts: Date.now() });
  trace("engine", conv.id, { step: "fare alert", quote, was: w.start_fare });
  if (conv.whatsapp) await sendWhatsApp(conv.whatsapp, text, null, conv.id);
}

export async function tick() {
  const f = await getFlags("fare-watcher");
  const rows = db.prepare("SELECT * FROM fare_watches WHERE status = 'watching'").all() as unknown as Watch[];
  for (const w of rows) {
    const q = liveQuote(w.base_fare, w.date, f.fare_model, `${w.origin}${w.dest}`);
    db.prepare("UPDATE fare_watches SET last_quote = ? WHERE id = ?").run(q, w.id);
    if (q <= w.target) await fire(w, q);
  }
}

/** Judge control: pretend the airline just dropped the fare. */
export async function simulateDrop(convId: string) {
  const w = getWatch(convId);
  if (!w || w.status !== "watching") return false;
  await fire(w, Math.round((w.target * 0.97) / 10) * 10);
  return true;
}

export function startFareWatcher() {
  setInterval(() => tick().catch(() => {}), 30_000);
}
