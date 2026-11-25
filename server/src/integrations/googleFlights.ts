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
// Our own price history: every daily lowest fare we have seen for a route + travel date, from Google's history
// and from each live search. Grows beyond Google's ~60-day window, and is what the fare analysis reads.
db.exec(`CREATE TABLE IF NOT EXISTS fare_obs (route TEXT, travel_date TEXT, seen_on TEXT, fare INTEGER, source TEXT, PRIMARY KEY (route, travel_date, seen_on))`);
const istDay = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);

function storeObservations(route: string, date: string, p: Omit<LiveFares, "fetchedAt" | "cached">, seenAt = Date.now()) {
  const ins = db.prepare("INSERT INTO fare_obs (route, travel_date, seen_on, fare, source) VALUES (?,?,?,?,?) ON CONFLICT DO UPDATE SET fare = excluded.fare, source = excluded.source");
  db.exec("BEGIN");
  try {
    for (const h of p.insights.history) ins.run(route, date, h.date, Math.round(h.fare), "google_history");
    const lowest = p.insights.lowestPrice ?? (p.flights.length ? Math.min(...p.flights.map((f) => f.price)) : undefined);
    if (lowest) ins.run(route, date, istDay(seenAt), Math.round(lowest), "live_search");
    db.exec("COMMIT");
  } catch {
    db.exec("ROLLBACK");
  }
}

/** Google's history merged with everything we've stored for this route + date (one point per day). */
function withStoredHistory(route: string, date: string, history: { date: string; fare: number }[]) {
  const rows = db.prepare("SELECT seen_on, fare FROM fare_obs WHERE route = ? AND travel_date = ?").all(route, date) as { seen_on: string; fare: number }[];
  const byDay = new Map(rows.map((r) => [r.seen_on, r.fare]));
  for (const h of history) byDay.set(h.date, h.fare);
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, fare]) => ({ date: d, fare }));
}

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
    storeObservations(`${from}-${to}`, date, data, hit.ts); // idempotent; backfills searches made before fare_obs existed
    data.insights.history = withStoredHistory(`${from}-${to}`, date, data.insights.history);
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
    const url = `${process.env.SERPAPI_BASE ?? "https://serpapi.com"}/search.json?${q}`;
    // one retry on a dropped connection (not on an API error, which would just spend another search)
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(async (e) => {
      if (!/fetch failed|ECONNRESET|EAI_AGAIN/i.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 800));
      return fetch(url, { signal: AbortSignal.timeout(20_000) });
    });
    const j = (await res.json()) as any;
    // "Google Flights hasn't returned any results": a real answer (no flights on this route), not an outage.
    const noResults = /hasn't returned any results|no results/i.test(String(j?.error ?? ""));
    if ((!res.ok || j?.error) && !noResults) throw new Error(String(j?.error ?? `HTTP ${res.status}`).slice(0, 200));
    const parsed = noResults ? { flights: [], insights: { history: [] } } : parseSerpApi(j);
    db.prepare("INSERT INTO fare_cache (k, ts, data) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET ts = excluded.ts, data = excluded.data").run(k, Date.now(), JSON.stringify(parsed));
    storeObservations(`${from}-${to}`, date, parsed);
    parsed.insights.history = withStoredHistory(`${from}-${to}`, date, parsed.insights.history);
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
