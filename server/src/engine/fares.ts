// Simulated fare model: "when should I book?".
// fare(travelDate, bookedOn) = base × festiveSurge(travelDate) × leadTimeCurve(daysOut) × noise
import { festivals } from "./seed.ts";

export interface FareModel {
  festiveSurgePct: number; // extra % on festive travel dates
  festiveWindowDays: number; // ± days around a festival that count as "festive"
  sweetSpotDays: [number, number]; // cheapest booking window (days before travel)
  lastMinutePct: number; // extra % when booking inside 7 days
}

export const defaultFareModel: FareModel = {
  festiveSurgePct: 38,
  festiveWindowDays: 5,
  sweetSpotDays: [21, 45],
  lastMinutePct: 70,
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
  verdict: "book_now" | "wait";
  currentFare: number;
  bestFare: number;
  bestBookBy: string; // ISO date
  daysOut: number;
  festival?: string;
  savings: number;
  riseAfter?: string; // date after which fares jump
  history: { date: string; fare: number }[]; // past 21 days (simulated)
  forecast: { date: string; fare: number }[]; // until travel date
}

const iso = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

export function adviseFare(baseFare: number, travelDate: string, today: Date, m: FareModel, key: string): FareAdvice {
  const t0 = toDay(today);
  const travel = toDay(travelDate);
  const daysOut = travel - t0;
  const history = [];
  for (let d = t0 - 21; d < t0; d++) history.push({ date: iso(d), fare: fareOn(baseFare, travelDate, new Date(d * DAY), m, key) });
  const forecast = [];
  for (let d = t0; d <= travel; d++) forecast.push({ date: iso(d), fare: fareOn(baseFare, travelDate, new Date(d * DAY), m, key) });

  const current = forecast[0]?.fare ?? baseFare;
  // only consider the next 10 days of waiting — beyond that the risk of sell-out in festive season is real
  const horizon = forecast.slice(0, Math.min(10, forecast.length));
  const best = horizon.reduce((a, b) => (b.fare < a.fare ? b : a), horizon[0] ?? { date: iso(t0), fare: current });
  const jump = forecast.find((f, i) => i > 0 && f.fare > current * 1.12);
  const savings = current - best.fare;
  const fest = festiveFor(travelDate, m);
  const verdict = savings > Math.max(250, current * 0.05) && !(fest && daysOut < 21) ? "wait" : "book_now";
  return {
    verdict,
    currentFare: current,
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
