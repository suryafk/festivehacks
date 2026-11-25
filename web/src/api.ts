export type Mode = "flight" | "train" | "cab";

export interface Trip { origin?: string; destination?: string; date?: string; flexDays?: number; modes?: Mode[]; travellers?: number }
export interface Leg { mode: Mode | "transfer"; from: string; to: string; depart: number; arrive: number; name: string; fare: number; note?: string }
export interface Itinerary { id: string; label: string; legs: Leg[]; depart: number; arrive: number; totalMin: number; totalFare: number; date: string; tags: string[]; flight?: { from: string; to: string; baseFare: number; date: string }; pool?: { hub: string; town: string; km: number; arriveAt: number; soloFare: number } }
export interface FareAdvice {
  verdict: "book_now" | "wait" | "monitor";
  currentFare: number; expectedFare: number; vsExpectedPct: number; dropProb: { days: number; pct: number }[];
  bestFare: number; bestBookBy: string; daysOut: number; festival?: string; savings: number; riseAfter?: string;
  source?: "google_flights" | "simulated"; priceLevel?: string; typicalRange?: [number, number]; volatilityPct?: number; fetchedAt?: number;
  history: { date: string; fare: number }[]; forecast: { date: string; fare: number }[];
}
export interface SplitLine { riderId: string; name: string; town: string; dropKm: number; pays: number; soloFare: number; saves: number; segments: { fromKm: number; toKm: number; sharedWith: number; cost: number }[] }
export interface Split { totalFare: number; totalKm: number; departAt: number; lines: SplitLine[]; method: string }
export interface Card { type: string; [k: string]: any }
export interface Msg { role: "user" | "bot" | "system"; text: string; ts: number; payload?: { cards?: Card[]; quickReplies?: string[]; audioUrl?: string | null; notify?: boolean; voice?: boolean } | null }
export interface Reply { text: string; lang: string; cards: Card[]; quickReplies: string[]; audioUrl?: string | null; stage: string }
export interface Trace { ts: number; kind: string; convId?: string | null; data: Record<string, any> }
export interface FareWatch { id: string; origin: string; dest: string; date: string; start_fare: number; target: number; last_quote: number; status: "watching" | "fired" | "cancelled" }
export interface CabMates {
  hub: { code: string; name: string; lat: number; lng: number };
  me: { town: string; townName: string; lat: number; lng: number; arriveAt: number; km: number; soloFare: number; itineraryId: string };
  windowMin: number;
  riders: { id: string; name: string; town: string; townName: string; lat: number; lng: number; arriveAt: number; dropKm: number; compatible: boolean }[];
  towns: { code: string; name: string; lat: number; lng: number; count: number; compatible: boolean }[];
  pool: { request: { status: string; pool_id: string | null; id: string }; pool: (Split & { members: { id: string; name: string; town: string }[] }) | null } | null;
}
export interface PlaceSuggestion { code: string; name: string; detail: string }
export type Config = { voiceInput: boolean; judgeControls: boolean; whatsapp: boolean; festiveRush: boolean; sponsors: Record<string, boolean>; sandbox: { number: string; join: string } };

const json = async <T,>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error((await r.text()).slice(0, 200) || r.statusText);
  return r.json();
};
const post = <T,>(url: string, body?: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).then(json<T>);

export const api = {
  config: () => fetch("/api/config").then(json<Config>),
  create: (name?: string) => post<{ id: string }>("/api/conversations", { name }),
  get: (id: string) => fetch(`/api/conversations/${id}`).then(json<{ id: string; name: string; stage: string; trip: Trip; messages: Msg[]; whatsapp: boolean }>),
  send: (id: string, body: { text?: string; action?: unknown; wasVoice?: boolean; voiceLang?: string }) => post<Reply>(`/api/conversations/${id}/message`, body),
  plan: (id: string, trip: Trip) => post<Reply>(`/api/conversations/${id}/message`, { action: { type: "set_trip", trip } }),
  parse: (id: string, text: string) => post<Trip & { lang: string; unknownPlaces?: string[]; message?: string; names?: Record<string, string> }>(`/api/conversations/${id}/parse`, { text }),
  places: (q: string) => fetch(`/api/places?q=${encodeURIComponent(q)}`).then(json<PlaceSuggestion[]>),
  voice: (id: string, blob: Blob) => {
    const f = new FormData();
    f.append("audio", blob, blob.type.includes("ogg") ? "voice.ogg" : "voice.webm");
    return fetch(`/api/conversations/${id}/voice`, { method: "POST", body: f }).then(json<{ transcript: string; lang: string }>);
  },
  cabmates: (id: string) => fetch(`/api/conversations/${id}/cabmates`).then(json<CabMates>),
  joinPool: (id: string, itineraryId?: string) => post<Reply>(`/api/conversations/${id}/message`, { action: { type: "join_pool", itineraryId } }),
  simulateRider: (id: string) => post<Reply>(`/api/conversations/${id}/message`, { action: { type: "simulate_rider" } }),
  watchFare: (id: string, currentFare: number) => post<FareWatch>(`/api/conversations/${id}/fare-watch`, { currentFare }),
  getWatch: (id: string) => fetch(`/api/conversations/${id}/fare-watch`).then(json<FareWatch | null>),
  simulateDrop: (id: string) => post(`/api/conversations/${id}/fare-watch/simulate-drop`),
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

export const ORIGINS = [
  { code: "BLR", name: "Bengaluru" }, { code: "DEL", name: "Delhi" }, { code: "BOM", name: "Mumbai" }, { code: "HYD", name: "Hyderabad" },
];
export const DESTINATIONS = [
  { group: "Uttar Pradesh (via Lucknow)", items: [["GKP", "Gorakhpur"], ["GD", "Gonda"], ["BST", "Basti"], ["AY", "Ayodhya"], ["SLN", "Sultanpur"], ["BRK", "Barabanki"], ["LKO", "Lucknow"]] },
  { group: "Bihar (via Patna)", items: [["CPR", "Chhapra"], ["ARA", "Ara"], ["BGS", "Begusarai"], ["HJP", "Hajipur"], ["PAT", "Patna"]] },
  { group: "Purvanchal (via Varanasi)", items: [["JNU", "Jaunpur"], ["GZP", "Ghazipur"], ["MZP", "Mirzapur"], ["VNS", "Varanasi"]] },
];
/** Code → name. Starts with the seed; the server sends names for every other place a plan mentions. */
export const CITY: Record<string, string> = Object.fromEntries([...ORIGINS.map((o) => [o.code, o.name]), ...DESTINATIONS.flatMap((g) => g.items)]);
export const registerNames = (names?: Record<string, string> | null) => { if (names) Object.assign(CITY, names); };
/** A code shows its name; free text (a place typed in the form, not looked up yet) shows as typed. */
export const city = (c?: string) => (c ? CITY[c] ?? c : "");
export const time = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
export const day = (ms: number | string) => new Date(typeof ms === "string" ? ms + "T00:00:00+05:30" : ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
export const weekday = (d: string) => new Date(d + "T00:00:00+05:30").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
export const rupee = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60 ? (min % 60) + "m" : ""}` : `${min}m`).trim();

/** One conversation per browser; the Plan and Cab-mates pages share it. */
export async function ensureConv(): Promise<string> {
  const existing = store.get("mb.conv");
  if (existing) {
    try { await api.get(existing); return existing; } catch {}
  }
  const { id } = await api.create();
  store.set("mb.conv", id);
  return id;
}
export async function newConv(): Promise<string> {
  const { id } = await api.create();
  store.set("mb.conv", id);
  return id;
}
