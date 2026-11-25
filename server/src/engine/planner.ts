import { AIRPORT_TO_STATION_MIN, cab, cityByCode, flights, trains, type City, type FlightRoute, type Mode } from "./seed.ts";
import { defaultFareModel, fareOn, type FareModel } from "./fares.ts";
import type { LiveFlight } from "../integrations/googleFlights.ts";

export interface Trip {
  origin?: string; // city code
  destination?: string; // city code
  date?: string; // YYYY-MM-DD
  flexDays?: number;
  modes?: Mode[];
  travellers?: number;
}

export interface Leg {
  mode: Mode | "transfer";
  from: string;
  to: string;
  depart: number; // epoch ms
  arrive: number;
  name: string;
  fare: number;
  note?: string;
}

export interface Itinerary {
  id: string;
  label: string;
  legs: Leg[];
  depart: number;
  arrive: number;
  totalMin: number;
  totalFare: number;
  date: string;
  tags: string[];
  flight?: { from: string; to: string; baseFare: number; date: string };
  pool?: { hub: string; town: string; km: number; arriveAt: number; soloFare: number };
}

export interface PlanSettings {
  bufferMin: number; // min connection buffer flight→train
  fareModel: FareModel;
  today: Date;
  /** Real schedules + prices from Google Flights, keyed "FROM-TO-YYYY-MM-DD". Missing keys use the simulated timetable. */
  live?: Map<string, LiveFlight[]>;
  /** Airports to fly between (chosen by the engine, e.g. the backup airport when the nearest has no flights). */
  airports?: { origin?: string; dest?: string };
  /** "FROM-TO" airport pairs that Google Flights says have no flights: don't invent simulated ones. */
  noFlights?: Set<string>;
}

const MAX_CAB_KM = 700; // "cab all the way" only for trips a person would actually drive in a day
const ROAD_FACTOR = 1.25;
const kmBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.max(5, Math.round(2 * 6371 * Math.asin(Math.sqrt(x)) * ROAD_FACTOR));
};
const hasAirport = (c: City) => Boolean(c.airportSize || (c.source === "seed" && c.kind !== "town"));
/** The airport this place flies through: itself, or its nearest suitable airport. */
export const airportFor = (c: City) => (hasAirport(c) ? c.code : c.hub);

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const DEPS = ["05:40", "07:15", "09:30", "12:05", "14:50", "17:35", "20:10"];

/** Seed timetable if we have one, else a plausible one from the distance (clearly marked simulated). */
export function routeFor(from: string, to: string): FlightRoute | undefined {
  const seeded = flights.find((f) => f.from === from && f.to === to);
  if (seeded) return seeded;
  const a = cityByCode.get(from), b = cityByCode.get(to);
  if (!a || !b || from === to) return undefined;
  const km = kmBetween(a, b) / ROAD_FACTOR; // air distance
  if (km < 150) return undefined; // nobody flies that
  const h = hash(`${from}${to}`);
  const small = a.airportSize === "small" || b.airportSize === "small";
  const n = small ? 1 + (h % 2) : 3 + (h % 3);
  return {
    from, to,
    // n departure slots, picked deterministically per route
    deps: DEPS.map((d, i) => ({ d, k: hash(`${from}${to}${i}`) })).sort((x, y) => x.k - y.k).slice(0, n).map((x) => x.d).sort(),
    durMin: Math.round((35 + (km / 760) * 60) / 5) * 5,
    baseFare: Math.round((2300 + km * 3.3) / 50) * 50,
    airline: ["IndiGo", "Air India Express", "Akasa Air"],
  };
}

const IST = "+05:30";
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00${IST}`).getTime();
const MIN = 60_000;
const addDays = (date: string, n: number) => new Date(new Date(date + "T00:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);
const dow = (date: string) => new Date(date + "T00:00:00Z").getUTCDay();

export const cabFare = (km: number) => Math.round((cab.baseFare + km * cab.perKm) / 10) * 10;
const cabMin = (km: number) => Math.round((km / cab.kmh) * 60);

function flightsOn(from: string, to: string, date: string, s: PlanSettings) {
  if (s.noFlights?.has(`${from}-${to}`)) return [];
  const r = routeFor(from, to);
  const live = s.live?.get(`${from}-${to}-${date}`);
  if (live?.length) {
    // nonstop first, then the cheapest few, so the planner sees realistic choices without 30 near-duplicates
    const picks = [...live].sort((a, b) => a.stops - b.stops || a.price - b.price).slice(0, 8);
    return picks.map((f) => ({
      depart: f.depart,
      arrive: f.arrive,
      name: `${f.airline} ${f.flightNumber}`.trim() + (f.stops ? ` (${f.stops} stop)` : ""),
      fare: f.price,
      baseFare: r?.baseFare ?? f.price,
      note: "live fare · Google Flights",
    }));
  }
  if (!r) return [];
  const simFare = (d: string, dt: string) => fareOn(r.baseFare, dt, s.today, s.fareModel, `${from}${to}${d}`);
  // If we have real Google fares for this route on another date (e.g. the requested date while this is a ±flex day),
  // scale the simulated fares to real market level, so a cheap model fare can't beat real ones unfairly.
  let ratio = 1;
  let calibrated = false;
  for (const [k, lv] of s.live ?? []) {
    if (!k.startsWith(`${from}-${to}-`) || !lv.length) continue;
    const liveDate = k.slice(`${from}-${to}-`.length);
    const simMin = Math.min(...r.deps.map((d) => simFare(d, liveDate)));
    ratio = Math.min(...lv.map((f) => f.price)) / simMin;
    calibrated = true;
    break;
  }
  return r.deps.map((d, i) => {
    const depart = at(date, d);
    return {
      depart,
      arrive: depart + r.durMin * MIN,
      name: `${r.airline[i % r.airline.length]} ${from}→${to}`,
      fare: Math.round((simFare(d, date) * ratio) / 10) * 10,
      baseFare: r.baseFare,
      note: calibrated ? "estimated · scaled to live Google Flights prices" : "simulated fare",
    };
  });
}

function trainsAfter(from: string, to: string, earliest: number) {
  const out: Leg[] = [];
  for (let dayShift = 0; dayShift <= 1; dayShift++) {
    const date = addDays(new Date(earliest + 5.5 * 3600_000).toISOString().slice(0, 10), dayShift);
    for (const t of trains.filter((t) => t.from === from && t.to === to)) {
      if (t.days && !t.days.includes(dow(date))) continue;
      const depart = at(date, t.dep);
      if (depart < earliest) continue;
      out.push({ mode: "train", from, to, depart, arrive: depart + t.durMin * MIN, name: t.name, fare: t.fare, note: "3A, simulated" });
    }
  }
  return out.sort((a, b) => a.depart - b.depart);
}

function itin(label: string, legs: Leg[], date: string, tags: string[], extra: Partial<Itinerary> = {}): Itinerary {
  const depart = legs[0].depart;
  const arrive = legs[legs.length - 1].arrive;
  return {
    id: `${label}-${depart}`.replace(/\W+/g, "-").toLowerCase(),
    label,
    legs,
    depart,
    arrive,
    totalMin: Math.round((arrive - depart) / MIN),
    totalFare: legs.reduce((a, l) => a + l.fare, 0),
    date,
    tags: [...tags], // own copy: "recommended" etc. are added per itinerary later
    ...extra,
  };
}

export function plan(trip: Required<Pick<Trip, "origin" | "destination" | "date">> & Trip, s: PlanSettings): Itinerary[] {
  const modes = new Set<Mode>(trip.modes?.length ? trip.modes : ["flight", "train", "cab"]);
  const orig = cityByCode.get(trip.origin);
  const dest = cityByCode.get(trip.destination);
  if (!orig || !dest || orig.code === dest.code) return [];
  const flex = Math.min(trip.flexDays ?? 1, 3);
  const results: Itinerary[] = [];

  const oA = s.airports?.origin ?? airportFor(orig);
  const dA = s.airports?.dest ?? airportFor(dest);
  const oAirport = oA ? cityByCode.get(oA) : undefined;
  const dAirport = dA ? cityByCode.get(dA) : undefined;
  const firstKm = oAirport && oA !== orig.code ? kmBetween(orig, oAirport) : 0;
  const lastKm = dAirport && dA !== dest.code ? (dest.hub === dA && dest.kmFromHub ? dest.kmFromHub : kmBetween(dAirport, dest)) : 0;
  const totalRoadKm = kmBetween(orig, dest);

  for (let off = -flex; off <= flex; off++) {
    const date = addDays(trip.date, off);
    if (new Date(date + "T23:59:59" + IST).getTime() < s.today.getTime()) continue;
    const dateTag = off === 0 ? [] : [off < 0 ? `${-off}d early` : `${off}d later`];

    if (modes.has("flight") && oA && dA && oA !== dA) {
      for (const f of flightsOn(oA, dA, date, s)) {
        const flightLeg: Leg = { mode: "flight", from: oA, to: dA, ...f };
        const flightInfo = { from: oA, to: dA, baseFare: f.baseFare, date };
        // 0) no airport at home: a cab to the airport first, arriving 90 min before departure
        const pre: Leg[] = [];
        if (firstKm) {
          const arrive = f.depart - 90 * MIN;
          pre.push({ mode: "cab", from: orig.code, to: oA, depart: arrive - cabMin(firstKm) * MIN, arrive, name: `Cab to ${oAirport!.name} airport (${firstKm} km)`, fare: cabFare(firstKm) });
        }
        // 1) the destination has its own airport
        if (dA === dest.code) {
          results.push(itin(pre.length ? "Cab + flight" : "Direct flight", [...pre, flightLeg], date, dateTag, { flight: flightInfo }));
          continue;
        }
        // 2) flight + train (only where we have train data)
        if (modes.has("train")) {
          const toStation = AIRPORT_TO_STATION_MIN[dA] ?? 40;
          const tr = trainsAfter(dA, dest.code, f.arrive + (toStation + s.bufferMin) * MIN)[0];
          if (tr && tr.depart - f.arrive < 10 * 60 * MIN) {
            const transfer: Leg = { mode: "transfer", from: dA, to: dA, depart: f.arrive, arrive: f.arrive + toStation * MIN, name: "Airport → railway station (metro/auto)", fare: 150 };
            results.push(itin(pre.length ? "Cab + flight + train" : "Flight + train", [...pre, flightLeg, transfer, tr], date, [...dateTag, `${Math.round((tr.depart - f.arrive) / MIN)} min connection`], { flight: flightInfo }));
          }
        }
        // 3) flight + (shared) cab for the last mile
        if (modes.has("cab") && lastKm) {
          const depart = f.arrive + 25 * MIN; // bags + cab pickup
          const cabLeg: Leg = { mode: "cab", from: dA, to: dest.code, depart, arrive: depart + cabMin(lastKm) * MIN, name: `Outstation cab (${lastKm} km)`, fare: cabFare(lastKm), note: "solo fare; pooling can cut this" };
          results.push(itin(pre.length ? "Cab + flight + cab" : "Flight + cab", [...pre, flightLeg, cabLeg], date, [...dateTag, "poolable"], {
            flight: flightInfo,
            pool: { hub: dA, town: dest.code, km: lastKm, arriveAt: f.arrive, soloFare: cabFare(lastKm) },
          }));
        }
      }
    }

    // 4) cab all the way (short trips: Delhi → Shimla, Lucknow → Gonda)
    if (modes.has("cab") && totalRoadKm <= MAX_CAB_KM && off === 0) { // same price any day: show it once
      const depart = at(date, totalRoadKm > 350 ? "05:30" : "08:00");
      results.push(itin("Cab all the way", [{ mode: "cab", from: orig.code, to: dest.code, depart, arrive: depart + cabMin(totalRoadKm) * MIN, name: `Outstation cab (${totalRoadKm} km)`, fare: cabFare(totalRoadKm), note: "door to door, estimated fare" }], date, [...dateTag, "door to door"]));
    }

    // 5) train only (direct, or via the hub): seed timetables only
    if (modes.has("train")) {
      const dayStart = at(date, "00:00");
      for (const t of trainsAfter(trip.origin, dest.code, dayStart).filter((t) => t.depart < dayStart + 86_400_000))
        results.push(itin("Direct train", [t], date, [...dateTag, "no flight"]));
      if (dest.hub) {
        for (const t1 of trainsAfter(trip.origin, dest.hub, dayStart).filter((t) => t.depart < dayStart + 86_400_000)) {
          const t2 = trainsAfter(dest.hub, dest.code, t1.arrive + s.bufferMin * MIN)[0];
          if (t2) results.push(itin("Train + train", [t1, t2], date, [...dateTag, "no flight"]));
        }
      }
    }
  }

  // score: hours are worth ~₹250 each to this traveller, odd hours and off-date cost a bit extra
  const score = (i: Itinerary) => {
    const hourIST = new Date(i.arrive + 5.5 * 3600_000).getUTCHours();
    const lateNight = hourIST >= 23 || hourIST < 5 ? 900 : 0;
    const offDate = i.date === trip.date ? 0 : 600;
    return i.totalFare + (i.totalMin / 60) * 250 + lateNight + offDate;
  };
  results.sort((a, b) => score(a) - score(b));

  // keep the best of each kind, then fill
  const picked: Itinerary[] = [];
  for (const r of results) if (!picked.some((p) => p.label === r.label)) picked.push(r);
  for (const r of results) if (picked.length < 4 && !picked.includes(r)) picked.push(r);
  const top = picked.slice(0, 4).sort((a, b) => score(a) - score(b));
  if (top[0]) top[0].tags.unshift("recommended");
  const fastest = [...top].sort((a, b) => a.totalMin - b.totalMin)[0];
  if (fastest && !fastest.tags.includes("fastest")) fastest.tags.push("fastest");
  const cheapest = [...top].sort((a, b) => a.totalFare - b.totalFare)[0];
  if (cheapest && !cheapest.tags.includes("cheapest")) cheapest.tags.push("cheapest");
  return top;
}
