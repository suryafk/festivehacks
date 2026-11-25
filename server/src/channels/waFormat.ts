// Rich WhatsApp layout for a plan. The web app shows cards; WhatsApp gets the same data as formatted text
// (*bold*, _italic_), split into messages under Twilio's 1,600-character limit.
import { config } from "../config.ts";
import { cityByCode } from "../engine/seed.ts";
import { cityName, fmtTime, rupee } from "../engine/i18n.ts";
import type { Card } from "../engine/conversation.ts";
import type { Itinerary, Leg } from "../engine/planner.ts";
import type { FareAdvice } from "../engine/fares.ts";
import type { Split } from "../engine/pooling.ts";

type L = "en" | "hi";
const MAX = 1500;

const W = {
  en: {
    title: "🪔 *Marg Bandhu · your trip plan*",
    around: "around", flex: (n: number) => (n ? ` (±${n} day${n > 1 ? "s" : ""})` : ""),
    rush: (m: number) => `_Festive rush mode: ${m}-min buffers between legs_`,
    recommended: "✅ *Recommended*", reach: "🏠 Reach", by: "by",
    others: "*Other options*", fastest: "fastest", cheapest: "cheapest",
    live: "live fare", est: "est.", sim: "simulated",
    fareTitle: (r: string) => `✈️ *Should you book ${r} now?*`,
    bestNow: "Best price now", liveSrc: "Google Flights, live", simSrc: "simulated",
    typical: "Typical", googleSays: (lv: string) => `Google says "${lv}"`, expected: "Usually costs",
    drop: "Chance it drops 5%+", inDays: (d: number) => `in ${d} days`,
    pointer: "👉 *Our pointer:*", verdict: { book_now: "Book now", wait: "Wait a little", monitor: "Let us watch it" },
    watchCta: "Reply *WATCH* and I'll message you the moment it drops.",
    cabTitle: (hub: string) => `🚕 *Cab mates from ${hub} airport*`,
    cabCount: (n: number, town: string, at: string) => (n > 0 ? `*${n}* Marg Bandhu${n > 1 ? "s" : ""} landing around ${at}, heading towards ${town}.` : `No one on your route yet; I'll keep watching.`),
    cabFare: (solo: string, share?: string) => `Solo cab ${solo}${share ? ` → shared about *${share}*` : ""}.`,
    poolCta: "Reply *POOL* to find cab mates.",
    replyWith: "*Reply with*", cmds: (pool: boolean) => [pool && "*POOL* cab mates", "*WATCH* fare alerts", "*NEW* new trip"].filter(Boolean).join(" · "),
    link: "🔗 Full plan, fare chart & map:",
    matched: "🎉 *Your shared cab is confirmed*", leaves: "Leaves", total: "total", you: "You", pays: "pays", saves: "saves",
    splitNote: "_Fair split: each stretch of road is shared by whoever is still in the cab._",
  },
  hi: {
    title: "🪔 *मार्ग बंधु · आपकी यात्रा का प्लान*",
    around: "के आसपास", flex: (n: number) => (n ? ` (±${n} दिन)` : ""),
    rush: (m: number) => `_त्योहार की भीड़ मोड: हर बदलाव के बीच ${m} मिनट का समय_`,
    recommended: "✅ *सबसे अच्छा विकल्प*", reach: "🏠 पहुँचें", by: "तक",
    others: "*दूसरे विकल्प*", fastest: "सबसे तेज़", cheapest: "सबसे सस्ता",
    live: "लाइव किराया", est: "अनुमान", sim: "सिम्युलेटेड",
    fareTitle: (r: string) => `✈️ *क्या ${r} की टिकट अभी बुक करें?*`,
    bestNow: "अभी सबसे कम किराया", liveSrc: "Google Flights, लाइव", simSrc: "सिम्युलेटेड",
    typical: "आमतौर पर", googleSays: (lv: string) => `Google: "${lv}"`, expected: "आमतौर पर किराया",
    drop: "5%+ गिरने की संभावना", inDays: (d: number) => `${d} दिन में`,
    pointer: "👉 *हमारी सलाह:*", verdict: { book_now: "अभी बुक करें", wait: "थोड़ा रुकिए", monitor: "हम नज़र रखेंगे" },
    watchCta: "*WATCH* लिखें, किराया गिरते ही मैं आपको बताऊँगा।",
    cabTitle: (hub: string) => `🚕 *${hub} एयरपोर्ट से कैब साथी*`,
    cabCount: (n: number, town: string, at: string) => (n > 0 ? `*${n}* मार्ग बंधु ${at} के आसपास उतर रहे हैं और ${town} की तरफ़ जा रहे हैं।` : `अभी आपके रास्ते पर कोई नहीं; मैं नज़र रखूँगा।`),
    cabFare: (solo: string, share?: string) => `अकेले कैब ${solo}${share ? ` → शेयर करने पर लगभग *${share}*` : ""}।`,
    poolCta: "कैब साथी ढूँढने के लिए *POOL* लिखें।",
    replyWith: "*जवाब में लिखें*", cmds: (pool: boolean) => [pool && "*POOL* कैब साथी", "*WATCH* किराया अलर्ट", "*NEW* नई यात्रा"].filter(Boolean).join(" · "),
    link: "🔗 पूरा प्लान, किराया चार्ट और मैप:",
    matched: "🎉 *आपकी शेयर्ड कैब पक्की*", leaves: "निकलेगी", total: "कुल", you: "आप", pays: "देंगे", saves: "बचत",
    splitNote: "_सही बँटवारा: सड़क का हर हिस्सा उतने लोगों में बँटता है जितने उस समय कैब में हैं।_",
  },
};

const LABEL_HI: Record<string, string> = {
  "Direct flight": "सीधी फ्लाइट", "Flight + train": "फ्लाइट + ट्रेन", "Flight + cab": "फ्लाइट + कैब", "Direct train": "सीधी ट्रेन", "Train + train": "ट्रेन + ट्रेन",
  "Cab + flight": "कैब + फ्लाइट", "Cab + flight + train": "कैब + फ्लाइट + ट्रेन", "Cab + flight + cab": "कैब + फ्लाइट + कैब", "Cab all the way": "पूरा रास्ता कैब से",
};
const LEVEL_HI: Record<string, string> = { low: "कम", typical: "सामान्य", high: "ज़्यादा" };
const label = (s: string, l: L) => (l === "hi" ? LABEL_HI[s] ?? s : s);
const ICON: Record<string, string> = { flight: "✈️", train: "🚆", cab: "🚕", transfer: "🚶" };
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}` : `${min}m`);
const dayLabel = (iso: string, l: L) =>
  new Date(iso + "T00:00:00+05:30").toLocaleDateString(l === "hi" ? "hi-IN" : "en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

function legLine(leg: Leg, l: L): string {
  const w = W[l];
  const fareTag = leg.fare ? ` · ${rupee(leg.fare)}` : "";
  const src = leg.note?.includes("Google") ? (leg.note.startsWith("estimated") ? ` _(${w.est})_` : ` _(${w.live})_`) : "";
  const where = leg.mode === "cab" ? ` · ${cityName(leg.from, l)} → ${cityName(leg.to, l)}` : "";
  return `${ICON[leg.mode] ?? "•"} ${fmtTime(leg.depart)} → ${fmtTime(leg.arrive)}  ${leg.name}${where}${fareTag}${src}`;
}

/** Pack lines into as few messages as possible, each under the Twilio limit. */
function pack(blocks: string[]): string[] {
  const out: string[] = [];
  let cur = "";
  for (const b of blocks.filter(Boolean)) {
    const next = cur ? `${cur}\n\n${b}` : b;
    if (next.length > MAX && cur) {
      out.push(cur);
      cur = b.slice(0, MAX);
    } else cur = next.slice(0, MAX);
  }
  if (cur) out.push(cur);
  return out;
}

export const planLink = (convId: string) => `${config.publicBaseUrl}/#/plan?c=${convId}`;

export function formatPlanForWhatsApp(cards: Card[], lang: string, convId: string): string[] | null {
  const l: L = lang.startsWith("hi") ? "hi" : "en";
  const w = W[l];
  const plan = cards.find((c) => c.type === "plan") as (Card & { trip: any; itineraries: Itinerary[]; bufferMin: number; festiveRush: boolean }) | undefined;
  if (!plan?.itineraries?.length) return null;
  const fare = cards.find((c) => c.type === "fare") as (Card & { advice: FareAdvice; route: string }) | undefined;
  const pool = cards.find((c) => c.type === "pool-preview") as (Card & { hub: string; town: string; waiting: number; soloFare: number; estShare?: number; arriveAt: number }) | undefined;
  const { trip } = plan;
  const [best, ...rest] = plan.itineraries;

  // ---- message 1: the route
  const head = [
    w.title,
    `*${cityName(trip.origin, l)} → ${cityName(trip.destination, l)}* · ${l === "hi" ? `${dayLabel(trip.date, l)} ${w.around}` : `${w.around} ${dayLabel(trip.date, l)}`}${w.flex(trip.flexDays ?? 0)}`,
    plan.festiveRush ? w.rush(plan.bufferMin) : "",
  ].filter(Boolean).join("\n");
  const rec = [
    `${w.recommended}: ${label(best.label, l)} — *${rupee(best.totalFare)}* · ${dur(best.totalMin)}${best.date !== trip.date ? ` · ${dayLabel(best.date, l)}` : ""}`,
    ...best.legs.map((leg) => legLine(leg, l)),
    l === "hi" ? `🏠 ${cityName(trip.destination, l)} पहुँचें *${fmtTime(best.arrive)}* तक` : `🏠 Reach ${cityName(trip.destination, l)} by *${fmtTime(best.arrive)}*`,
  ].join("\n");
  const others = rest.length
    ? [w.others, ...rest.slice(0, 3).map((it) => {
        const tags = it.tags.filter((t) => t === "fastest" || t === "cheapest").map((t) => (t === "fastest" ? w.fastest : w.cheapest));
        const fl = it.legs.find((x) => x.mode === "flight");
        return `• ${it.legs.filter((x) => x.mode !== "transfer").map((x) => ICON[x.mode]).join("")} ${label(it.label, l)} · ${rupee(it.totalFare)} · ${dur(it.totalMin)} · ${dayLabel(it.date, l)}${fl ? ` · ${fl.name} ${fmtTime(fl.depart)}` : ""}${tags.length ? ` _(${tags.join(", ")})_` : ""}`;
      })].join("\n")
    : "";

  // ---- message 2: money + people + what next
  let fareBlock = "";
  if (fare?.advice) {
    const a = fare.advice;
    const route = fare.route.replace(/([A-Z]{3})→([A-Z]{3})/, (_, f, t) => `${cityName(f, l)}→${cityName(t, l)}`);
    fareBlock = [
      w.fareTitle(route),
      `${w.bestNow}: *${rupee(a.currentFare)}* _(${a.source === "google_flights" ? w.liveSrc : w.simSrc})_`,
      a.typicalRange ? `${w.typical}: ${rupee(a.typicalRange[0])}–${rupee(a.typicalRange[1])}${a.priceLevel ? ` · ${w.googleSays(l === "hi" ? LEVEL_HI[a.priceLevel] ?? a.priceLevel : a.priceLevel)}` : ""}` : `${w.expected}: ${rupee(a.expectedFare)}`,
      a.dropProb?.length ? `${w.drop}: ${a.dropProb.map((d) => `${d.pct}% ${w.inDays(d.days)}`).join(" · ")}` : "",
      `${w.pointer} ${w.verdict[a.verdict] ?? a.verdict}`,
      a.verdict !== "book_now" ? w.watchCta : "",
    ].filter(Boolean).join("\n");
  }
  let cabBlock = "";
  if (pool) {
    cabBlock = [
      w.cabTitle(cityName(pool.hub, l)),
      w.cabCount(pool.waiting, cityName(pool.town, l), fmtTime(pool.arriveAt)),
      w.cabFare(rupee(pool.soloFare), pool.estShare ? rupee(pool.estShare) : undefined),
      w.poolCta,
    ].join("\n");
  }
  const next = [`${w.replyWith}: ${w.cmds(Boolean(pool))}`, `${w.link}\n${planLink(convId)}`].join("\n");

  // Message 1 = the route; message 2 = price outlook, cab mates, what to reply. Each is packed under the limit.
  return [...pack([head, rec, others]), ...pack([fareBlock, cabBlock, next])];
}

export function formatPoolMatchedForWhatsApp(split: Split, meId: string, lang: string, convId: string): string {
  const l: L = lang.startsWith("hi") ? "hi" : "en";
  const w = W[l];
  const lines = split.lines.map((x) => `• ${x.riderId === meId ? `*${w.you}*` : x.name} → ${cityByCode.get(x.town) ? cityName(x.town, l) : x.town} (${x.dropKm} km): *${rupee(x.pays)}* · ${w.saves} ${rupee(x.saves)}`);
  return [
    w.matched,
    `${w.leaves} *${fmtTime(split.departAt)}* · ${split.totalKm} km · ${rupee(split.totalFare)} ${w.total}`,
    ...lines,
    w.splitNote,
    `${w.link}\n${planLink(convId)}`,
  ].join("\n").slice(0, MAX);
}
