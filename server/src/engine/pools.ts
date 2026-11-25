// Pool requests: created by the engine, claimed + matched by watcher pods, results applied here.
import { db, uid, j, convs } from "../db.ts";
import { pushToConv, trace } from "../bus.ts";
import { seedRiders, cityByCode } from "./seed.ts";
import { splitFare, type Rider, type SplitWeights, compatible } from "./pooling.ts";
import { t, langKey } from "./i18n.ts";
import { sendWhatsApp } from "../integrations/whatsapp.ts";
import { textToSpeech, translate } from "../integrations/sarvam.ts";
import { formatPoolMatchedForWhatsApp } from "../channels/waFormat.ts";

interface Row {
  id: string;
  conv_id: string | null;
  name: string;
  hub: string;
  town: string;
  arrive_at: number;
  drop_km: number;
  status: string;
  pool_id: string | null;
  synthetic: number;
}

const toRider = (r: Row): Rider => ({ id: r.id, name: r.name, hub: r.hub, town: r.town, arriveAt: r.arrive_at, dropKm: r.drop_km });

export function ensureSeedRiders(hub: string, arriveAt: number) {
  // Keep every seeded traveller "around" this arrival time (refills after they get matched, so each visitor sees a lively map).
  const has = db.prepare("SELECT 1 FROM pool_requests WHERE synthetic = 1 AND hub = ? AND name = ? AND status = 'waiting' AND ABS(arrive_at - ?) < 10800000");
  const ins = db.prepare("INSERT INTO pool_requests (id, conv_id, name, hub, town, arrive_at, drop_km, synthetic, created) VALUES (?,?,?,?,?,?,?,1,?)");
  for (const s of seedRiders.filter((s) => s.hub === hub))
    if (!has.get(hub, s.name, arriveAt)) ins.run(uid(), null, s.name, s.hub, s.to, arriveAt + s.arriveOffsetMin * 60_000, s.dropKm, Date.now());
}

export function waitingNear(hub: string, arriveAt: number, windowMin: number): Row[] {
  return db.prepare("SELECT * FROM pool_requests WHERE hub = ? AND status = 'waiting' AND ABS(arrive_at - ?) <= ?").all(hub, arriveAt, windowMin * 60_000) as unknown as Row[];
}

export function previewCount(me: Omit<Rider, "id">, w: SplitWeights) {
  const self = { ...me, id: "__me" };
  return waitingNear(me.hub, me.arriveAt, w.windowMin).filter((r) => compatible(self, toRider(r), w)).length;
}

export function createRequest(convId: string, name: string, hub: string, town: string, arriveAt: number, dropKm: number) {
  const prev = db.prepare("SELECT id FROM pool_requests WHERE conv_id = ? AND status = 'waiting'").get(convId) as { id: string } | undefined;
  if (prev) db.prepare("UPDATE pool_requests SET status = 'cancelled' WHERE id = ?").run(prev.id);
  const id = uid();
  db.prepare("INSERT INTO pool_requests (id, conv_id, name, hub, town, arrive_at, drop_km, created) VALUES (?,?,?,?,?,?,?,?)").run(id, convId, name, hub, town, arriveAt, dropKm, Date.now());
  trace("pool", convId, { event: "request created", id, hub, town, arriveAt });
  return id;
}

export function addSimulatedRider(convId: string) {
  const mine = db.prepare("SELECT * FROM pool_requests WHERE conv_id = ? AND status = 'waiting'").get(convId) as unknown as Row | undefined;
  if (!mine) return null;
  const names = ["Sneha", "Vikas", "Arjun", "Kavya", "Deepak", "Priya", "Sameer"];
  const name = names[Math.floor(Math.random() * names.length)];
  const id = uid();
  db.prepare("INSERT INTO pool_requests (id, conv_id, name, hub, town, arrive_at, drop_km, synthetic, created) VALUES (?,?,?,?,?,?,?,1,?)").run(
    id, null, name, mine.hub, mine.town, mine.arrive_at + 25 * 60_000, Math.max(20, mine.drop_km - 15), Date.now(),
  );
  trace("pool", convId, { event: "simulated traveller joined", name, town: mine.town });
  return name;
}

/** Atomically lease up to `n` waiting (non-seed) requests to a watcher pod. */
export function claim(pod: string, n: number, leaseMs: number) {
  const now = Date.now();
  const rows = db.prepare("SELECT * FROM pool_requests WHERE status = 'waiting' AND synthetic != 1 AND claimed_until < ? ORDER BY created LIMIT ?").all(now, n) as unknown as Row[];
  const upd = db.prepare("UPDATE pool_requests SET claimed_by = ?, claimed_until = ? WHERE id = ? AND claimed_until < ?");
  const claimed = rows.filter((r) => Number(upd.run(pod, now + leaseMs, r.id, now).changes) === 1);
  return claimed.map((r) => ({
    request: toRider(r),
    candidates: waitingNear(r.hub, r.arrive_at, 120)
      .filter((c) => c.id !== r.id)
      .sort((a, b) => Math.abs(a.arrive_at - r.arrive_at) - Math.abs(b.arrive_at - r.arrive_at))
      .slice(0, 300)
      .map(toRider),
  }));
}

export async function applyResult(requestId: string, memberIds: string[], w: SplitWeights, pod: string) {
  const me = db.prepare("SELECT * FROM pool_requests WHERE id = ?").get(requestId) as unknown as Row | undefined;
  if (!me || me.status !== "waiting") return { ok: false, reason: "not waiting" };
  if (memberIds.length < 2) {
    db.prepare("UPDATE pool_requests SET claimed_until = ? WHERE id = ?").run(Date.now() + 2000, requestId); // re-check soon
    return { ok: true, matched: false };
  }
  const rows = memberIds.map((id) => db.prepare("SELECT * FROM pool_requests WHERE id = ?").get(id) as unknown as Row | undefined).filter((r): r is Row => Boolean(r && r.status === "waiting"));
  if (rows.length < 2 || !rows.some((r) => r.id === requestId)) return { ok: false, reason: "members changed" };
  const split = splitFare(rows.map(toRider), w);
  const poolId = uid();
  db.prepare("INSERT INTO pools (id, hub, split, created) VALUES (?,?,?,?)").run(poolId, me.hub, JSON.stringify({ ...split, members: rows.map((r) => ({ id: r.id, name: r.name, town: r.town, synthetic: r.synthetic })) }), Date.now());
  const mark = db.prepare("UPDATE pool_requests SET status = 'matched', pool_id = ? WHERE id = ?");
  for (const r of rows) mark.run(poolId, r.id);
  trace("pool", me.conv_id, { event: "pool matched", poolId, by: pod, members: rows.map((r) => r.name), totalFare: split.totalFare });
  for (const r of rows) if (r.conv_id) await notifyMatched(r, rows, split, poolId);
  return { ok: true, matched: true, poolId };
}

async function notifyMatched(me: Row, rows: Row[], split: ReturnType<typeof splitFare>, poolId: string) {
  const conv = convs.get(me.conv_id!);
  if (!conv) return;
  const l = langKey(conv.lang);
  const line = split.lines.find((x) => x.riderId === me.id)!;
  const others = rows.filter((r) => r.id !== me.id).map((r) => `${r.name} (${cityByCode.get(r.town)?.name ?? r.town})`);
  let text = t.poolMatched(l, others, line.pays, line.saves, split.departAt);
  if (l === "en" && conv.lang !== "en-IN") text = await translate(text, conv.lang, conv.id);
  const card = { type: "pool", status: "matched", poolId, split, me: me.id, members: rows.map((r) => ({ id: r.id, name: r.name, town: r.town })) };
  const { messages } = await import("../db.ts");
  messages.add(conv.id, "bot", text, { cards: [card], notify: true });
  convs.update(conv.id, { stage: "POOL_JOINED" });
  pushToConv(conv.id, { type: "message", role: "bot", text, payload: { cards: [card], notify: true }, ts: Date.now() });
  if (conv.whatsapp) {
    // Detailed version for WhatsApp: who rides, what each person pays and saves, when the cab leaves.
    const detailed = formatPoolMatchedForWhatsApp(split, me.id, conv.lang, conv.id);
    const audio = conv.channel === "whatsapp" ? await textToSpeech(text, conv.lang, conv.id) : null;
    await sendWhatsApp(conv.whatsapp, detailed, audio, conv.id);
  }
}

export function poolOf(convId: string) {
  const r = db.prepare("SELECT * FROM pool_requests WHERE conv_id = ? AND status IN ('waiting','matched') ORDER BY created DESC LIMIT 1").get(convId) as unknown as Row | undefined;
  if (!r) return null;
  const pool = r.pool_id ? (db.prepare("SELECT * FROM pools WHERE id = ?").get(r.pool_id) as { split: string } | undefined) : undefined;
  return { request: r, pool: pool ? j(pool.split, null) : null };
}

export function surge(count: number, hub = "LKO") {
  const towns = ["GKP", "GD", "BST", "AY", "BRK", "SLN"];
  const base = Date.now() + 30 * 86_400_000;
  const ins = db.prepare("INSERT INTO pool_requests (id, conv_id, name, hub, town, arrive_at, drop_km, synthetic, created) VALUES (?,?,?,?,?,?,?,2,?)");
  db.exec("BEGIN");
  for (let i = 0; i < count; i++) {
    const town = towns[i % towns.length];
    ins.run(uid(), null, `Traveller ${i + 1}`, hub, town, base + Math.floor(Math.random() * 6 * 3600_000), cityByCode.get(town)?.kmFromHub ?? 100, Date.now());
  }
  db.exec("COMMIT");
  trace("surge", null, { event: "Diwali-eve surge simulated", requests: count, hub });
}

export function queueStats() {
  const q = db.prepare("SELECT status, synthetic, COUNT(*) n FROM pool_requests GROUP BY status, synthetic").all() as { status: string; synthetic: number; n: number }[];
  const waiting = q.filter((x) => x.status === "waiting" && x.synthetic !== 1).reduce((a, b) => a + b.n, 0);
  const matched = q.filter((x) => x.status === "matched").reduce((a, b) => a + b.n, 0);
  return { waiting, matched };
}
