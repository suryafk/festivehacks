// "Why book now / why wait?" in the traveller's language.
// The numbers come from fareStats (real price history). Sarvam only joins ready-made phrases into two friendly
// sentences, and its text is checked: if it contains any number that isn't in those phrases, it is thrown away
// and the hand-written template is used instead. Same facts → cached text (no repeat calls).
import { createHash } from "node:crypto";
import { db } from "../db.ts";
import { trace } from "../bus.ts";
import { config, has } from "../config.ts";
import { chatText } from "../integrations/sarvam.ts";
import type { FareAdvice } from "./fares.ts";
import { fmtDate, rupee } from "./i18n.ts";

type L = "en" | "hi";

db.exec(`CREATE TABLE IF NOT EXISTS fare_explain (k TEXT PRIMARY KEY, text TEXT, ts INTEGER)`);

export function templateExplain(a: FareAdvice, l: L, variant: "urgent" | "savings"): string {
  const e = a.evidence;
  const X = rupee(a.currentFare);
  const D = e?.days ?? 0;
  const p7 = e?.drop.find((d) => d.days === 7);
  const close = variant === "savings" ? (l === "hi" ? ` आज ${X} पक्का कर लीजिए।` : ` Lock in ${X} today.`) : (l === "hi" ? " अभी बुक करें।" : " Book now.");
  const hi = l === "hi";
  switch (a.reason) {
    case "google_low":
      return hi ? `Google के मुताबिक़ इस रूट पर ${X} कम किराया है।${close}` : `Google rates ${X} as a low fare for this route.${close}`;
    case "cheapest_so_far":
      return hi
        ? `${X} पिछले ${D} दिनों के ${e!.cheaperThanPct}% दिनों से सस्ता है (सबसे कम ${rupee(e!.min.fare)}, ${fmtDate(e!.min.date, l)})।${close}`
        : `${X} is cheaper than ${e!.cheaperThanPct}% of the last ${D} days (lowest was ${rupee(e!.min.fare)} on ${fmtDate(e!.min.date, l)}).${close}`;
    case "too_close":
      return hi ? `यात्रा में सिर्फ़ ${a.daysOut} दिन बचे हैं; इतने पास आकर किराया शायद ही घटता है।${close}` : `Only ${a.daysOut} days to go; fares rarely fall this close to travel.${close}`;
    case "festival_close":
      return hi ? `${a.festival} का हफ़्ता है और ${a.daysOut} दिन बचे हैं; अब किराया आमतौर पर बढ़ता ही है।${close}` : `It's ${a.festival} week with ${a.daysOut} days to go; fares usually climb from here.${close}`;
    case "drops_common":
      return hi
        ? `पिछले ${D} दिनों में, जब किराया आज जितना था, ${p7?.pct}% बार एक हफ़्ते के अंदर 5% से ज़्यादा गिरा${a.savings ? ` (आमतौर पर लगभग ${rupee(a.savings)} की बचत)` : ""}। मैं नज़र रखूँगा और गिरते ही बताऊँगा।`
        : `Over the last ${D} days, when the fare was at today's level it fell 5%+ within a week ${p7?.pct}% of the time${a.savings ? ` (usually saving about ${rupee(a.savings)})` : ""}. I'll watch it and tell you when it drops.`;
    case "google_high":
      return hi ? `Google इस रूट पर ${X} को महँगा मानता है और अभी ${a.daysOut} दिन बाक़ी हैं। मैं नज़र रखूँगा।` : `Google rates ${X} as high for this route and there are ${a.daysOut} days to go. I'll watch it for you.`;
    case "rising":
      return hi ? `पिछले हफ़्ते किराया ${e!.trendPct}% बढ़ा है।${close}` : `Fares rose ${e!.trendPct}% over the last week.${close}`;
    case "waiting_didnt_pay":
      return hi
        ? `इस रूट पर किराया कभी-कभी गिरता है, पर पिछले ${D} दिनों में इंतज़ार करने से फ़ायदा नहीं हुआ।${close}`
        : `Fares on this route do dip now and then, but over the last ${D} days waiting for a dip didn't pay off.${close}`;
    default: {
      const M = e?.median ?? a.currentFare;
      const rel = a.currentFare < M * 0.95 ? "below" : a.currentFare > M * 1.05 ? "above" : "close";
      const relHi = { below: "से कम है", above: "से ज़्यादा है", close: "के आसपास है" }[rel];
      const relEn = { below: "below", above: "above", close: "close to" }[rel];
      return hi
        ? `${X} सामान्य किराये (पिछले ${D} दिनों का मध्य ${rupee(M)}) ${relHi}, और रुकने से बचत के संकेत नहीं हैं।${close}`
        : `${X} is ${relEn} the usual fare (median ${rupee(M)} over ${D} days) and nothing suggests waiting pays.${close}`;
    }
  }
}

/** Every number in a text, as integers (handles 7,935 / ₹7,935 / Devanagari digits / 12.5%). */
export function numbersIn(text: string): number[] {
  const t = text.replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))).replace(/(\d),(?=\d)/g, "$1");
  return (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** The model may only use numbers that are in the facts (or trivially implied: 5% drop, 7 days, a week). */
export function onlyKnownNumbers(text: string, facts: unknown): boolean {
  const allowed = new Set([...numbersIn(JSON.stringify(facts)), 5, 7, 2026, 2027].map((n) => Math.round(n * 10) / 10));
  for (const n of numbersIn(JSON.stringify(facts))) allowed.add(Math.round(n));
  return numbersIn(text).every((n) => allowed.has(Math.round(n * 10) / 10) || allowed.has(Math.round(n)));
}

/**
 * Ready-made phrases in the user's language: the model only joins and smooths these. Given bare numbers it
 * sometimes mangles their meaning ("cheaper than 65% of days" → "65% cheaper than average"), and a number
 * check can't catch that, because every number is still real.
 */
export function farePoints(a: FareAdvice, l: L, variant: "urgent" | "savings"): string[] {
  const e = a.evidence;
  const hi = l === "hi";
  const d7 = e?.drop.find((d) => d.days === 7);
  const pts = [hi ? (a.verdict === "monitor" ? "सलाह: किराये पर नज़र रखें, गिरते ही सूचना मिलेगी" : "सलाह: अभी बुक करें") : a.verdict === "monitor" ? "Advice: watch the fare; we'll alert you when it drops" : "Advice: book now"];
  pts.push(hi ? `कारण: ${templateExplain(a, l, variant)}` : `Why: ${templateExplain(a, l, variant)}`);
  if (e) {
    pts.push(hi ? `आज का सबसे कम किराया ${rupee(a.currentFare)}, यात्रा से ${a.daysOut} दिन पहले` : `today's lowest fare is ${rupee(a.currentFare)}, ${a.daysOut} days before travel`);
    if (e.cheaperThanPct >= 50) pts.push(hi ? `यह पिछले ${e.days} दिनों के ${e.cheaperThanPct}% दिनों से सस्ता है` : `that is cheaper than ${e.cheaperThanPct}% of the last ${e.days} days`);
    else pts.push(hi ? `यह पिछले ${e.days} दिनों के ${100 - e.cheaperThanPct}% दिनों से महँगा है` : `that is dearer than ${100 - e.cheaperThanPct}% of the last ${e.days} days`);
    pts.push(hi ? `आमतौर पर (मध्य) किराया ${rupee(e.median)}` : `the usual (median) fare was ${rupee(e.median)}`);
    if (d7 && d7.samples >= 5)
      pts.push(hi ? `पहले, जब किराया आज जितना था, ${d7.pct}% बार एक हफ़्ते में 5% से ज़्यादा गिरा` : `on past days priced like today, it fell 5%+ within a week ${d7.pct}% of the time`);
  }
  if (a.festival) pts.push(hi ? `${a.festival} का समय है` : `it's ${a.festival} season`);
  return pts;
}

const SYSTEM = (l: L, variant: "urgent" | "savings") => `You help an Indian traveller decide when to book a flight. Reply in ${l === "hi" ? "simple, warm Hindi (Devanagari)" : "simple, warm English"}.
You get a list of points: the advice, why, and some supporting facts. Write at most 2 short sentences (under 35 words in all):
the advice, the reason, and at most one supporting fact. Keep the exact meaning of what you use; don't change what a number refers to.
Add nothing of your own: no other facts or numbers, no guesses about what prices will do. Write rupee amounts like ₹7,935.${variant === "savings" ? " Tone: warm, stress the money this saves." : " Tone: short and direct."}`;

const inFlight = new Map<string, Promise<string | null>>();

export async function explainFare(a: FareAdvice, route: string, travelDate: string, l: L, variant: "urgent" | "savings", convId: string | null, enabled: boolean): Promise<{ text: string; via: "sarvam" | "template" }> {
  const template = templateExplain(a, l, variant);
  if (!enabled || !has.sarvam() || a.method !== "history") return { text: template, via: "template" };
  const points = farePoints(a, l, variant);
  const k = createHash("sha1").update(JSON.stringify([points, l, variant])).digest("hex");
  const hit = db.prepare("SELECT text FROM fare_explain WHERE k = ?").get(k) as { text: string } | undefined;
  if (hit) return { text: hit.text, via: "sarvam" };

  // One call per distinct set of facts; it keeps running (and fills the cache) even if we stop waiting for it.
  let job = inFlight.get(k);
  if (!job) {
    job = (async () => {
      try {
        const out = (await chatText(SYSTEM(l, variant), points.map((p) => `- ${p}`).join("\n"), convId, "explain fare pointer", { model: config.sarvam.explainModel, timeoutMs: 20_000, maxTokens: 400, temperature: 0.3 }))
          .replace(/\s+/g, " ").trim();
        // no forecasts: the facts say what prices did, never what they will do
        const guesses = /\b(will|may|might|could|likely|expected to|going to)\s+(rise|go up|increase|climb|drop|fall|fill)|\b(rise|rises|rising|risk|risks|increase|soar|spike|sell out|before it changes)\b|बढ़ सकत|बढ़ेग|बढ़ जाएग|बढ़ने|गिर सकत|गिरेग|महँगा हो जाएग|महंगा हो जाएग|ख़तरा|खतरा/i;
        const ok = out.length >= 20 && out.length <= 320 && !guesses.test(out) && onlyKnownNumbers(out, { points, route, travelDate }) && (l !== "hi" || /[\u0900-\u097F]/.test(out));
        trace("sarvam", convId, { step: "fare explanation check", accepted: ok, text: out.slice(0, 300) });
        if (!ok) return null;
        db.prepare("INSERT OR REPLACE INTO fare_explain (k, text, ts) VALUES (?,?,?)").run(k, out, Date.now());
        return out;
      } catch (e) {
        trace("sarvam", convId, { step: "fare explanation", error: String(e).slice(0, 160), fallback: "template" });
        return null;
      } finally {
        inFlight.delete(k);
      }
    })();
    inFlight.set(k, job);
  }
  // Don't hold the plan up for more than ~4 s: answer with the template, the Sarvam text is ready next time.
  const out = await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), 4500))]);
  return out ? { text: out, via: "sarvam" } : { text: template, via: "template" };
}
