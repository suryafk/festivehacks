// Live fares from Google Flights via SerpApi (engine=google_flights).
// Free plan = 250 searches/month, so every (route, date) result is cached in SQLite for 6 hours,
// and the Flagsmith flag `live_fares_enabled` can switch it off without a redeploy.
// Any failure returns null and the caller falls back to the simulated fare model.
import { db } from "../db.ts";
import { trace } from "../bus.ts";

const KEY = () => process.env.SERPAPI_KEY ?? "";
export const hasGoogleFlights = () => Boolean(KEY());
const TTL_MS = 6 * 3600_000;

db.exec(`CREATE TABLE IF NOT EXISTS fare_cache (k TEXT PRIMARY KEY, ts INTEGER, data TEXT)`);

export interface LiveFlight {
  depart: number; // epoch ms
  arrive: number;
  durMin: number;
  airline: string;
  flightNumber: string;
  price: number; // INR, one adult, one way
  stops: number;
}

export interface LiveInsights {
  lowestPrice?: number;
  priceLevel?: string; // "low" | "typical" | "high"
  typicalRange?: [number, number];
  history: { date: string; fare: number }[]; // one point per day, oldest first
}

export interface LiveFares {
  flights: LiveFlight[];
  insights: LiveInsights;
  fetchedAt: number;
  cached: boolean;
}

/** Google returns local airport times like "2026-12-26 09:30" (IST for every airport we serve). */
const istTime = (s: string) => new Date(s.replace(" ", "T") + ":00+05:30").getTime();

export function parseSerpApi(j: any): Omit<LiveFares, "fetchedAt" | "cached"> {
  const options = [...(j?.best_flights ?? []), ...(j?.other_flights ?? [])];
  const flights: LiveFlight[] = [];
  for (const o of options) {
    const segs = Array.isArray(o?.flights) ? o.flights : [];
    if (!segs.length || typeof o.price !== "number") continue;
    const first = segs[0];
    const last = segs[segs.length - 1];
    const depart = istTime(String(first?.departure_airport?.time ?? ""));
    const arrive = istTime(String(last?.arrival_airport?.time ?? ""));
    if (!Number.isFinite(depart) || !Number.isFinite(arrive)) continue;
    flights.push({
      depart,
      arrive,
      durMin: Number(o.total_duration) || Math.round((arrive - depart) / 60_000),
      airline: String(first.airline ?? "Airline"),
      flightNumber: String(first.flight_number ?? ""),
      price: o.price,
      stops: segs.length - 1,
    });
  }
  const pi = j?.price_insights ?? {};
  // price_history: [[unix_seconds, price], ...] — keep the last point per calendar day (IST)
  const byDay = new Map<string, number>();
  for (const p of Array.isArray(pi.price_history) ? pi.price_history : []) {
    if (!Array.isArray(p) || p.length < 2 || typeof p[1] !== "number") continue;
    const ms = p[0] > 1e12 ? p[0] : p[0] * 1000;
    byDay.set(new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10), p[1]);
  }
  const history = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, fare]) => ({ date, fare }));
  const range = Array.isArray(pi.typical_price_range) && pi.typical_price_range.length === 2 ? (pi.typical_price_range as [number, number]) : undefined;
  return {
    flights: flights.sort((a, b) => a.depart - b.depart),
    insights: { lowestPrice: typeof pi.lowest_price === "number" ? pi.lowest_price : undefined, priceLevel: pi.price_level, typicalRange: range, history },
  };
}

export async function getLiveFares(from: string, to: string, date: string, convId: string | null): Promise<LiveFares | null> {
  if (!hasGoogleFlights()) return null;
  const k = `${from}-${to}-${date}`;
  const hit = db.prepare("SELECT ts, data FROM fare_cache WHERE k = ?").get(k) as { ts: number; data: string } | undefined;
  if (hit && Date.now() - hit.ts < TTL_MS) {
    const data = JSON.parse(hit.data);
    trace("flights", convId, { api: "google_flights", route: `${from}→${to}`, date, cached: true, flights: data.flights.length, historyDays: data.insights.history.length });
    return { ...data, fetchedAt: hit.ts, cached: true };
  }
  const q = new URLSearchParams({
    engine: "google_flights",
    departure_id: from,
    arrival_id: to,
    outbound_date: date,
    type: "2", // one way
    currency: "INR",
    gl: "in",
    hl: "en",
    adults: "1",
    api_key: KEY(),
  });
  const t0 = performance.now();
  try {
    const res = await fetch(`${process.env.SERPAPI_BASE ?? "https://serpapi.com"}/search.json?${q}`, { signal: AbortSignal.timeout(20_000) });
    const j = (await res.json()) as any;
    if (!res.ok || j?.error) throw new Error(String(j?.error ?? `HTTP ${res.status}`).slice(0, 200));
    const parsed = parseSerpApi(j);
    if (!parsed.flights.length) throw new Error("no flights in response");
    db.prepare("INSERT INTO fare_cache (k, ts, data) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET ts = excluded.ts, data = excluded.data").run(k, Date.now(), JSON.stringify(parsed));
    trace("flights", convId, {
      api: "google_flights", route: `${from}→${to}`, date, ms: Math.round(performance.now() - t0),
      flights: parsed.flights.length, lowest: parsed.insights.lowestPrice, level: parsed.insights.priceLevel, historyDays: parsed.insights.history.length,
    });
    return { ...parsed, fetchedAt: Date.now(), cached: false };
  } catch (e) {
    trace("flights", convId, { api: "google_flights", route: `${from}→${to}`, date, error: String(e).slice(0, 200), fallback: "simulated" });
    return null;
  }
}
