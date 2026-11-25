// Turn free text (typed or transcribed) into a structured trip update.
// Primary: Sarvam-105B with a JSON response. Fallback: a deterministic parser, so the demo never dead-ends.
import { cities, cityByCode, findCity, notCoveredPlaces, type City, type Mode } from "./seed.ts";
import type { Trip } from "./planner.ts";
import { chatJson } from "../integrations/sarvam.ts";
import "./places.ts"; // registers airports + looked-up places, so they can be spotted in sentences
import { has } from "../config.ts";
import { trace } from "../bus.ts";

export interface Intent extends Trip {
  intent: "trip" | "join_pool" | "watch_fare" | "choose" | "reset" | "help" | "other";
  choice?: number;
  lang?: string;
  /** City codes literally present in the user's words (from our alias list). */
  mentioned?: string[];
  /** Places outside India that the user named (e.g. "Nepal", "Dubai"). */
  unknownPlaces?: string[];
  /** Place names we don't know yet, as the user said them; the engine looks them up (OpenStreetMap). */
  originName?: string;
  destinationName?: string;
}

/** City names that are also everyday Hindi words ("gaya" = went). Only a place when the sentence puts them in a
 * from / to slot ("Patna se Gaya"), never when merely spotted somewhere in the sentence. */
const AMBIGUOUS = new Set(["gaya", "गया", "kota", "diu", "mau"]);

/** Places we can spot in a sentence without any lookup: the seed plus every airport city. */
const spottable = (): City[] => [...cityByCode.values()].filter((c) => c.source === "seed" || c.source === "airport");

const STOP = new Set(["jana", "jaana", "hai", "tak", "ke", "ki", "ko", "ka", "se", "aas", "paas", "around", "on", "by", "the", "me", "mujhe", "i", "want", "go", "to", "from", "want", "travel", "trip",
  "जाना", "है", "तक", "के", "की", "को", "का", "से", "आसपास", "मुझे", "मैं", "हमें", "घर", "ghar", "home", "flight", "train", "cab", "फ्लाइट", "ट्रेन", "कैब", "sab", "सब", "chalega", "चलेगा", "aur", "और"]);
const MONTH_WORDS = new Set(Object.keys({
  jan: 1, january: 1, जनवरी: 1, feb: 1, february: 1, फरवरी: 1, mar: 1, march: 1, मार्च: 1, apr: 1, april: 1, अप्रैल: 1, may: 1, मई: 1, jun: 1, june: 1, जून: 1,
  jul: 1, july: 1, जुलाई: 1, aug: 1, august: 1, अगस्त: 1, sep: 1, sept: 1, september: 1, सितंबर: 1, oct: 1, october: 1, अक्टूबर: 1, nov: 1, november: 1,
  नवंबर: 1, नवम्बर: 1, dec: 1, december: 1, दिसंबर: 1, दिसम्बर: 1, tomorrow: 1, today: 1, kal: 1, aaj: 1, कल: 1, आज: 1,
}));
const placeWord = (w: string) => w.length >= 3 && !/\d|[०-९]/.test(w) && !STOP.has(w.toLowerCase()) && !MONTH_WORDS.has(w.toLowerCase());
const clean = (s: string) => s.replace(/[“”"'.,!?;:()]/g, " ").replace(/\s+/g, " ").trim();

/** "from X to Y", "X to Y", "X se Y", "X से Y", "Y jana hai": rough, only a fallback for names we don't know. */
export function guessPlaceNames(text: string): { origin?: string; destination?: string } {
  const t = clean(text);
  const words = (s: string) => s.split(" ").filter(Boolean);
  const tail = (s: string) => { const w = words(s); const out: string[] = []; for (let i = w.length - 1; i >= 0 && out.length < 2 && placeWord(w[i]); i--) out.unshift(w[i]); return out.join(" ") || undefined; };
  const head = (s: string) => { const w = words(s); const out: string[] = []; for (let i = 0; i < w.length && out.length < 2 && placeWord(w[i]); i++) out.push(w[i]); return out.join(" ") || undefined; };
  let m = t.match(/^(.*?)\b(?:from|frm)\s+(.+?)\s+to\s+(.+)$/i);
  if (m) return { origin: head(m[2]), destination: head(m[3]) };
  m = t.match(/^(.*?)\s+to\s+(.+)$/i);
  if (m) return { origin: tail(m[1]), destination: head(m[2]) };
  m = t.match(/^(.*?)\s+(?:se|से)\s+(.+)$/i);
  if (m) return { origin: tail(m[1]), destination: head(m[2]) };
  m = t.match(/^(.*?)\s+(?:jana|jaana|जाना|ja raha|जा रहा|जा रही)\b/i);
  if (m) return { destination: tail(m[1]) };
  return {};
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, जनवरी: 1, feb: 2, february: 2, फरवरी: 2, mar: 3, march: 3, मार्च: 3, apr: 4, april: 4, अप्रैल: 4,
  may: 5, मई: 5, jun: 6, june: 6, जून: 6, jul: 7, july: 7, जुलाई: 7, aug: 8, august: 8, अगस्त: 8, sep: 9, sept: 9, september: 9, सितंबर: 9,
  oct: 10, october: 10, अक्टूबर: 10, nov: 11, november: 11, नवंबर: 11, नवम्बर: 11, dec: 12, december: 12, दिसंबर: 12, दिसम्बर: 12,
};

const DEVANAGARI_DIGITS = "०१२३४५६७८९";
const normDigits = (s: string) => s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));

export function detectLang(text: string) {
  if (/[ऀ-ॿ]/.test(text)) return "hi-IN";
  if (/[ঀ-৿]/.test(text)) return "bn-IN";
  if (/[஀-௿]/.test(text)) return "ta-IN";
  if (/[ఀ-౿]/.test(text)) return "te-IN";
  if (/[ಀ-೿]/.test(text)) return "kn-IN";
  return "en-IN";
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function parseDate(text: string, today: Date): { date?: string; flex?: number } {
  const t = normDigits(text.toLowerCase());
  const y0 = today.getUTCFullYear();
  const m0 = today.getUTCMonth() + 1;
  const d0 = today.getUTCDate();
  const flex = /around|aas[- ]?paas|आस[- ]?पास|लगभग|approx|roughly|ke paas|के आसपास/.test(t) ? 2 : undefined;
  const addDays = (n: number) => new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  if (/\b(day after tomorrow|parso|parson)\b|परसों/.test(t)) return { date: addDays(2), flex };
  if (/\b(tomorrow|kal)\b|कल/.test(t)) return { date: addDays(1), flex };
  if (/\b(today|aaj)\b|आज/.test(t)) return { date: addDays(0), flex };
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { date: iso(+m[1], +m[2], +m[3]), flex };
  m = t.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if (m) {
    const mon = +m[2];
    const yr = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : mon < m0 ? y0 + 1 : y0;
    return { date: iso(yr, mon, +m[1]), flex };
  }
  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
  m = t.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${monthNames})`)) ?? null;
  let day: number | undefined;
  let mon: number | undefined;
  if (m) [day, mon] = [+m[1], MONTHS[m[2]]];
  else {
    m = t.match(new RegExp(`(${monthNames})\\s*(\\d{1,2})`));
    if (m) [day, mon] = [+m[2], MONTHS[m[1]]];
  }
  if (!day) {
    const dm = t.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:tareekh|tarikh|तारीख|तारिख|ko|को|date)/);
    if (dm) {
      day = +dm[1];
      mon = day >= d0 ? m0 : (m0 % 12) + 1;
    }
  }
  if (day && mon && day <= 31) {
    const yr = mon < m0 || (mon === m0 && day < d0) ? y0 + 1 : y0;
    return { date: iso(yr, mon, day), flex };
  }
  return { flex };
}

export function parseModes(text: string): Mode[] | undefined {
  const t = text.toLowerCase();
  if (/\b(any|anything|all|sab|kuch bhi|koi bhi)\b|सब|कुछ भी|कोई भी/.test(t)) return ["flight", "train", "cab"];
  const modes: Mode[] = [];
  if (/flight|plane|fly|air|hawai|फ्लाइट|हवाई|प्लेन|विमान/.test(t)) modes.push("flight");
  if (/train|rail|ट्रेन|रेल/.test(t)) modes.push("train");
  if (/\bcab\b|taxi|car\b|uber|ola|कैब|टैक्सी|गाड़ी|गाडी/.test(t)) modes.push("cab");
  return modes.length ? modes : undefined;
}

export function heuristicIntent(text: string, current: Trip, today: Date): Intent {
  const t = text.toLowerCase().trim();
  const out: Intent = { intent: "trip", lang: detectLang(text) };
  if (/^(reset|restart|start over|new trip|new|naya)\b|नया/.test(t)) return { ...out, intent: "reset" };
  if (/^(watch|monitor|alert|track)\b|नज़र रख|नजर रख/.test(t)) return { ...out, intent: "watch_fare" };
  if (/^(help|hi|hello|namaste|hey)\b|नमस्ते/.test(t) && t.length < 12) return { ...out, intent: "help" };
  if (/\b(pool|join|share cab|share)\b|शेयर|पूल/.test(t)) return { ...out, intent: "join_pool" };
  const num = t.match(/^\s*(\d)\s*$/);
  if (num) return { ...out, intent: "choose", choice: +num[1] };

  // cities in order of appearance
  const found: { code: string; idx: number; kind: string }[] = [];
  for (const c of spottable())
    for (const a of [...(c.source === "seed" ? [c.code.toLowerCase()] : []), ...c.aliases].filter((a) => !AMBIGUOUS.has(a))) {
      const re = new RegExp(`(^|[^\\p{L}])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u");
      const m = re.exec(t);
      if (m && !found.some((f) => f.code === c.code)) found.push({ code: c.code, idx: m.index, kind: c.kind });
    }
  found.sort((a, b) => a.idx - b.idx);
  out.mentioned = found.map((f) => f.code);
  const esc = (a: string) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const unknown = notCoveredPlaces.filter(([, ...aliases]) => aliases.some((a) => new RegExp(`(^|[^\\p{L}])${esc(a)}($|[^\\p{L}])`, "u").test(t))).map(([name]) => name);
  if (unknown.length) out.unknownPlaces = unknown;
  const fromMarker = (code: string) => {
    const c = cityByCode.get(code)!;
    return [c.code.toLowerCase(), ...c.aliases].map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).some((a) => new RegExp(`(from|frm)\\s+${a}|${a}\\s+(se|से)\\b|${a}\\s+से`).test(t));
  };
  // The sentence's shape ("X to Y", "X से Y") says which place is which, also when only one of them is known.
  const g = guessPlaceNames(text);
  const roleOf = (name?: string) => {
    const c = name ? findCity(name) : undefined;
    return c ? (found.find((f) => f.code === c.code) ?? { code: c.code, idx: -1, kind: c.kind }) : undefined;
  };
  const gO = roleOf(g.origin), gD = roleOf(g.destination);
  if ((gO || gD) && gO?.code !== gD?.code) {
    if (gO) out.origin = gO.code;
    if (gD) out.destination = gD.code;
    const other = found.filter((f) => f !== gO && f !== gD);
    if (!out.origin && other.length && !g.origin) out.origin = other[0].code;
    if (!out.destination && other.length && !g.destination) out.destination = other[0].code;
  } else if (found.length >= 2) {
    const o = found.find((f) => fromMarker(f.code)) ?? found.find((f) => f.kind === "metro") ?? found[0];
    const d = found.find((f) => f !== o)!;
    out.origin = o.code;
    out.destination = d.code;
  } else if (found.length === 1) {
    const f = found[0];
    if (fromMarker(f.code) || (f.kind === "metro" && !current.origin && current.destination)) out.origin = f.code;
    else out.destination = f.code;
  }
  // Places we don't know yet: take the names from the sentence's shape, for the engine to look up.
  if (!out.origin || !out.destination) {
    const abroad = (n: string) => notCoveredPlaces.some(([, ...a]) => a.includes(n.toLowerCase()));
    // a place looked up earlier is known by code; anything else is passed on as a name to look up
    const fill = (name: string | undefined, k: "origin" | "destination", nk: "originName" | "destinationName") => {
      if (out[k] || !name || abroad(name)) return;
      const known = findCity(name);
      if (known) out[k] = known.code;
      else out[nk] = name;
    };
    if (g.origin !== g.destination) fill(g.origin, "origin", "originName");
    fill(g.destination, "destination", "destinationName");
  }
  const { date, flex } = parseDate(text, today);
  if (date) out.date = date;
  if (flex) out.flexDays = flex;
  const modes = parseModes(text);
  if (modes) out.modes = modes;
  const pax = t.match(/(\d)\s*(people|log|लोग|persons|pax|adults)/);
  if (pax) out.travellers = +pax[1];
  if (!found.length && !out.originName && !out.destinationName && !date && !modes) out.intent = "other";
  return out;
}

const SYSTEM = (today: string, current: Trip) => `You extract travel intent for "Marg Bandhu", an Indian travel assistant.
Today is ${today} (Asia/Kolkata). The user may write or speak in Hindi, English, Hinglish or another Indian language.
The trip so far: ${JSON.stringify(current)}.
Return ONLY a JSON object with these keys (omit keys you cannot infer, never invent):
{"intent":"trip"|"join_pool"|"choose"|"reset"|"help"|"other","origin":"place name","destination":"place name","date":"YYYY-MM-DD","flexDays":0-3,
 "modes":["flight"|"train"|"cab"],"travellers":number,"choice":number,"outside_india":["place name", ...]}
Rules: "origin" and "destination" are the places EXACTLY as the user named them, written in English letters
(e.g. "बेंगलुरु" → "Bengaluru", "शिमला" → "Shimla", "darbhanga" → "Darbhanga"). Any city, town or village in India is fine.
NEVER replace a place with a different, bigger or "nearest" one, and never add a state or country to the name.
Places outside India (Nepal, Dubai, London…) go in "outside_india", not in origin/destination.
Dates without a year mean the next upcoming occurrence on or after today (never a past date). "around/aas-paas" means flexDays 2.
"sab chalega/anything" means all three modes. Only include "modes" if the user actually talks about modes of transport.`;

export async function extractIntent(text: string, current: Trip, today: Date, convId: string | null): Promise<Intent> {
  const heuristic = heuristicIntent(text, current, today);
  // One-word commands (POOL / WATCH / NEW / "2") are unambiguous: answer instantly without the LLM.
  if (["reset", "join_pool", "watch_fare", "choose"].includes(heuristic.intent) && text.trim().length <= 24) {
    trace("engine", convId, { step: "intent", via: "command", result: heuristic.intent });
    return heuristic;
  }
  if (!has.sarvam()) {
    trace("engine", convId, { step: "intent", via: "heuristic (no Sarvam key)", result: heuristic });
    return heuristic;
  }
  try {
    const llm = await chatJson<Intent>(SYSTEM(today.toISOString().slice(0, 10), current), text, convId, "extract trip intent");
    // Guard against the model "helpfully" swapping in a place the user never said (Nepal → Delhi): a place we can spot
    // in sentences ourselves must actually be in the user's words (or already in the trip). Names we can't spot
    // (Shimla written in Hindi, a village) are passed on to be looked up.
    const said = new Set(heuristic.mentioned ?? []);
    const place = (raw: unknown, currentVal: string | undefined, slot: "o" | "d"): { code?: string; name?: string } => {
      const s = typeof raw === "string" ? raw.trim() : "";
      if (!s || /unknown|null|none|n\/a/i.test(s) || s.length > 60) return {};
      const known = findCity(s);
      if (known && (known.source === "seed" || known.source === "airport")) {
        if (said.has(known.code) || known.code === currentVal) return { code: known.code };
        // The model named a known place the user's words don't visibly contain. That's either a transliteration we
        // have no alias for ("शिमला" → Shimla: fine) or a substitution (Nepal → Delhi: not fine). Substitution shows
        // as: our own parser already found a different known place for this slot, or found a place outside India.
        const ownCode = slot === "o" ? heuristic.origin : heuristic.destination;
        if (ownCode && ownCode !== known.code) return {};
        if (heuristic.unknownPlaces?.length) return {};
        return { code: known.code };
      }
      if (known) return { code: known.code }; // looked up before
      return /^\p{L}[\p{L}\p{M}\s.'-]{1,40}$/u.test(s) ? { name: s } : {};
    };
    const po = place(llm.origin, current.origin, "o");
    const pd = place(llm.destination, current.destination, "d");
    const llmAbroad = (Array.isArray((llm as any).outside_india) ? (llm as any).outside_india : []).map(String).filter(Boolean);
    const unknown = new Set<string>(heuristic.unknownPlaces?.length ? heuristic.unknownPlaces : llmAbroad);
    const todayIso = today.toISOString().slice(0, 10);
    const okDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= todayIso ? d : undefined);
    const merged: Intent = {
      ...heuristic,
      ...Object.fromEntries(Object.entries(llm).filter(([k, v]) => v !== null && v !== undefined && v !== "" && !["outside_india", "unknown_places", "origin", "destination"].includes(k))),
      origin: po.code ?? heuristic.origin,
      destination: pd.code ?? heuristic.destination,
      originName: po.code ? undefined : po.name ?? (heuristic.origin ? undefined : heuristic.originName),
      destinationName: pd.code ? undefined : pd.name ?? (heuristic.destination ? undefined : heuristic.destinationName),
      date: okDate(llm.date) ?? okDate(heuristic.date),
      // modes only when the user actually talked about them (the model tends to invent them)
      modes: heuristic.modes ?? (Array.isArray(llm.modes) && llm.modes.length && /mode|transport|साधन|सवारी/i.test(text) ? (llm.modes.filter((m) => ["flight", "train", "cab"].includes(m)) as Mode[]) : undefined),
      lang: heuristic.lang,
      mentioned: heuristic.mentioned,
      // Real place names only: the model sometimes adds made-up codes ("NPL"), or echoes a key name ("unknown_places").
      unknownPlaces: [
        ...new Map(
          [...unknown]
            .map((p) => p.trim())
            .filter((p) => /^\p{L}[\p{L}\p{M}\s.'-]{2,40}$/u.test(p) && !/^[A-Z]{2,4}$/.test(p) && !/unknown|null|none|n\/a/i.test(p) && !findCity(p))
            .map((p) => [p.toLowerCase(), p]),
        ).values(),
      ],
    };
    if (llm.origin && !po.code && !po.name) trace("engine", convId, { step: "intent guard", dropped: { origin: llm.origin }, reason: "not in the user's words" });
    if (llm.destination && !pd.code && !pd.name) trace("engine", convId, { step: "intent guard", dropped: { destination: llm.destination }, reason: "not in the user's words" });
    if (llm.date && merged.date !== llm.date) trace("engine", convId, { step: "intent guard", dropped: { date: llm.date }, reason: "past or invalid date", used: merged.date });
    if (merged.origin && merged.origin === merged.destination) merged.destination = heuristic.destination !== merged.origin ? heuristic.destination : undefined;
    // a place outside India is never also a trip endpoint
    const abroadLower = new Set(merged.unknownPlaces?.map((p) => p.toLowerCase()));
    if (merged.originName && abroadLower.has(merged.originName.toLowerCase())) delete merged.originName;
    if (merged.destinationName && abroadLower.has(merged.destinationName.toLowerCase())) delete merged.destinationName;
    if (!merged.intent) merged.intent = "trip";
    return merged;
  } catch (e) {
    trace("engine", convId, { step: "intent", via: "heuristic (Sarvam error)", error: String(e).slice(0, 200), result: heuristic });
    return heuristic;
  }
}
