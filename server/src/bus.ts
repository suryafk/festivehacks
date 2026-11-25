// In-process pub/sub for live updates (SSE) + the "behind the scenes" trace.
import { EventEmitter } from "node:events";
import { db } from "./db.ts";

export const bus = new EventEmitter();
bus.setMaxListeners(500);

export type TraceKind = "sarvam" | "flagsmith" | "twilio" | "engine" | "pool" | "nudgebee" | "watcher" | "surge";

/** Record what a sponsor tool / subsystem did, for the behind-the-scenes panel and /ops. */
export function trace(kind: TraceKind, convId: string | null, data: Record<string, unknown>) {
  const ts = Date.now();
  db.prepare("INSERT INTO events (ts, kind, conv_id, data) VALUES (?,?,?,?)").run(ts, kind, convId, JSON.stringify(data));
  const ev = { ts, kind, convId, data };
  if (convId) bus.emit(`conv:${convId}`, { type: "trace", ...ev });
  bus.emit("ops", { type: "trace", ...ev });
}

export function pushToConv(convId: string, event: Record<string, unknown>) {
  bus.emit(`conv:${convId}`, event);
}

export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const r = await fn();
  return [r, Math.round(performance.now() - t)];
}
