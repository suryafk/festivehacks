#!/usr/bin/env node
// Backtest the fare pointer on every price history we have stored (fare_obs: Google Flights history + our own
// live searches). For each past day: decide "book now" or "watch it" with only what was known that day, then
// check the next 7 days. Compares with simply booking at once.
//   node scripts/backtest-fares.mts [path/to/marg-bandhu.db]
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { backtest } from "../server/src/engine/fareStats.ts";

const file = process.argv[2] ?? fileURLToPath(new URL("../server/data/marg-bandhu.db", import.meta.url));
const db = new DatabaseSync(file, { readOnly: true });
const series = db.prepare("SELECT route, travel_date FROM fare_obs GROUP BY route, travel_date ORDER BY route").all() as { route: string; travel_date: string }[];
if (!series.length) {
  console.log("No stored fare histories yet: plan a few trips with live fares first.");
  process.exit(0);
}
let days = 0, right = 0, sRight = 0, baseRight = 0, mCalls = 0, mRight = 0;
console.log("route                travel date   days  rules  +self-check  always-book  'watch it' calls (right)");
for (const s of series) {
  const h = (db.prepare("SELECT seen_on AS date, fare FROM fare_obs WHERE route = ? AND travel_date = ? ORDER BY seen_on").all(s.route, s.travel_date) as { date: string; fare: number }[]);
  const bt = backtest(h);
  const sc = backtest(h, 21, 7, true);
  if (!bt.days) continue;
  days += bt.days;
  right += Math.round((bt.accuracy * bt.days) / 100);
  sRight += Math.round((sc.accuracy * sc.days) / 100);
  baseRight += Math.round((bt.alwaysBookAccuracy * bt.days) / 100);
  mCalls += bt.monitorCalls;
  mRight += bt.monitorRight;
  console.log(`${s.route.padEnd(20)} ${s.travel_date}  ${String(bt.days).padStart(4)}  ${String(bt.accuracy).padStart(4)}%  ${String(sc.accuracy).padStart(10)}%  ${String(bt.alwaysBookAccuracy).padStart(10)}%  ${bt.monitorCalls} (${bt.monitorRight}) → ${sc.monitorCalls} (${sc.monitorRight})`);
}
if (days) console.log(`\nall routes: ${days} days · rules ${Math.round((right / days) * 100)}% · with self-check ${Math.round((sRight / days) * 100)}% · always booking ${Math.round((baseRight / days) * 100)}% · raw 'watch it' right ${mRight} of ${mCalls}`);
console.log("(\"right\" = 'watch it' followed by a 5%+ drop within 7 days, or 'book now' not followed by one. Google's price level and the days-out rules aren't replayed.)");
