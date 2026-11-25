import { cityByCode } from "./seed.ts";
import { cabFare } from "./planner.ts";

export interface Rider {
  id: string;
  name: string;
  hub: string;
  town: string;
  arriveAt: number; // epoch ms at hub airport
  dropKm: number;
}

export interface SplitWeights {
  maxRiders: number;
  windowMin: number; // ± arrival window
  corridorDeg: number; // max bearing difference to share a cab
  detourKmPerStop: number; // extra km added per intermediate drop
}

export const defaultSplitWeights: SplitWeights = { maxRiders: 4, windowMin: 60, corridorDeg: 35, detourKmPerStop: 6 };

export function bearing(fromCode: string, toCode: string) {
  const a = cityByCode.get(fromCode)!;
  const b = cityByCode.get(toCode)!;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export function compatible(a: Rider, b: Rider, w: SplitWeights) {
  if (a.hub !== b.hub) return false;
  if (Math.abs(a.arriveAt - b.arriveAt) > w.windowMin * 60_000) return false;
  if (a.town === b.town) return true;
  return angleDiff(bearing(a.hub, a.town), bearing(b.hub, b.town)) <= w.corridorDeg;
}

/** Pick the best group for `me` out of `candidates` (closest arrival first, all mutually compatible). */
export function matchGroup(me: Rider, candidates: Rider[], w: SplitWeights): Rider[] {
  const sorted = candidates
    .filter((c) => c.id !== me.id && compatible(me, c, w))
    .sort((a, b) => Math.abs(a.arriveAt - me.arriveAt) - Math.abs(b.arriveAt - me.arriveAt));
  const group = [me];
  for (const c of sorted) {
    if (group.length >= w.maxRiders) break;
    if (group.every((g) => compatible(g, c, w))) group.push(c);
  }
  return group;
}

export interface SplitLine {
  riderId: string;
  name: string;
  town: string;
  dropKm: number;
  pays: number;
  soloFare: number;
  saves: number;
  segments: { fromKm: number; toKm: number; sharedWith: number; cost: number }[];
}

export interface Split {
  totalFare: number;
  totalKm: number;
  departAt: number;
  lines: SplitLine[];
  method: string;
}

/**
 * Segment-sharing split: the cab drives hub → drop 1 → drop 2 → … Each stretch of road costs the same per km,
 * and everyone still in the cab on that stretch shares it equally. Whoever gets off first pays least.
 */
export function splitFare(group: Rider[], w: SplitWeights): Split {
  const byDrop = [...group].sort((a, b) => a.dropKm - b.dropKm);
  const stops = new Set(byDrop.map((r) => r.town)).size;
  const totalKm = byDrop[byDrop.length - 1].dropKm + Math.max(0, stops - 1) * w.detourKmPerStop;
  const totalFare = cabFare(totalKm);
  const perKm = totalFare / totalKm;
  const marks = [0, ...Array.from(new Set(byDrop.map((r) => r.dropKm)))];
  const lines: SplitLine[] = byDrop.map((r) => ({ riderId: r.id, name: r.name, town: r.town, dropKm: r.dropKm, pays: 0, soloFare: cabFare(r.dropKm), saves: 0, segments: [] }));
  for (let i = 1; i < marks.length; i++) {
    const [fromKm, toKm] = [marks[i - 1], marks[i]];
    const onboard = lines.filter((l) => l.dropKm >= toKm);
    const segKm = toKm - fromKm + (i > 1 ? w.detourKmPerStop : 0);
    const cost = segKm * perKm;
    for (const l of onboard) {
      l.pays += cost / onboard.length;
      l.segments.push({ fromKm, toKm, sharedWith: onboard.length, cost: Math.round(cost / onboard.length) });
    }
  }
  // round to ₹10 and make the total add up exactly
  let acc = 0;
  lines.forEach((l, i) => {
    l.pays = i === lines.length - 1 ? totalFare - acc : Math.round(l.pays / 10) * 10;
    acc += l.pays;
    l.saves = Math.max(0, l.soloFare - l.pays);
  });
  const departAt = Math.max(...group.map((g) => g.arriveAt)) + 20 * 60_000;
  return { totalFare, totalKm, departAt, lines, method: "segment-sharing: each stretch of road is split equally among riders still in the cab" };
}
