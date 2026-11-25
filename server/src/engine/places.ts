// Any place in India, not just the seed list.
//  1. the hand-made seed (seed.ts): trains, Hindi names, seed co-travellers
//  2. airports with scheduled flights (OurAirports, public domain; built by scripts/build-airports.mjs)
//  3. anything else is looked up on OpenStreetMap (Nominatim), cached forever in SQLite
// Every place gets a nearest suitable airport (`hub`) plus a second choice (`altHub`).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { db } from "../db.ts";
import { trace } from "../bus.ts";
import { cities, cityByCode, findCity, notCoveredPlaces, registerPlace, type City } from "./seed.ts";

interface AirportRow { iata: string; name: string; city: string; lat: number; lng: number; size: "large" | "medium" | "small"; state?: string; aliases?: string[] }

const AIRPORTS_FILE = fileURLToPath(new URL("../data/airports-in.json", import.meta.url));
export const airports: AirportRow[] = existsSync(AIRPORTS_FILE) ? JSON.parse(readFileSync(AIRPORTS_FILE, "utf8")) : [];

const ROAD_FACTOR = 1.25; // straight line → road km, rough but fine for Indian highways
const MAX_AIRPORT_KM = 400; // farther than this, a flight stops making sense for the last mile

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const r = (d: number) => (d * Math.PI) / 180;
  const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export const roadKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.max(5, Math.round(haversineKm(a, b) * ROAD_FACTOR));

// ---- register airports (seed metros/hubs already use IATA codes; they keep their seed data)
for (const a of airports) {
  const seeded = cityByCode.get(a.iata);
  if (seeded?.source === "seed") {
    seeded.airportSize = a.size;
    seeded.state ??= a.state;
    continue;
  }
  // no IATA codes as aliases: "jai" (Jaipur) or "raj" (Rajkot) would match ordinary words in a sentence
  const aliases = [...new Set([a.city.toLowerCase(), ...(a.aliases ?? [])])];
  registerPlace({ code: a.iata, name: a.city, aliases, kind: a.size === "large" ? "metro" : "hub", lat: a.lat, lng: a.lng, state: a.state, source: "airport", airportSize: a.size });
}

/** Airport choice: a big airport a bit farther away usually beats a tiny one with a single daily flight. */
const SIZE_PENALTY = { large: 1, medium: 1.3, small: 2.2 } as const;
const isAirport = (c?: City) => Boolean(c && (c.airportSize || (c.source === "seed" && c.kind !== "town")));

export function nearestAirports(p: { lat: number; lng: number }, exclude?: string): { code: string; km: number }[] {
  const pool = [...cityByCode.values()].filter((c) => isAirport(c) && c.code !== exclude);
  const scored = pool
    .map((c) => ({ c, km: roadKm(p, c), size: c.airportSize ?? "medium" }))
    .filter((x) => x.km <= MAX_AIRPORT_KM)
    .sort((a, b) => a.km * SIZE_PENALTY[a.size] - b.km * SIZE_PENALTY[b.size]);
  if (!scored.length) return [];
  const best = scored[0];
  // second choice: the best airport that is bigger than the first (better connected), else simply the runner-up
  const rank = { large: 0, medium: 1, small: 2 };
  const bigger = scored.find((x) => x !== best && rank[x.size] < rank[best.size]);
  const alt = bigger ?? scored[1];
  return [best, alt].filter(Boolean).map((x) => ({ code: x.c.code, km: x.km }));
}

/** The airport a trip from / to this place flies through (the place itself if it has one). */
export const airportOf = (c: City) => (isAirport(c) ? c.code : c.hub);
export const altAirportOf = (c: City) => c.altHub;

// ---- looked-up places, persisted
db.exec(`
CREATE TABLE IF NOT EXISTS places (code TEXT PRIMARY KEY, data TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS geocode_cache (q TEXT PRIMARY KEY, code TEXT, ts INTEGER);
`);
for (const r of db.prepare("SELECT data FROM places").all() as { data: string }[]) {
  try { registerPlace(JSON.parse(r.data)); } catch {}
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 30) || "place";

// Nominatim usage policy: max 1 request/second, a real User-Agent, cache results, no autocomplete.
let nominatimQueue: Promise<unknown> = Promise.resolve();
const UA = "MargBandhu/0.6 (Festive Hacks 2026 demo; travel planner)";
const NEG_TTL = 24 * 3600_000;

/** Kinds of OSM results that are a place a person travels to (not a state, a river, a shop…). */
const SETTLEMENT = /^(city|town|village|hamlet|suburb|neighbourhood|quarter|borough|municipality|county|district|state_district|locality|isolated_dwelling|administrative|aerodrome|station|attraction|tourism)$/;

async function nominatim(q: string, convId: string | null): Promise<City | null> {
  const run = async () => {
    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, countrycodes: "in", format: "jsonv2", limit: "1", namedetails: "1", addressdetails: "1", "accept-language": "en" })}`;
    const t0 = performance.now();
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const [hit] = (await res.json()) as any[];
    const ms = Math.round(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 1100)); // spacing for the next caller
    if (!hit) {
      trace("engine", convId, { step: "place lookup", via: "OpenStreetMap", q, found: false, ms });
      return null;
    }
    const kind = String(hit.addresstype ?? hit.type ?? "");
    if (["state", "country", "region"].includes(kind) || (!SETTLEMENT.test(kind) && hit.place_rank < 12)) {
      trace("engine", convId, { step: "place lookup", via: "OpenStreetMap", q, found: false, reason: `too broad (${kind})`, ms });
      return null;
    }
    const lat = Number(hit.lat), lng = Number(hit.lon);
    const addr = hit.address ?? {};
    const name: string = hit.namedetails?.["name:en"] ?? hit.name ?? q;
    const hi: string | undefined = hit.namedetails?.["name:hi"];
    // "शिमला" is Shimla: if a city we already know has this name and is close by, it's that city (not a new place
    // 13 km from its own airport). Remember the spelling the user used.
    const same = findCity(name);
    if (same && haversineKm(same, { lat, lng }) < 40) {
      for (const a of [q.toLowerCase().trim(), ...(hi ? [hi] : [])]) if (!same.aliases.includes(a)) same.aliases.push(a);
      trace("engine", convId, { step: "place lookup", via: "OpenStreetMap", q, found: same.name, sameAs: same.code, ms });
      return withHub(same);
    }
    let code = `x-${slug(name)}`;
    const clash = cityByCode.get(code);
    if (clash && haversineKm(clash, { lat, lng }) > 20) code = `${code}-${slug(addr.state ?? "in").slice(0, 6)}`;
    const [hub, alt] = nearestAirports({ lat, lng });
    const c: City = {
      code, name, aliases: [...new Set([name.toLowerCase(), q.toLowerCase().trim(), ...(hi ? [hi] : [])])],
      kind: "town", lat, lng, state: addr.state, source: "geocoded",
      hub: hub?.code, kmFromHub: hub?.km, altHub: alt?.code,
    };
    db.prepare("INSERT INTO places (code, data, created) VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET data = excluded.data").run(code, JSON.stringify(c), Date.now());
    registerPlace(c);
    trace("engine", convId, { step: "place lookup", via: "OpenStreetMap", q, found: name, state: addr.state, airport: hub?.code, km: hub?.km, ms });
    return c;
  };
  const p = nominatimQueue.then(run, run);
  nominatimQueue = p.catch(() => {});
  return p as Promise<City | null>;
}

/** Make sure a place has an airport to fly through, plus a backup: for a small/medium airport city, the nearest
 * bigger airport (Shimla's airport has a flight or two a day; Chandigarh has many). */
export function withHub(c: City): City {
  if (isAirport(c)) {
    if (!c.altHub && c.airportSize !== "large") {
      const rank = { large: 0, medium: 1, small: 2 };
      const bigger = nearestAirports(c, c.code).map((x) => cityByCode.get(x.code)!).find((x) => rank[x.airportSize ?? "medium"] < rank[c.airportSize ?? "medium"]);
      if (bigger) c.altHub = bigger.code;
    }
    return c;
  }
  if (c.hub) return c;
  const [hub, alt] = nearestAirports(c);
  c.hub = hub?.code;
  c.kmFromHub = hub?.km;
  c.altHub = alt?.code;
  return c;
}

export type Resolved = { ok: true; city: City } | { ok: false; reason: "abroad" | "not_found" | "lookup_failed"; name: string };

/** One retry on a dropped connection / timeout (flaky networks), never on a real answer. */
async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (!/fetch failed|timeout|aborted|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(String(e))) throw e;
    await new Promise((r) => setTimeout(r, 800));
    return fn();
  }
}

/** Code or free-text name → a place we can plan with. */
export async function resolvePlace(input: string, convId: string | null): Promise<Resolved> {
  const raw = input.trim().slice(0, 80);
  const known = cityByCode.get(raw) ?? cityByCode.get(raw.toUpperCase()) ?? findCity(raw);
  if (known) return { ok: true, city: withHub(known) };
  const lower = raw.toLowerCase();
  const abroad = notCoveredPlaces.find(([, ...aliases]) => aliases.includes(lower));
  if (abroad) return { ok: false, reason: "abroad", name: abroad[0] };
  const cached = db.prepare("SELECT code, ts FROM geocode_cache WHERE q = ?").get(lower) as { code: string | null; ts: number } | undefined;
  if (cached?.code && cityByCode.get(cached.code)) return { ok: true, city: cityByCode.get(cached.code)! };
  if (cached && !cached.code && Date.now() - cached.ts < NEG_TTL) return { ok: false, reason: "not_found", name: raw };
  try {
    const c = await retryOnce(() => nominatim(raw, convId));
    db.prepare("INSERT INTO geocode_cache (q, code, ts) VALUES (?,?,?) ON CONFLICT(q) DO UPDATE SET code = excluded.code, ts = excluded.ts").run(lower, c?.code ?? null, Date.now());
    return c ? { ok: true, city: c } : { ok: false, reason: "not_found", name: raw };
  } catch (e) {
    trace("engine", convId, { step: "place lookup", via: "OpenStreetMap", q: raw, error: String(e).slice(0, 160) });
    return { ok: false, reason: "lookup_failed", name: raw }; // not cached: try again next time
  }
}

/** Type-ahead for the form: seed places, airport cities and places looked up before. Local only (no OSM calls). */
export function suggestPlaces(q: string, limit = 8) {
  const t = q.toLowerCase().trim();
  if (t.length < 2) return [];
  const all = [...cityByCode.values()];
  const score = (c: City) => {
    const names = [c.name.toLowerCase(), ...c.aliases];
    if (names.some((n) => n === t)) return 0;
    if (names.some((n) => n.startsWith(t))) return 1;
    if (names.some((n) => n.includes(t))) return 2;
    return 9;
  };
  const rank = { seed: 0, airport: 1, geocoded: 2 } as const;
  return all
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || rank[a.c.source ?? "geocoded"] - rank[b.c.source ?? "geocoded"] || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map(({ c }) => ({ code: c.code, name: c.name, detail: placeDetail(c) }));
}

export function placeDetail(c: City) {
  if (isAirport(c)) return c.state ? `${c.state} · airport ${c.code}` : `airport ${c.code}`;
  const hub = c.hub ? cityByCode.get(c.hub) : undefined;
  return [c.state, hub ? `${c.kmFromHub} km from ${hub.name} airport` : undefined].filter(Boolean).join(" · ");
}

/** Code → display names, for every code a reply mentions (the web app has no copy of the place list). */
export function namesFor(codes: (string | undefined)[]) {
  const out: Record<string, string> = {};
  for (const code of codes) if (code && cityByCode.get(code)) out[code] = cityByCode.get(code)!.name;
  return out;
}

/** Place records a watcher pod needs to match riders (it has no database). */
export const placesFor = (codes: string[]) => [...new Set(codes)].map((c) => cityByCode.get(c)).filter((c): c is City => Boolean(c));

export const isSeedOrAirport = (c: City) => c.source === "seed" || c.source === "airport";
export { cities };
