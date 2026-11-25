import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.DATA_DIR = new URL("./.tmp/", import.meta.url).pathname;
const { parseSerpApi } = await import("../src/integrations/googleFlights.ts");
const { adviseFare, defaultFareModel } = await import("../src/engine/fares.ts");
const fixture = JSON.parse(readFileSync(new URL("./fixtures-google-flights.json", import.meta.url), "utf8"));

test("parses flights, skips malformed ones, sorts by departure", () => {
  const p = parseSerpApi(fixture);
  assert.equal(p.flights.length, 3); // the "bad-price" option is dropped
  assert.deepEqual(p.flights.map((f) => f.flightNumber), ["6E 6157", "IX 2741", "QP 1361"]);
  assert.equal(p.flights[2].stops, 1);
  assert.equal(new Date(p.flights[0].depart).toISOString(), "2026-12-26T00:35:00.000Z"); // 06:05 IST
  assert.equal(p.flights[2].durMin, 335);
});

test("parses price insights and daily history", () => {
  const { insights } = parseSerpApi(fixture);
  assert.equal(insights.lowestPrice, 6420);
  assert.equal(insights.priceLevel, "high");
  assert.deepEqual(insights.typicalRange, [4800, 6200]);
  assert.equal(insights.history.length, 10);
  assert.ok(insights.history.every((h, i, a) => i === 0 || a[i - 1].date < h.date));
});

test("tolerates empty / garbage responses", () => {
  assert.deepEqual(parseSerpApi({}).flights, []);
  assert.deepEqual(parseSerpApi(null).insights.history, []);
});

test("live advice anchors to Google's price and typical range", () => {
  const { insights } = parseSerpApi(fixture);
  const today = new Date("2026-11-25T06:00:00Z");
  const a = adviseFare(5200, "2026-12-26", today, defaultFareModel, "BLRLKO", { lowestPrice: 6420, priceLevel: insights.priceLevel, typicalRange: insights.typicalRange, history: insights.history, fetchedAt: Date.now() });
  assert.equal(a.source, "google_flights");
  assert.equal(a.currentFare, 6420);
  assert.equal(a.forecast[0].fare, 6420);
  assert.equal(a.expectedFare, 5500); // midpoint of 4800–6200
  assert.ok(a.vsExpectedPct > 0); // high vs typical
  assert.equal(a.history.length, 10);
  assert.ok(a.volatilityPct >= 2 && a.volatilityPct <= 15);
  assert.equal(a.verdict, "monitor"); // Google says "high", 31 days out
});

test("Google 'low' price level means book now", () => {
  const a = adviseFare(5200, "2026-12-26", new Date("2026-11-25T06:00:00Z"), defaultFareModel, "BLRLKO", { lowestPrice: 4500, priceLevel: "low", history: [], fetchedAt: Date.now() });
  assert.equal(a.verdict, "book_now");
});

test("no live data → simulated source", () => {
  const a = adviseFare(5200, "2026-12-26", new Date("2026-11-25T06:00:00Z"), defaultFareModel, "BLRLKO");
  assert.equal(a.source, "simulated");
});
