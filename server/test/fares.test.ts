import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.DATA_DIR = fileURLToPath(new URL("./.tmp-fares/", import.meta.url));
const { analyse, cleanHistory, decide, backtest, dropChance } = await import("../src/engine/fareStats.ts");
const { onlyKnownNumbers, numbersIn, templateExplain } = await import("../src/engine/fareExplain.ts");
const { adviseFare, defaultFareModel } = await import("../src/engine/fares.ts");

const day = (i: number) => new Date(Date.UTC(2026, 8, 26) + i * 86_400_000).toISOString().slice(0, 10);
const series = (fares: number[]) => fares.map((fare, i) => ({ date: day(i), fare }));

test("evidence: percentile, min, median and trend come straight from the history", () => {
  const h = series([9000, 9000, 8800, 8800, 8600, 8600, 8400, 8400, 8200, 8200, 8000, 8000, 7800, 7800]);
  const e = analyse(h, 8100)!;
  assert.equal(e.days, 14);
  assert.equal(e.min.fare, 7800);
  assert.equal(e.cheaperThanPct, 71); // 10 of 14 days were dearer than ₹8,100
  assert.ok(e.trendPct! < 0); // falling
});

test("spikes (a single ₹27,280 day among ₹6–9k) are dropped before analysis", () => {
  const h = series([6800, 6800, 27280, 6900, 7000, 6900, 6800, 6900]);
  assert.equal(cleanHistory(h).length, 7);
});

test("historical drop chance: a saw-tooth fare drops often, a flat fare never", () => {
  const saw = series(Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? 7000 : 8000)));
  assert.ok(dropChance(saw, 8000, 7).pct > 80);
  const flat = series(Array.from({ length: 40 }, () => 6441));
  assert.equal(dropChance(flat, 6441, 7).pct, 0);
});

test("rules: Google 'low' and too-close always mean book now; frequent drops mean watch", () => {
  const saw = series(Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? 7000 : 8000)));
  const e = analyse(saw, 8000);
  assert.equal(decide(e, { currentFare: 8000, daysOut: 40, priceLevel: "low" }).reason, "google_low");
  assert.equal(decide(e, { currentFare: 8000, daysOut: 10 }).reason, "too_close");
  assert.equal(decide(e, { currentFare: 8000, daysOut: 20, festival: "Diwali" }).reason, "festival_close");
  assert.equal(decide(e, { currentFare: 8000, daysOut: 40 }).verdict, "monitor");
});

test("backtest: on a saw-tooth the rules beat 'always book now'", () => {
  const saw = series(Array.from({ length: 60 }, (_, i) => (i % 4 === 0 ? 7000 : 8000)));
  const bt = backtest(saw);
  assert.ok(bt.days > 20);
  assert.ok(bt.accuracy > bt.alwaysBookAccuracy);
});

test("live advice: no invented forecast, and 'watch it' is withdrawn if waiting never paid on this route", () => {
  // drops happen early in the history, never since: the rule would say watch, the route's own record says no
  const fares = [...Array.from({ length: 25 }, (_, i) => (i % 3 === 0 ? 6000 : 6600)), ...Array.from({ length: 35 }, () => 6600)];
  const a = adviseFare(6000, "2027-01-20", new Date("2026-11-25T06:00:00Z"), defaultFareModel, "X", {
    lowestPrice: 6600, priceLevel: "typical", typicalRange: [5000, 8000], history: series(fares), fetchedAt: Date.now(),
  });
  assert.equal(a.method, "history");
  assert.equal(a.forecast.length, 1); // just today
  assert.equal(a.verdict, "book_now");
  assert.ok(["waiting_didnt_pay", "no_signal"].includes(a.reason!));
});

test("Sarvam's explanation may only use numbers from the facts", () => {
  const facts = { price_today: 7935, cheaper_than_pct_of_past_days: 64, days_of_price_history: 61, lowest_seen: { price: 7086, on: "1 Nov" } };
  assert.ok(onlyKnownNumbers("Book now: ₹7,935 is cheaper than 64% of the last 61 days (lowest ₹7,086 on 1 Nov).", facts));
  assert.ok(onlyKnownNumbers("अभी बुक करें: ₹७,९३५ पिछले ६१ दिनों में ठीक है।", facts)); // Devanagari digits
  assert.equal(onlyKnownNumbers("Book now, fares will hit ₹9,500 next week.", facts), false); // invented number
  assert.deepEqual(numbersIn("₹7,935 and 12.5%"), [7935, 12.5]);
});

test("template explanations exist for every reason, in English and Hindi", () => {
  const e = analyse(series(Array.from({ length: 30 }, (_, i) => 7000 + (i % 5) * 100)), 7100)!;
  for (const reason of ["google_low", "cheapest_so_far", "too_close", "festival_close", "drops_common", "google_high", "rising", "waiting_didnt_pay", "no_signal"]) {
    const a: any = { reason, evidence: { ...e, trendPct: 4 }, currentFare: 7100, daysOut: 20, festival: "Christmas", savings: 400, verdict: "book_now" };
    for (const l of ["en", "hi"] as const) assert.ok(templateExplain(a, l, "urgent").length > 20, `${reason}/${l}`);
  }
});

test("template wording follows the numbers: ₹7,935 vs a ₹9,286 median is 'below', not 'close to'", () => {
  const e = analyse(series(Array.from({ length: 30 }, () => 9286)), 7935)!;
  const a: any = { reason: "no_signal", evidence: e, currentFare: 7935, daysOut: 31, verdict: "book_now" };
  assert.match(templateExplain(a, "en", "urgent"), /below the usual fare/);
  assert.match(templateExplain(a, "hi", "urgent"), /से कम है/);
});
