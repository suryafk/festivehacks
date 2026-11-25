import { AIRPORT_TO_STATION_MIN, cab, cityByCode, flights, trains, type Mode } from "./seed.ts";
import { defaultFareModel, fareOn, type FareModel } from "./fares.ts";

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
}

const IST = "+05:30";
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00${IST}`).getTime();
const MIN = 60_000;
const addDays = (date: string, n: number) => new Date(new Date(date + "T00:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);
const dow = (date: string) => new Date(date + "T00:00:00Z").getUTCDay();

export const cabFare = (km: number) => Math.round((cab.baseFare + km * cab.perKm) / 10) * 10;
const cabMin = (km: number) => Math.round((km / cab.kmh) * 60);

function flightsOn(from: string, to: string, date: string, s: PlanSettings) {
  const r = flights.find((f) => f.from === from && f.to === to);
  if (!r) return [];
  return r.deps.map((d, i) => {
    const depart = at(date, d);
    return {
      depart,
      arrive: depart + r.durMin * MIN,
      name: `${r.airline[i % r.airline.length]} ${from}→${to}`,
      fare: fareOn(r.baseFare, date, s.today, s.fareModel, `${from}${to}${d}`),
      baseFare: r.baseFare,
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
    tags,
    ...extra,
  };
}

export function plan(trip: Required<Pick<Trip, "origin" | "destination" | "date">> & Trip, s: PlanSettings): Itinerary[] {
  const modes = new Set<Mode>(trip.modes?.length ? trip.modes : ["flight", "train", "cab"]);
  const dest = cityByCode.get(trip.destination);
  if (!dest) return [];
  const flex = Math.min(trip.flexDays ?? 1, 3);
  const results: Itinerary[] = [];

  for (let off = -flex; off <= flex; off++) {
    const date = addDays(trip.date, off);
    if (new Date(date + "T23:59:59" + IST).getTime() < s.today.getTime()) continue;
    const dateTag = off === 0 ? [] : [off < 0 ? `${-off}d early` : `${off}d later`];

    // 1) direct flight to a hub / metro
    if (modes.has("flight") && dest.kind !== "town") {
      for (const f of flightsOn(trip.origin, dest.code, date, s))
        results.push(itin("Direct flight", [{ mode: "flight", from: trip.origin, to: dest.code, ...f }], date, dateTag, {
          flight: { from: trip.origin, to: dest.code, baseFare: f.baseFare, date },
        }));
    }

    if (dest.kind === "town" && dest.hub) {
      const hub = dest.hub;
      const fl = modes.has("flight") ? flightsOn(trip.origin, hub, date, s) : [];
      for (const f of fl) {
        const flightLeg: Leg = { mode: "flight", from: trip.origin, to: hub, ...f };
        const flightInfo = { from: trip.origin, to: hub, baseFare: f.baseFare, date };
        // 2) flight + train
        if (modes.has("train")) {
          const toStation = AIRPORT_TO_STATION_MIN[hub] ?? 40;
          const tr = trainsAfter(hub, dest.code, f.arrive + (toStation + s.bufferMin) * MIN)[0];
          if (tr && tr.depart - f.arrive < 10 * 60 * MIN) {
            const transfer: Leg = { mode: "transfer", from: hub, to: hub, depart: f.arrive, arrive: f.arrive + toStation * MIN, name: "Airport → railway station (metro/auto)", fare: 150 };
            results.push(itin("Flight + train", [flightLeg, transfer, tr], date, [...dateTag, `${Math.round((tr.depart - f.arrive) / MIN)} min connection`], { flight: flightInfo }));
          }
        }
        // 3) flight + (shared) cab
        if (modes.has("cab") && dest.kmFromHub) {
          const km = dest.kmFromHub;
          const depart = f.arrive + 25 * MIN; // bags + cab pickup
          const cabLeg: Leg = { mode: "cab", from: hub, to: dest.code, depart, arrive: depart + cabMin(km) * MIN, name: `Outstation cab (${km} km)`, fare: cabFare(km), note: "solo fare; pooling can cut this" };
          results.push(itin("Flight + cab", [flightLeg, cabLeg], date, [...dateTag, "poolable"], {
            flight: flightInfo,
            pool: { hub, town: dest.code, km, arriveAt: f.arrive, soloFare: cabFare(km) },
          }));
        }
      }
    }

    // 4) train only (direct, or via hub)
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
