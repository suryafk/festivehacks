import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { config } from "./config.ts";

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(config.dataDir + "audio", { recursive: true });

export const db = new DatabaseSync(config.dataDir + "marg-bandhu.db");
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, channel TEXT NOT NULL, user_ref TEXT, name TEXT, lang TEXT DEFAULT 'en-IN',
  stage TEXT DEFAULT 'NEW', trip TEXT DEFAULT '{}', plan TEXT, whatsapp TEXT, created INTEGER, updated INTEGER
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT, role TEXT, text TEXT, payload TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS pool_requests (
  id TEXT PRIMARY KEY, conv_id TEXT, name TEXT, hub TEXT, town TEXT, arrive_at INTEGER, drop_km INTEGER,
  status TEXT DEFAULT 'waiting', pool_id TEXT, claimed_by TEXT, claimed_until INTEGER DEFAULT 0,
  synthetic INTEGER DEFAULT 0, created INTEGER
);
CREATE INDEX IF NOT EXISTS pr_status ON pool_requests(status, claimed_until);
CREATE TABLE IF NOT EXISTS pools (id TEXT PRIMARY KEY, hub TEXT, split TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, kind TEXT, conv_id TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS heartbeats (pod TEXT PRIMARY KEY, ts INTEGER, data TEXT, first_seen INTEGER);
`);

export const uid = () => randomUUID().slice(0, 12);
export const j = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== "string") return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export interface ConvRow {
  id: string;
  channel: "web" | "whatsapp";
  user_ref: string | null;
  name: string | null;
  lang: string;
  stage: string;
  trip: string;
  plan: string | null;
  whatsapp: string | null;
}

export const convs = {
  get: (id: string) => db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as unknown as ConvRow | undefined,
  byUser: (ref: string) => db.prepare("SELECT * FROM conversations WHERE user_ref = ? ORDER BY updated DESC LIMIT 1").get(ref) as unknown as ConvRow | undefined,
  create(channel: ConvRow["channel"], userRef: string | null, name?: string) {
    const id = uid();
    const now = Date.now();
    db.prepare("INSERT INTO conversations (id, channel, user_ref, name, created, updated, whatsapp) VALUES (?,?,?,?,?,?,?)").run(
      id, channel, userRef, name ?? null, now, now, channel === "whatsapp" ? userRef : null,
    );
    return convs.get(id)!;
  },
  update(id: string, patch: Partial<Record<keyof ConvRow, string | null>>) {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    db.prepare(`UPDATE conversations SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated = ? WHERE id = ?`).run(
      ...keys.map((k) => (patch as Record<string, string | null>)[k]), Date.now(), id,
    );
  },
};

export const messages = {
  add: (convId: string, role: "user" | "bot" | "system", text: string, payload?: unknown) =>
    db.prepare("INSERT INTO messages (conv_id, role, text, payload, ts) VALUES (?,?,?,?,?)").run(convId, role, text, payload ? JSON.stringify(payload) : null, Date.now()),
  list: (convId: string) =>
    (db.prepare("SELECT role, text, payload, ts FROM messages WHERE conv_id = ? ORDER BY id").all(convId) as unknown as { role: string; text: string; payload: string | null; ts: number }[]).map((m) => ({
      ...m,
      payload: j(m.payload, null),
    })),
};
