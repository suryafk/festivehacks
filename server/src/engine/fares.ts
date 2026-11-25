// Simulated fare model: "when should I book?".
// fare(travelDate, bookedOn) = base × festiveSurge(travelDate) × leadTimeCurve(daysOut) × noise
import { festivals } from "./seed.ts";
import { analyse, backtest, cleanHistory, decide, type FareEvidence, type VerdictReason } from "./fareStats.ts";

export interface FareModel {
  festiveSurgePct: number; // extra % on festive travel dates
  festiveWindowDays: number; // ± days around a festival that count as "festive"
  sweetSpotDays: [number, number]; // cheapest booking window (days before travel)
  lastMinutePct: number; // extra % when booking inside 7 days
  volatilityPct?: number; // day-to-day fare volatility used for drop probability
}

export const defaultFareModel: FareModel = {
  festiveSurgePct: 38,
  festiveWindowDays: 5,
  sweetSpotDays: [21, 45],
  lastMinutePct: 70,
  volatilityPct: 4,
};

const DAY = 86_400_000;
const toDay = (d: string | Date) => {
  const x = typeof d === "string" ? new Date(d + "T00:00:00Z") : d;
  return Math.floor(x.getTime() / DAY);
};

function hashNoise(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000; // 0..1, deterministic
}

export function festiveFor(travelDate: string, m: FareModel) {
  const t = toDay(travelDate);
  return festivals.find((f) => Math.abs(toDay(f.date) - t) <= m.festiveWindowDays);
}

function leadCurve(daysOut: number, m: FareModel) {
  const [lo, hi] = m.sweetSpotDays;
  if (daysOut < 0) return NaN;
  if (daysOut <= 7) return 1 + (m.lastMinutePct / 100) * (1 - daysOut / 8);
  if (daysOut < lo) return 1 + 0.25 * ((lo - daysOut) / (lo - 7)); // creeping up
  if (daysOut <= hi) return 0.92;
  return 1.0; // far out: airlines haven't discounted yet
}

export function fareOn(baseFare: number, travelDate: string, bookedOn: Date, m: FareModel, key = "") {
  const daysOut = toDay(travelDate) - toDay(bookedOn);
  const surge = festiveFor(travelDate, m) ? 1 + m.festiveSurgePct / 100 : 1;
  const noise = 0.95 + 0.1 * hashNoise(`${key}|${travelDate}|${toDay(bookedOn)}`);
  return Math.round((baseFare * surge * leadCurve(daysOut, m) * noise) / 10) * 10;
}

export interface FareAdvice {
  verdict: "book_now" | "wait" | "monitor";
  currentFare: number;
  expectedFare: number; // median of recent quotes for this travel date
  vsExpectedPct: number; // current vs expected, %
  dropProb: { days: number; pct: number }[]; // chance of a >=5% drop within N days
  bestFare: number;
  bestBookBy: string; // ISO date
  daysOut: number;
  festival?: string;
  savings: number;
  riseAfter?: string; // date after which fares jump
  history: { date: string; fare: number }[]; // past quotes for this travel date (Google Flights when live)
  forecast: { date: string; fare: number }[]; // until travel date (model shape, anchored to today's price)
  source: "google_flights" | "simulated";
  /** "history": verdict from the real price history (fareStats.ts). "model": the simulated fare model. */
  method: "history" | "model";
  evidence?: FareEvidence;
  reason?: VerdictReason | "waiting_didnt_pay";
  /** How the rules would have done on this route's own history (see fareStats.backtest). */
  backtest?: { days: number; accuracy: number; alwaysBookAccuracy: number; monitorCalls: number; monitorRight: number };
  priceLevel?: string; // Google's "low" | "typical" | "high"
  typicalRange?: [number, number];
  volatilityPct: number;
  fetchedAt?: number;
}

/** Real market data for this route + date, from Google Flights. */
export interface LiveFareInput {
  lowestPrice: number;
  priceLevel?: string;
  typicalRange?: [number, number];
  history: { date: string; fare: number }[];
  fetchedAt: number;
}

const iso = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

/** Day-to-day volatility (std of % changes) from a real price history, clamped to a sane band. */
function volatilityFrom(history: { fare: number }[]): number | undefined {
  if (history.length < 5) return undefined;
  const ch = history.slice(1).map((h, i) => (h.fare - history[i].fare) / history[i].fare);
  const mean = ch.reduce((a, b) => a + b, 0) / ch.length;
  const sd = Math.sqrt(ch.reduce((a, b) => a + (b - mean) ** 2, 0) / ch.length) * 100;
  return Math.min(15, Math.max(2, Math.round(sd * 10) / 10));
}

export function adviseFare(baseFare: number, travelDate: string, today: Date, m: FareModel, key: string, live?: LiveFareInput): FareAdvice {
  if (live && cleanHistory(live.history).length >= 7) return adviseFromHistory(travelDate, today, m, live);
  return adviseFromModel(baseFare, travelDate, today, m, key, live);
}

/**
 * Live path: every number comes from Google's price history for this route + date. No invented forecast:
 * the chart shows the history and today, and the verdict comes from plain rules (fareStats.decide), kept honest
 * by a backtest on the same route.
 */
function adviseFromHistory(travelDate: string, today: Date, m: FareModel, live: LiveFareInput): FareAdvice {
  const t0 = toDay(today);
  const daysOut = toDay(travelDate) - t0;
  const current = live.lowestPrice;
  const history = cleanHistory(live.history.filter((h) => h.date < iso(t0))).slice(-90);
  const fest = festiveFor(travelDate, m);
  const e = analyse(history, current);
  let v = decide(e, { currentFare: current, daysOut, priceLevel: live.priceLevel, festival: fest?.name });
  const bt = backtest(history);
  let reason: FareAdvice["reason"] = v.reason;
  // Self-check: only suggest waiting if waiting would have paid off on this route's own history.
  if (v.verdict === "monitor" && bt.monitorCalls >= 3 && bt.monitorRight / bt.monitorCalls < 0.5) {
    v = { verdict: "book_now", reason: v.reason };
    reason = "waiting_didnt_pay";
  }
  const expectedFare = live.typicalRange ? Math.round((live.typicalRange[0] + live.typicalRange[1]) / 2 / 10) * 10 : e?.median ?? current;
  return {
    source: "google_flights",
    method: "history",
    evidence: e ?? undefined,
    reason,
    backtest: { days: bt.days, accuracy: bt.accuracy, alwaysBookAccuracy: bt.alwaysBookAccuracy, monitorCalls: bt.monitorCalls, monitorRight: bt.monitorRight },
    priceLevel: live.priceLevel,
    typicalRange: live.typicalRange,
    volatilityPct: volatilityFrom(history) ?? m.volatilityPct ?? 4,
    fetchedAt: live.fetchedAt,
    verdict: v.verdict,
    currentFare: current,
    expectedFare,
    vsExpectedPct: Math.round(((current - expectedFare) / expectedFare) * 100),
    dropProb: (e?.drop ?? []).filter((d) => d.samples >= 5 && d.days < daysOut).map((d) => ({ days: d.days, pct: d.pct })),
    bestFare: current,
    bestBookBy: iso(t0),
    daysOut,
    festival: fest?.name,
    savings: v.verdict === "monitor" ? v.expectedSave ?? 0 : 0,
    history,
    forecast: [{ date: iso(t0), fare: current }],
  };
}

/** Simulated path (no live data): the original fare model. */
function adviseFromModel(baseFare: number, travelDate: string, today: Date, m: FareModel, key: string, live?: LiveFareInput): FareAdvice {
  const t0 = toDay(today);
  const travel = toDay(travelDate);
  const daysOut = travel - t0;
  let history: { date: string; fare: number }[] = [];
  for (let d = t0 - 21; d < t0; d++) history.push({ date: iso(d), fare: fareOn(baseFare, travelDate, new Date(d * DAY), m, key) });
  let forecast: { date: string; fare: number }[] = [];
  for (let d = t0; d <= travel; d++) forecast.push({ date: iso(d), fare: fareOn(baseFare, travelDate, new Date(d * DAY), m, key) });

  if (live) {
    // Anchor the model's lead-time/festive shape to the real price today, and use Google's real history.
    const ratio = live.lowestPrice / (forecast[0]?.fare || live.lowestPrice);
    forecast = forecast.map((f, i) => ({ date: f.date, fare: i === 0 ? live.lowestPrice : Math.round((f.fare * ratio) / 10) * 10 }));
    if (live.history.length >= 3) history = live.history.filter((h) => h.date < iso(t0)).slice(-60);
  }
  const volatilityPct = (live && volatilityFrom(live.history)) ?? m.volatilityPct ?? 4;

  const current = forecast[0]?.fare ?? baseFare;
  // only consider the next 10 days of waiting — beyond that the risk of sell-out in festive season is real
  const horizon = forecast.slice(0, Math.min(10, forecast.length));
  const best = horizon.reduce((a, b) => (b.fare < a.fare ? b : a), horizon[0] ?? { date: iso(t0), fare: current });
  const jump = forecast.find((f, i) => i > 0 && f.fare > current * 1.12);
  const savings = current - best.fare;
  const fest = festiveFor(travelDate, m);

  // "What should this cost?" — Google's typical range midpoint when live, else the median of recent quotes.
  const sorted = history.map((h) => h.fare).sort((a, b) => a - b);
  const expectedFare = live?.typicalRange
    ? Math.round((live.typicalRange[0] + live.typicalRange[1]) / 2 / 10) * 10
    : sorted.length ? sorted[Math.floor(sorted.length / 2)] : current;

  // Probability of a meaningful (≥5%) drop within N days: Monte Carlo over the forecast with daily volatility.
  const rng = mulberry32(Math.floor(hashNoise(`${key}|${travelDate}|${t0}`) * 1e9));
  const dropWithin = (n: number) => {
    const days = forecast.slice(1, 1 + n);
    if (!days.length) return 0;
    let hits = 0;
    const runs = 600;
    for (let r = 0; r < runs; r++) if (days.some((d) => d.fare * (1 + (gauss(rng) * volatilityPct) / 100) < current * 0.95)) hits++;
    return Math.round((hits / runs) * 100);
  };
  const dropProb = [3, 7].filter((n) => n < daysOut).map((n) => ({ days: n, pct: dropWithin(n) }));
  const p7 = dropProb.find((d) => d.days === 7)?.pct ?? dropProb[0]?.pct ?? 0;

  let verdict: FareAdvice["verdict"] = "book_now";
  if (live?.priceLevel === "low") verdict = "book_now"; // Google says it's already a low price: don't gamble
  else if (savings > Math.max(250, current * 0.05) && !(fest && daysOut < 21)) verdict = "wait";
  else if ((p7 >= 25 || live?.priceLevel === "high") && daysOut > 10) verdict = "monitor"; // a decent chance it dips: let us watch it for you
  return {
    source: live ? "google_flights" : "simulated",
    method: "model",
    priceLevel: live?.priceLevel,
    typicalRange: live?.typicalRange,
    volatilityPct,
    fetchedAt: live?.fetchedAt,
    verdict,
    currentFare: current,
    expectedFare,
    vsExpectedPct: Math.round(((current - expectedFare) / expectedFare) * 100),
    dropProb,
    bestFare: verdict === "wait" ? best.fare : current,
    bestBookBy: verdict === "wait" ? best.date : iso(t0),
    daysOut,
    festival: fest?.name,
    savings: verdict === "wait" ? savings : 0,
    riseAfter: jump?.date,
    history,
    forecast,
  };
}

/** Today's live quote for a fare watch: the model fare plus a little intraday jitter. */
export function liveQuote(baseFare: number, travelDate: string, m: FareModel, key: string, now = new Date()) {
  const f = fareOn(baseFare, travelDate, now, m, key);
  return Math.round((f * (1 + (Math.random() - 0.5) * 0.04)) / 10) * 10;
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rng: () => number) => Math.sqrt(-2 * Math.log(rng() || 1e-9)) * Math.cos(2 * Math.PI * rng());
