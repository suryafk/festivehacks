// Turn free text (typed or transcribed) into a structured trip update.
// Primary: Sarvam-105B with a JSON response. Fallback: a deterministic parser, so the demo never dead-ends.
import { cities, findCity, type Mode } from "./seed.ts";
import type { Trip } from "./planner.ts";
import { chatJson } from "../integrations/sarvam.ts";
import { has } from "../config.ts";
import { trace } from "../bus.ts";

export interface Intent extends Trip {
  intent: "trip" | "join_pool" | "choose" | "reset" | "help" | "other";
  choice?: number;
  lang?: string;
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
  if (/^(reset|restart|start over|new trip|naya)\b|नया/.test(t)) return { ...out, intent: "reset" };
  if (/^(help|hi|hello|namaste|hey)\b|नमस्ते/.test(t) && t.length < 12) return { ...out, intent: "help" };
  if (/\b(pool|join|share cab|share)\b|शेयर|पूल/.test(t)) return { ...out, intent: "join_pool" };
  const num = t.match(/^\s*(\d)\s*$/);
  if (num) return { ...out, intent: "choose", choice: +num[1] };

  // cities in order of appearance
  const found: { code: string; idx: number; kind: string }[] = [];
  for (const c of cities)
    for (const a of [c.code.toLowerCase(), ...c.aliases]) {
      const re = new RegExp(`(^|[^\\p{L}])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u");
      const m = re.exec(t);
      if (m && !found.some((f) => f.code === c.code)) found.push({ code: c.code, idx: m.index, kind: c.kind });
    }
  found.sort((a, b) => a.idx - b.idx);
  const fromMarker = (code: string) => {
    const c = cities.find((x) => x.code === code)!;
    return [c.code.toLowerCase(), ...c.aliases].some((a) => new RegExp(`(from|frm)\\s+${a}|${a}\\s+(se|से)\\b|${a}\\s+से`).test(t));
  };
  if (found.length >= 2) {
    const o = found.find((f) => fromMarker(f.code)) ?? found.find((f) => f.kind === "metro") ?? found[0];
    const d = found.find((f) => f !== o)!;
    out.origin = o.code;
    out.destination = d.code;
  } else if (found.length === 1) {
    const f = found[0];
    if (fromMarker(f.code) || (f.kind === "metro" && !current.origin && current.destination)) out.origin = f.code;
    else out.destination = f.code;
  }
  const { date, flex } = parseDate(text, today);
  if (date) out.date = date;
  if (flex) out.flexDays = flex;
  const modes = parseModes(text);
  if (modes) out.modes = modes;
  const pax = t.match(/(\d)\s*(people|log|लोग|persons|pax|adults)/);
  if (pax) out.travellers = +pax[1];
  if (!found.length && !date && !modes) out.intent = "other";
  return out;
}

const SYSTEM = (today: string, current: Trip) => `You extract travel intent for "Marg Bandhu", an Indian travel assistant.
Today is ${today} (Asia/Kolkata). The user may write or speak in Hindi, English, Hinglish or another Indian language.
Known city codes: ${cities.map((c) => `${c.code}=${c.name}`).join(", ")}.
The trip so far: ${JSON.stringify(current)}.
Return ONLY a JSON object with these keys (omit keys you cannot infer, never invent):
{"intent":"trip"|"join_pool"|"choose"|"reset"|"help"|"other","origin":CODE,"destination":CODE,"date":"YYYY-MM-DD","flexDays":0-3,
 "modes":["flight"|"train"|"cab"],"travellers":number,"choice":number}
Rules: dates without a year mean the next upcoming occurrence. "around/aas-paas" means flexDays 2.
"sab chalega/anything" means all three modes. Only use codes from the list; if a city is not in the list, omit it.`;

export async function extractIntent(text: string, current: Trip, today: Date, convId: string | null): Promise<Intent> {
  const heuristic = heuristicIntent(text, current, today);
  if (!has.sarvam()) {
    trace("engine", convId, { step: "intent", via: "heuristic (no Sarvam key)", result: heuristic });
    return heuristic;
  }
  try {
    const llm = await chatJson<Intent>(SYSTEM(today.toISOString().slice(0, 10), current), text, convId, "extract trip intent");
    const valid = (c?: string) => (c && findCity(c) ? findCity(c)!.code : undefined);
    const merged: Intent = {
      ...heuristic,
      ...Object.fromEntries(Object.entries(llm).filter(([, v]) => v !== null && v !== undefined && v !== "")),
      origin: valid(llm.origin) ?? heuristic.origin,
      destination: valid(llm.destination) ?? heuristic.destination,
      date: /^\d{4}-\d{2}-\d{2}$/.test(llm.date ?? "") ? llm.date : heuristic.date,
      modes: Array.isArray(llm.modes) && llm.modes.length ? (llm.modes.filter((m) => ["flight", "train", "cab"].includes(m)) as Mode[]) : heuristic.modes,
      lang: heuristic.lang,
    };
    if (!merged.intent) merged.intent = "trip";
    return merged;
  } catch (e) {
    trace("engine", convId, { step: "intent", via: "heuristic (Sarvam error)", error: String(e).slice(0, 200), result: heuristic });
    return heuristic;
  }
}
