// Fare analysis from a real price history (Google Flights' daily lowest fare for one route + travel date).
// Pure functions, no I/O: every number here can be traced back to the history, and the rules can be backtested.
//
// What we can honestly say from ~60 days of history for one travel date:
//  - where today's price sits among the prices seen so far (percentile, min, median);
//  - which way it has been moving lately (trend);
//  - how often, on past days when the fare was near today's level, it fell ≥5% within the next N days.
// What we can't say: the exact fare on a future date. So there is no invented forecast curve.

export interface PricePoint { date: string; fare: number }

export interface FareEvidence {
  days: number; // history length used
  since?: string;
  median: number;
  min: PricePoint;
  max: PricePoint;
  /** Share of past days that were dearer than today (0–100). 90 = cheaper than 90% of days. */
  cheaperThanPct: number;
  /** Median of the last 7 days vs the 7 before, in %. Negative = falling. */
  trendPct?: number;
  /** Historical chance of a ≥5% drop within N days, from days whose price was near today's. */
  drop: { days: number; pct: number; samples: number; medianSavePct?: number }[];
  /** Days since the price last changed, and the change. */
  lastChange?: { date: string; from: number; to: number };
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Drop isolated spikes (a single day at 4× the neighbours, e.g. a sold-out cheap class) before analysing. */
export function cleanHistory(h: PricePoint[]): PricePoint[] {
  const pts = h.filter((p) => Number.isFinite(p.fare) && p.fare > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 5) return pts;
  const med = median(pts.map((p) => p.fare));
  return pts.filter((p) => p.fare <= med * 2.5 && p.fare >= med * 0.35);
}

export const DROP_PCT = 5;

/**
 * Historical analog: for each past day i that has `n` days of history after it, did the fare fall ≥5% below
 * fare[i] within those n days? Days priced like today count most (similarity weight), recent days a bit more.
 */
export function dropChance(h: PricePoint[], today: number, n: number) {
  let w = 0, hits = 0, samples = 0;
  const saves: number[] = [];
  for (let i = 0; i + n < h.length; i++) {
    const f = h[i].fare;
    const similarity = Math.exp(-Math.abs(f / today - 1) / 0.08); // ~1 within ±3%, ~0.3 at ±10%
    if (similarity < 0.15) continue;
    const recency = Math.pow(0.5, (h.length - 1 - i) / 21); // half-life 3 weeks
    const weight = similarity * recency;
    const futureMin = Math.min(...h.slice(i + 1, i + 1 + n).map((p) => p.fare));
    const dropped = futureMin <= f * (1 - DROP_PCT / 100);
    w += weight;
    samples++;
    if (dropped) {
      hits += weight;
      saves.push((f - futureMin) / f);
    }
  }
  return {
    days: n,
    pct: w ? Math.round((hits / w) * 100) : 0,
    samples,
    medianSavePct: saves.length ? Math.round(median(saves) * 100) : undefined,
  };
}

export function analyse(history: PricePoint[], currentFare: number): FareEvidence | null {
  const h = cleanHistory(history);
  if (h.length < 7) return null;
  const fares = h.map((p) => p.fare);
  const min = h.reduce((a, b) => (b.fare < a.fare ? b : a));
  const max = h.reduce((a, b) => (b.fare > a.fare ? b : a));
  const dearer = fares.filter((f) => f > currentFare).length;
  const last7 = fares.slice(-7), prev7 = fares.slice(-14, -7);
  const trendPct = prev7.length >= 5 ? Math.round(((median(last7) - median(prev7)) / median(prev7)) * 1000) / 10 : undefined;
  let lastChange: FareEvidence["lastChange"];
  for (let i = h.length - 1; i > 0; i--) if (h[i].fare !== h[i - 1].fare) { lastChange = { date: h[i].date, from: h[i - 1].fare, to: h[i].fare }; break; }
  return {
    days: h.length,
    since: h[0].date,
    median: Math.round(median(fares)),
    min, max,
    cheaperThanPct: Math.round((dearer / fares.length) * 100),
    trendPct,
    drop: [3, 7].map((n) => dropChance(h, currentFare, n)),
    lastChange,
  };
}

export type LiveVerdict = { verdict: "book_now" | "monitor"; reason: VerdictReason; expectedSave?: number };
export type VerdictReason =
  | "google_low" // Google itself calls today's price low
  | "cheapest_so_far" // cheaper than ≥80% of days seen
  | "too_close" // ≤14 days out: fares usually only climb
  | "festival_close" // festival week and ≤21 days out
  | "drops_common" // ≥40% historical chance of a ≥5% drop within 7 days
  | "google_high" // Google calls it high and there's time
  | "rising" // trending up
  | "no_signal"; // nothing suggests waiting pays

/**
 * Plain rules on the evidence, checked in order; the first that applies decides. Each maps to one sentence
 * the user can check against the card.
 */
export function decide(e: FareEvidence | null, o: { currentFare: number; daysOut: number; priceLevel?: string; festival?: string }): LiveVerdict {
  const p7 = e?.drop.find((d) => d.days === 7);
  if (o.priceLevel === "low") return { verdict: "book_now", reason: "google_low" };
  if (e && e.cheaperThanPct >= 80) return { verdict: "book_now", reason: "cheapest_so_far" };
  if (o.daysOut <= 14) return { verdict: "book_now", reason: "too_close" };
  if (o.festival && o.daysOut <= 21) return { verdict: "book_now", reason: "festival_close" };
  if (p7 && p7.samples >= 10 && p7.pct >= 40)
    return { verdict: "monitor", reason: "drops_common", expectedSave: p7.medianSavePct ? Math.round((o.currentFare * p7.medianSavePct) / 100 / 10) * 10 : undefined };
  if (o.priceLevel === "high" && o.daysOut > 21) return { verdict: "monitor", reason: "google_high" };
  if (e?.trendPct !== undefined && e.trendPct >= 3) return { verdict: "book_now", reason: "rising" };
  return { verdict: "book_now", reason: "no_signal" };
}

/**
 * Backtest the rules on one history: pretend each past day was "today", decide with only what was known then,
 * and check what happened in the following 7 days. "monitor" is right if a ≥5% drop came; "book_now" is right
 * if it didn't. Ignores Google's price level (not known for past days) and the days-out rules.
 * With `selfCheck`, also applies the app's per-route self-check, each day seeing only the days before it.
 */
export function backtest(history: PricePoint[], minHistory = 21, horizon = 7, selfCheck = false) {
  const h = cleanHistory(history);
  const rows: { date: string; verdict: string; dropped: boolean; right: boolean }[] = [];
  for (let i = minHistory; i + horizon < h.length; i++) {
    const past = h.slice(0, i + 1);
    const today = h[i].fare;
    const e = analyse(past, today);
    let v = decide(e, { currentFare: today, daysOut: 60 });
    // the app's self-check, using only days before this one (walk-forward, no peeking)
    if (selfCheck && v.verdict === "monitor") {
      const prior = backtest(past, minHistory, horizon, false);
      if (prior.monitorCalls >= 3 && prior.monitorRight / prior.monitorCalls < 0.5) v = { verdict: "book_now", reason: v.reason };
    }
    const dropped = Math.min(...h.slice(i + 1, i + 1 + horizon).map((p) => p.fare)) <= today * (1 - DROP_PCT / 100);
    rows.push({ date: h[i].date, verdict: v.verdict, dropped, right: v.verdict === "monitor" ? dropped : !dropped });
  }
  const n = rows.length;
  const monitor = rows.filter((r) => r.verdict === "monitor");
  const book = rows.filter((r) => r.verdict === "book_now");
  const baseRate = n ? rows.filter((r) => r.dropped).length / n : 0;
  return {
    days: n,
    accuracy: n ? Math.round((rows.filter((r) => r.right).length / n) * 100) : 0,
    // "always book now" is right whenever no drop came: the baseline to beat
    alwaysBookAccuracy: n ? Math.round((1 - baseRate) * 100) : 0,
    monitorCalls: monitor.length,
    monitorRight: monitor.filter((r) => r.right).length,
    bookCalls: book.length,
    bookRight: book.filter((r) => r.right).length,
  };
}
