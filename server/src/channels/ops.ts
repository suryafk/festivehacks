// Ops surface: watcher coordination (internal), surge simulator, NudgeBee callback, Prometheus metrics.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { db, j } from "../db.ts";
import { trace } from "../bus.ts";
import { config } from "../config.ts";
import { getFlags, localOverrides, rushKnobs } from "../integrations/flags.ts";
import { applyResult, claim, queueStats, surge } from "../engine/pools.ts";
import { sse } from "./web.ts";

const internalOk = (req: FastifyRequest) => req.headers["x-internal-token"] === config.internalToken;
const opsOk = (req: FastifyRequest) => req.headers["x-ops-token"] === config.opsToken || (req.query as Record<string, string>)?.token === config.opsToken;

function watchers() {
  const rows = db.prepare("SELECT pod, ts, data, first_seen FROM heartbeats ORDER BY first_seen DESC LIMIT 30").all() as { pod: string; ts: number; data: string; first_seen: number }[];
  const now = Date.now();
  return rows.map((r) => ({ pod: r.pod, alive: now - r.ts < 15_000, lastSeen: r.ts, firstSeen: r.first_seen, ...j<Record<string, unknown>>(r.data, {}) }));
}

export function opsRoutes(app: FastifyInstance) {
  // ---- internal (watcher pods) ----
  app.get("/internal/config", async (req, reply) => {
    if (!internalOk(req)) return reply.code(401).send();
    const f = await getFlags("watcher");
    return { watcher: f.watcher_config, degrade: f.degrade_gracefully, split: { ...f.split_weights, windowMin: rushKnobs(f).poolWindowMin } };
  });
  app.post("/internal/claim", async (req, reply) => {
    if (!internalOk(req)) return reply.code(401).send();
    const { pod, n } = req.body as { pod: string; n: number };
    return { jobs: claim(pod, Math.min(500, n), 20_000) };
  });
  app.post("/internal/result", async (req, reply) => {
    if (!internalOk(req)) return reply.code(401).send();
    const { id, memberIds, pod } = req.body as { id: string; memberIds: string[]; pod: string };
    const f = await getFlags("watcher");
    return applyResult(id, memberIds, { ...f.split_weights, windowMin: rushKnobs(f).poolWindowMin }, pod);
  });
  app.post("/internal/heartbeat", async (req, reply) => {
    if (!internalOk(req)) return reply.code(401).send();
    const { pod, ...data } = req.body as { pod: string } & Record<string, unknown>;
    const now = Date.now();
    const existed = db.prepare("SELECT 1 FROM heartbeats WHERE pod = ?").get(pod);
    db.prepare("INSERT INTO heartbeats (pod, ts, data, first_seen) VALUES (?,?,?,?) ON CONFLICT(pod) DO UPDATE SET ts = excluded.ts, data = excluded.data").run(pod, now, JSON.stringify(data), now);
    if (!existed) trace("watcher", null, { event: "watcher pod started", pod });
    return { ok: true };
  });

  // ---- public ops page ----
  app.get("/api/ops/state", async () => {
    const f = await getFlags();
    const events = (db.prepare("SELECT ts, kind, data FROM events WHERE kind IN ('nudgebee','surge','watcher','pool','flagsmith') AND conv_id IS NULL ORDER BY id DESC LIMIT 60").all() as { ts: number; kind: string; data: string }[]).map((e) => ({ ...e, data: j(e.data, {}) }));
    return {
      queue: queueStats(),
      watchers: watchers(),
      flags: { festive_rush_mode: f.festive_rush_mode, degrade_gracefully: f.degrade_gracefully, watcher_config: f.watcher_config, source: f.source, judge_controls: f.judge_controls },
      events,
    };
  });
  app.get("/api/ops/stream", async (_req, reply) => sse(reply, "ops"));

  app.post("/api/ops/surge", async (req, reply) => {
    const f = await getFlags();
    if (!f.judge_controls) return reply.code(403).send({ error: "judge_controls flag is off" });
    const last = db.prepare("SELECT MAX(ts) t FROM events WHERE kind = 'surge'").get() as { t: number | null };
    if (last.t && Date.now() - last.t < 60_000) return reply.code(429).send({ error: "a surge just ran, give it a minute" });
    const { count } = (req.body ?? {}) as { count?: number };
    surge(Math.min(3000, count ?? 1500));
    return { ok: true };
  });

  app.post("/api/ops/reset-surge", async (req, reply) => {
    const f = await getFlags();
    if (!f.judge_controls && !opsOk(req)) return reply.code(403).send();
    const r = db.prepare("DELETE FROM pool_requests WHERE synthetic = 2").run();
    trace("surge", null, { event: "surge traffic cleared", removed: Number(r.changes) });
    return { ok: true };
  });

  // NudgeBee workflow "HTTP request" task posts its RCA / actions here so they show on /ops.
  app.post("/api/ops/nudgebee", async (req, reply) => {
    if (!opsOk(req)) return reply.code(401).send();
    trace("nudgebee", null, (req.body ?? {}) as Record<string, unknown>);
    return { ok: true };
  });

  // Fallback when no Flagsmith admin token is wired: flip the flag locally (still shown as an override).
  app.post("/api/ops/override", async (req, reply) => {
    if (!opsOk(req)) return reply.code(401).send();
    const { degrade_gracefully } = (req.body ?? {}) as { degrade_gracefully?: boolean };
    if (typeof degrade_gracefully === "boolean") localOverrides.degrade_gracefully = degrade_gracefully;
    else delete localOverrides.degrade_gracefully;
    trace("flagsmith", null, { event: "local override", degrade_gracefully });
    return { ok: true, overrides: localOverrides };
  });

  app.get("/metrics", async (_req, reply) => {
    const q = queueStats();
    const w = watchers();
    reply.type("text/plain; version=0.0.4").send(
      [
        "# HELP margbandhu_pool_queue_waiting Pool requests waiting for a match",
        "# TYPE margbandhu_pool_queue_waiting gauge",
        `margbandhu_pool_queue_waiting ${q.waiting}`,
        "# TYPE margbandhu_pool_matched_total counter",
        `margbandhu_pool_matched_total ${q.matched}`,
        "# TYPE margbandhu_watchers_alive gauge",
        `margbandhu_watchers_alive ${w.filter((x) => x.alive).length}`,
      ].join("\n") + "\n",
    );
  });
}
