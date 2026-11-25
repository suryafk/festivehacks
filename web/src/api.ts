export type Mode = "flight" | "train" | "cab";

export interface Leg { mode: Mode | "transfer"; from: string; to: string; depart: number; arrive: number; name: string; fare: number; note?: string }
export interface Itinerary { id: string; label: string; legs: Leg[]; depart: number; arrive: number; totalMin: number; totalFare: number; date: string; tags: string[]; pool?: { hub: string; town: string; km: number; arriveAt: number; soloFare: number } }
export interface FareAdvice { verdict: "book_now" | "wait"; currentFare: number; bestFare: number; bestBookBy: string; daysOut: number; festival?: string; savings: number; riseAfter?: string; history: { date: string; fare: number }[]; forecast: { date: string; fare: number }[] }
export interface SplitLine { riderId: string; name: string; town: string; dropKm: number; pays: number; soloFare: number; saves: number; segments: { fromKm: number; toKm: number; sharedWith: number; cost: number }[] }
export interface Split { totalFare: number; totalKm: number; departAt: number; lines: SplitLine[]; method: string }
export interface Card { type: string; [k: string]: any }
export interface Msg { role: "user" | "bot" | "system"; text: string; ts: number; payload?: { cards?: Card[]; quickReplies?: string[]; audioUrl?: string | null; notify?: boolean; voice?: boolean } | null }
export interface Reply { text: string; lang: string; cards: Card[]; quickReplies: string[]; audioUrl?: string | null; stage: string }
export interface Trace { ts: number; kind: string; convId?: string | null; data: Record<string, any> }

const json = async <T,>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error((await r.text()).slice(0, 200) || r.statusText);
  return r.json();
};
const post = <T,>(url: string, body?: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).then(json<T>);

export const api = {
  config: () => fetch("/api/config").then(json<{ voiceInput: boolean; judgeControls: boolean; whatsapp: boolean; festiveRush: boolean; sponsors: Record<string, boolean>; sandbox: { number: string; join: string } }>),
  create: (name?: string) => post<{ id: string }>("/api/conversations", { name }),
  get: (id: string) => fetch(`/api/conversations/${id}`).then(json<{ id: string; name: string; stage: string; messages: Msg[]; whatsapp: boolean }>),
  send: (id: string, body: { text?: string; action?: unknown; wasVoice?: boolean; voiceLang?: string }) => post<Reply>(`/api/conversations/${id}/message`, body),
  voice: (id: string, blob: Blob) => {
    const f = new FormData();
    f.append("audio", blob, blob.type.includes("ogg") ? "voice.ogg" : "voice.webm");
    return fetch(`/api/conversations/${id}/voice`, { method: "POST", body: f }).then(json<{ transcript: string; lang: string }>);
  },
  linkWhatsApp: (id: string, phone: string) => post<{ ok: boolean }>(`/api/conversations/${id}/whatsapp`, { phone }),
  track: (convId: string, event: string, variant: string) => post("/api/track", { convId, event, variant }),
  ops: () => fetch("/api/ops/state").then(json<any>),
  surge: () => post("/api/ops/surge", { count: 1500 }),
  clearSurge: () => post("/api/ops/reset-surge"),
};

export const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k: string) => { try { localStorage.removeItem(k); } catch {} },
};

export const CITY: Record<string, string> = { BLR: "Bengaluru", DEL: "Delhi", BOM: "Mumbai", HYD: "Hyderabad", LKO: "Lucknow", PAT: "Patna", VNS: "Varanasi", GKP: "Gorakhpur", GD: "Gonda", BST: "Basti", AY: "Ayodhya", BRK: "Barabanki", SLN: "Sultanpur", ARA: "Ara", HJP: "Hajipur", BGS: "Begusarai", CPR: "Chhapra", JNU: "Jaunpur", GZP: "Ghazipur", MZP: "Mirzapur" };
export const city = (c: string) => CITY[c] ?? c;
export const time = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
export const day = (ms: number | string) => new Date(typeof ms === "string" ? ms + "T00:00:00+05:30" : ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
export const rupee = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60 ? (min % 60) + "m" : ""}` : `${min}m`).trim();
