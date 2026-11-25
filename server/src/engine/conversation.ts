// The shared conversation engine. Channel-agnostic: web and WhatsApp both call `handle()`.
import { convs, messages, j, type ConvRow } from "../db.ts";
import { trace } from "../bus.ts";
import { getFlags, rushKnobs } from "../integrations/flags.ts";
import { textToSpeech, translate } from "../integrations/sarvam.ts";
import { extractIntent, detectLang } from "./intent.ts";
import { plan, airportFor, routeFor, type Itinerary, type Trip } from "./planner.ts";
import { adviseFare } from "./fares.ts";
import { explainFare } from "./fareExplain.ts";
import { t, langKey, cityName, rupee } from "./i18n.ts";
import { createWatch } from "./fareWatch.ts";
import { cityByCode, type Mode } from "./seed.ts";
import { resolvePlace, namesFor, withHub, type Resolved } from "./places.ts";
import { addSimulatedRider, createRequest, ensureSeedRiders, poolOf, previewCount, waitingNear } from "./pools.ts";
import { splitFare, compatible } from "./pooling.ts";
import { getLiveFares, type LiveFlight } from "../integrations/googleFlights.ts";

export type Action =
  | { type: "set_modes"; modes: Mode[] }
  | { type: "set_trip"; trip: Trip }
  | { type: "join_pool"; itineraryId?: string }
  | { type: "simulate_rider" }
  | { type: "watch_fare" }
  | { type: "reset" }
  | { type: "track"; event: string };

export interface Input {
  text?: string;
  action?: Action;
  wasVoice?: boolean;
  voiceLang?: string;
}

export interface Card {
  type: string;
  [k: string]: unknown;
}

export interface Reply {
  text: string;
  lang: string;
  cards: Card[];
  quickReplies: string[];
  audioUrl?: string | null;
  stage: string;
}

const MODE_CHIPS = ["✈️ Flight", "🚆 Train", "🚕 Cab", "Any"];
const EXAMPLES = ["Bengaluru to Gonda around 26 Dec", "Delhi to Shimla 28 Dec", "Mumbai to Darbhanga 2 Jan"];

type Missing = Extract<Resolved, { ok: false }>;

/** Free-text place names from the intent (Sarvam or the fallback parser) → place codes. */
async function resolveNames(intent: { origin?: string; destination?: string; originName?: string; destinationName?: string }, convId: string): Promise<Missing[]> {
  const missing: Missing[] = [];
  for (const [k, nk] of [["origin", "originName"], ["destination", "destinationName"]] as const) {
    if (intent[k] || !intent[nk]) continue;
    const r = await resolvePlace(intent[nk]!, convId);
    if (r.ok) intent[k] = r.city.code;
    else missing.push(r);
  }
  return missing;
}

export async function handle(conv: ConvRow, input: Input): Promise<Reply> {
  const today = new Date();
  let trip: Trip = j(conv.trip, {});
  let lang = input.voiceLang ?? (input.text && /\p{L}{3,}/u.test(input.text) ? detectLang(input.text) : conv.lang) ?? "en-IN";
  // keep a Hindi conversation in Hindi even if the user types a city name in English
  if (lang === "en-IN" && conv.lang === "hi-IN" && input.text && input.text.split(/\s+/).length < 4) lang = "hi-IN";
  const l = langKey(lang);
  const dest = trip.destination ? cityByCode.get(trip.destination) : undefined;
  const flags = await getFlags(conv.user_ref ?? conv.id, { channel: conv.channel, destination_hub: dest?.hub ?? dest?.code ?? "unknown", lang }, conv.id);

  const reply = (text: string, extra: Partial<Reply> = {}): Reply => ({ text, lang, cards: [], quickReplies: [], stage: conv.stage, ...extra });
  let out: Reply;

  const a = input.action;
  if (a?.type === "reset") {
    trip = {};
    convs.update(conv.id, { trip: "{}", plan: null, stage: "NEW" });
    out = reply(`${t.reset(l)} ${t.welcome(l)}`, { stage: "NEW" });
  } else if (a?.type === "join_pool") {
    out = await joinPool(conv, a.itineraryId, flags.pooling_enabled, l, reply);
  } else if (a?.type === "watch_fare") {
    out = watchFare(conv, l, reply);
  } else if (a?.type === "simulate_rider") {
    const who = addSimulatedRider(conv.id);
    out = reply(who ? (l === "hi" ? `(डेमो) ${who} ने आपके रास्ते के लिए पूल जॉइन किया…` : `(demo) ${who} just asked for a pool on your route…`) : "Join a pool first.");
  } else {
    if (a?.type === "set_modes") trip = { ...trip, modes: a.modes };
    else if (a?.type === "set_trip") {
      const r = await sanitizeTrip(a.trip, conv.id);
      trip = r.trip;
      if (r.missing.length) {
        const by = (k: Missing["reason"]) => r.missing.filter((m) => m.reason === k).map((m) => m.name);
        out = reply(t.placeProblem(l, by("abroad"), by("not_found"), by("lookup_failed")), { stage: "COLLECTING", quickReplies: EXAMPLES });
        return finish(conv, input, out, lang, trip);
      }
    }
    else if (input.text) {
      const intent = await extractIntent(input.text, trip, today, conv.id);
      if (intent.intent === "reset") return handle(conv, { ...input, text: undefined, action: { type: "reset" } });
      if (intent.intent === "join_pool") return handle(conv, { ...input, text: undefined, action: { type: "join_pool" } });
      if (intent.intent === "watch_fare") return handle(conv, { ...input, text: undefined, action: { type: "watch_fare" } });
      if (intent.intent === "help" && !trip.destination) {
        out = reply(t.welcome(l), { quickReplies: ["Bengaluru to Gonda around 26 Dec", "26 दिसंबर के आसपास बेंगलुरु से गोरखपुर", "Delhi to Shimla 28 Dec"] });
        return finish(conv, input, out, lang, trip);
      }
      const missing = await resolveNames(intent, conv.id);
      if (intent.unknownPlaces?.length || missing.length) {
        const abroad = [...(intent.unknownPlaces ?? []), ...missing.filter((m) => m.reason === "abroad").map((m) => m.name)];
        const notFound = missing.filter((m) => m.reason === "not_found").map((m) => m.name);
        const failed = missing.filter((m) => m.reason === "lookup_failed").map((m) => m.name);
        out = reply(t.placeProblem(l, abroad, notFound, failed), { stage: "COLLECTING", quickReplies: EXAMPLES });
        trace("engine", conv.id, { step: "place not found", abroad, notFound });
        return finish(conv, input, out, lang, trip);
      }
      for (const k of ["origin", "destination", "date", "flexDays", "modes", "travellers"] as const)
        if (intent[k] !== undefined && intent[k] !== null) (trip as Record<string, unknown>)[k] = intent[k];
    }
    out = await nextStep(conv, trip, flags, today, l, reply);
  }
  return finish(conv, input, out, lang, trip);
}

async function finish(conv: ConvRow, input: Input, out: Reply, lang: string, trip: Trip): Promise<Reply> {
  // other Indian languages: translate our English copy with Sarvam Mayura
  if (!["en-IN", "hi-IN"].includes(lang)) out.text = await translate(out.text, lang, conv.id);
  if (input.wasVoice) out.audioUrl = await textToSpeech(spokenVersion(out.text, lang), lang, conv.id);
  convs.update(conv.id, { trip: JSON.stringify(trip), lang, stage: out.stage });
  trace("engine", conv.id, { step: "reply", stage: out.stage, wasVoice: Boolean(input.wasVoice), lang, cards: out.cards.map((c) => c.type) });
  return out;
}

// Speak the headline, not the timetable.
// Arrows and abbreviations read badly aloud ("→" was spoken as "gives"), so say them as words.
const spokenVersion = (text: string, lang: string) =>
  text
    .split("\n")
    .filter((line) => !/^\s*[•\-\d]/.test(line))
    .join(" ")
    .replace(/\s*→\s*/g, lang.startsWith("hi") ? " से " : " to ")
    .replace(/दिस॰/g, "दिसंबर")
    .replace(/[🎙️⏰💰💡🚕👀🎉✈️🚆]/gu, "")
    .slice(0, 450);

async function nextStep(conv: ConvRow, trip: Trip, flags: Awaited<ReturnType<typeof getFlags>>, today: Date, l: "en" | "hi", reply: (t: string, e?: Partial<Reply>) => Reply): Promise<Reply> {
  if (!trip.destination) return reply(t.askDestination(l), { stage: "COLLECTING", quickReplies: ["Gonda", "Gorakhpur", "Patna", "Jaunpur"] });
  if (!trip.origin) return reply(t.askOrigin(l), { stage: "COLLECTING", quickReplies: ["Bengaluru", "Delhi", "Mumbai", "Hyderabad"] });
  if (!trip.date) return reply(t.askDate(l, trip.destination), { stage: "COLLECTING", quickReplies: ["24 Dec", "26 Dec", "30 Dec"] });
  if (!trip.modes?.length) return reply(t.askModes(l), { stage: "COLLECTING", quickReplies: MODE_CHIPS, cards: [{ type: "ask-modes" }] });

  const o = cityByCode.get(trip.origin);
  const dst = cityByCode.get(trip.destination);
  if (!o || !dst) return reply(t.askDestination(l), { stage: "COLLECTING", quickReplies: EXAMPLES });
  withHub(o); // nearest airport + backup airport, however the place was recognised
  withHub(dst);
  if (o.code === dst.code) return reply(t.samePlace(l), { stage: "COLLECTING", quickReplies: EXAMPLES });

  const knobs = rushKnobs(flags);

  // Which airports to fly between: the nearest suitable ones, then (if Google has no flights there) the backup
  // airports. At most two live searches per plan, each cached for 6 h (SerpApi free plan = 250 / month).
  const pairs: [string, string][] = [];
  const oA = airportFor(o), dA = airportFor(dst);
  if (oA && dA && oA !== dA) pairs.push([oA, dA]);
  const alt: [string | undefined, string | undefined] = [o.altHub ?? oA, dst.altHub ?? dA];
  if (alt[0] && alt[1] && alt[0] !== alt[1] && !pairs.some(([a, b]) => a === alt[0] && b === alt[1])) pairs.push([alt[0], alt[1]]);
  const liveMap = new Map<string, LiveFlight[]>();
  const noFlights = new Set<string>();
  let liveFares: Awaited<ReturnType<typeof getLiveFares>> = null;
  if (flags.live_fares_enabled && trip.modes?.includes("flight") && trip.date) {
    for (const [a, b] of pairs) {
      const lf = await getLiveFares(a, b, trip.date, conv.id);
      if (!lf) break; // API error / no key: simulated fares from here on
      if (lf.flights.length) { liveFares = lf; liveMap.set(`${a}-${b}-${trip.date}`, lf.flights); break; }
      noFlights.add(`${a}-${b}`); // Google: no flights on this pair; try the next one, never invent flights here
    }
  }
  // first pair that isn't known to be flight-less (the planner skips flights entirely if none is left)
  const chosen = pairs.find(([a, b]) => !noFlights.has(`${a}-${b}`)) ?? pairs[0];
  trace("engine", conv.id, { step: "airports", origin: o.name, dest: dst.name, pairs: pairs.map((p) => p.join("→")), chosen: chosen?.join("→"), noFlights: [...noFlights] });

  const its = plan(trip as Required<Pick<Trip, "origin" | "destination" | "date">> & Trip, {
    bufferMin: knobs.bufferMin, fareModel: flags.fare_model, today, live: liveMap, noFlights,
    airports: chosen ? { origin: chosen[0], dest: chosen[1] } : undefined,
  });
  trace("engine", conv.id, { step: "plan", options: its.length, bufferMin: knobs.bufferMin, festive_rush_mode: flags.festive_rush_mode });
  if (!its.length) return reply(t.noRoute(l), { stage: "COLLECTING", quickReplies: MODE_CHIPS, cards: [{ type: "ask-modes" }] });

  // Honest notes about what's estimated or missing on this route.
  const notes: string[] = [];
  if (trip.modes?.includes("train") && !its.some((i) => i.legs.some((x) => x.mode === "train"))) notes.push(t.noTrainData(l));
  if (trip.modes?.includes("flight") && noFlights.size && !its.some((i) => i.flight)) notes.push(t.noFlightsFound(l));
  const codes = [trip.origin, trip.destination, ...its.flatMap((i) => i.legs.flatMap((x) => [x.from, x.to]))];
  const cards: Card[] = [{ type: "plan", trip, itineraries: its, bufferMin: knobs.bufferMin, festiveRush: flags.festive_rush_mode, notes, names: namesFor(codes) }];
  const lines = [t.planIntro(l, trip)];
  const best = its[0];
  lines.push(...best.legs.filter((x) => x.mode !== "transfer").map((leg) => `• ${t.legLine(l, leg)}`));

  // Price outlook is for the main flight route on the requested date. With live Google data it always uses that,
  // whichever itinerary (possibly a ±flex day) ended up recommended.
  const [flyFrom, flyTo] = chosen ?? [];
  const seedRoute = flyFrom && flyTo ? routeFor(flyFrom, flyTo) : undefined;
  const fl = liveFares && flyFrom && flyTo
    ? { from: flyFrom, to: flyTo, baseFare: seedRoute?.baseFare ?? liveFares.insights.lowestPrice ?? 6000, date: trip.date! }
    : (its.find((i) => i.flight && i.date === trip.date) ?? its.find((i) => i.flight))?.flight;
  if (fl) {
    const useLive = Boolean(liveFares && fl.date === trip.date && fl.to === flyTo && fl.from === flyFrom);
    const lowest = useLive ? liveFares!.insights.lowestPrice ?? Math.min(...liveFares!.flights.map((f) => f.price)) : 0;
    const advice = adviseFare(fl.baseFare, fl.date, today, flags.fare_model, `${fl.from}${fl.to}`, useLive
      ? { lowestPrice: lowest, priceLevel: liveFares!.insights.priceLevel, typicalRange: liveFares!.insights.typicalRange, history: liveFares!.insights.history, fetchedAt: liveFares!.fetchedAt }
      : undefined);
    // Live fares: the pointer comes from the real price history, explained in the user's language (Sarvam,
    // numbers checked). Simulated fares keep the old model and its wording.
    const routeName = `${cityByCode.get(fl.from)?.name ?? fl.from} → ${cityByCode.get(fl.to)?.name ?? fl.to}`;
    const exp = advice.method === "history" ? await explainFare(advice, routeName, fl.date, l, flags.book_nudge_copy, conv.id, flags.fare_explainer_enabled) : undefined;
    cards.push({ type: "fare", advice, variant: flags.book_nudge_copy, route: `${fl.from}→${fl.to}`, explanation: exp?.text, explainedBy: exp?.via });
    lines.push(exp ? `${advice.verdict === "monitor" ? "👀" : "⏰"} ${exp.text}` : t.nudge(l, flags.book_nudge_copy, advice));
    trace("engine", conv.id, {
      step: "fare advice", source: advice.source, method: advice.method, verdict: advice.verdict, reason: advice.reason, currentFare: advice.currentFare,
      evidence: advice.evidence && { days: advice.evidence.days, cheaperThanPct: advice.evidence.cheaperThanPct, trendPct: advice.evidence.trendPct, drop7: advice.evidence.drop.find((d) => d.days === 7) },
      backtest: advice.backtest, explainedBy: exp?.via, abVariant: flags.book_nudge_copy,
    });
  }

  const poolIt = its.find((i) => i.pool);
  if (poolIt?.pool && flags.pooling_enabled) {
    const p = poolIt.pool;
    ensureSeedRiders(p.hub, p.arriveAt, p.town, p.km);
    const w = { ...flags.split_weights, windowMin: knobs.poolWindowMin };
    const meRider = { id: "__me", name: conv.name ?? "You", hub: p.hub, town: p.town, arriveAt: p.arriveAt, dropKm: p.km };
    const n = previewCount(meRider, w);
    const others = waitingNear(p.hub, p.arriveAt, w.windowMin)
      .map((r) => ({ id: r.id, name: r.name, hub: r.hub, town: r.town, arriveAt: r.arrive_at, dropKm: r.drop_km }))
      .filter((r) => compatible(meRider, r, w))
      .slice(0, w.maxRiders - 1);
    const est = others.length ? splitFare([meRider, ...others], w).lines.find((x) => x.riderId === "__me")?.pays : undefined;
    cards.push({ type: "pool-preview", itineraryId: poolIt.id, hub: p.hub, town: p.town, waiting: n, soloFare: p.soloFare, estShare: est, arriveAt: p.arriveAt });
    lines.push(t.poolPreview(l, n, p.town));
  }
  lines.push(...notes);
  if (flags.degrade_gracefully) lines.push(t.degraded(l));
  convs.update(conv.id, { plan: JSON.stringify(its) });
  return reply(lines.join("\n"), { stage: "PLAN_READY", cards, quickReplies: poolIt && flags.pooling_enabled ? ["pool", "reset"] : ["reset"] });
}

async function joinPool(conv: ConvRow, itineraryId: string | undefined, enabled: boolean, l: "en" | "hi", reply: (t: string, e?: Partial<Reply>) => Reply): Promise<Reply> {
  if (!enabled) return reply(t.poolOff(l));
  const its = j<Itinerary[]>(conv.plan, []);
  const it = its.find((i) => i.id === itineraryId && i.pool) ?? its.find((i) => i.pool);
  if (!it?.pool) return reply(t.noPoolable(l), { quickReplies: ["🚕 Cab", "Any"] });
  const p = it.pool;
  const id = createRequest(conv.id, conv.name ?? "Traveller", p.hub, p.town, p.arriveAt, p.km);
  const status = poolOf(conv.id);
  return reply(t.poolWaiting(l), {
    stage: "WATCHING",
    cards: [{ type: "pool", status: "waiting", requestId: id, hub: p.hub, town: p.town, arriveAt: p.arriveAt, soloFare: p.soloFare, request: status?.request }],
  });
}

/** Record + run a user turn. Used by every channel. */
export async function turn(conv: ConvRow, input: Input, displayText?: string) {
  if (displayText ?? input.text) messages.add(conv.id, "user", displayText ?? input.text!, input.wasVoice ? { voice: true } : undefined);
  const out = await handle(conv, input);
  messages.add(conv.id, "bot", out.text, { cards: out.cards, quickReplies: out.quickReplies, audioUrl: out.audioUrl, stage: out.stage });
  return out;
}

/** Trip submitted from the web form: keep only known fields/values. From / To may be a code or a typed place name. */
async function sanitizeTrip(x: Trip, convId: string): Promise<{ trip: Trip; missing: Missing[] }> {
  const missing: Missing[] = [];
  const place = async (v?: string) => {
    if (!v?.trim()) return undefined;
    const r = await resolvePlace(v, convId);
    if (r.ok) return r.city.code;
    missing.push(r);
    return undefined;
  };
  const out: Trip = {
    origin: await place(x.origin),
    destination: await place(x.destination),
    date: /^\d{4}-\d{2}-\d{2}$/.test(x.date ?? "") ? x.date : undefined,
    flexDays: Math.max(0, Math.min(3, Number(x.flexDays ?? 1) || 0)),
    modes: (x.modes ?? []).filter((m) => ["flight", "train", "cab"].includes(m)) as Mode[],
    travellers: Math.max(1, Math.min(6, Number(x.travellers ?? 1) || 1)),
  };
  return { trip: out, missing };
}

/** "WATCH": alert this conversation when the flight fare in its latest plan drops (web + WhatsApp). */
function watchFare(conv: ConvRow, l: "en" | "hi", reply: (t: string, e?: Partial<Reply>) => Reply): Reply {
  const fareCard = messages.list(conv.id).reverse().flatMap((m) => ((m.payload as any)?.cards ?? []) as Card[]).find((c) => c.type === "fare") as any;
  const its = j<Itinerary[]>(conv.plan, []);
  const fl = its.find((i) => i.flight)?.flight;
  if (!fareCard || !fl) return reply(l === "hi" ? "पहले एक यात्रा प्लान कीजिए, फिर मैं किराये पर नज़र रखूँगा।" : "Plan a trip first, then I can watch its fare for you.");
  const [from, to] = String(fareCard.route).split("→");
  const w = createWatch(conv.id, from || fl.from, to || fl.to, fl.date, fl.baseFare, fareCard.advice.currentFare);
  if (!w) return reply("Couldn't start the fare watch.");
  return reply(
    l === "hi"
      ? `👀 ठीक है! ${cityName(w.origin, l)} → ${cityName(w.dest, l)} (${w.date}) का किराया अभी ${rupee(w.start_fare)} है। ${rupee(w.target)} से नीचे जाते ही मैं आपको मैसेज करूँगा।`
      : `👀 Done! Watching ${cityName(w.origin)} → ${cityName(w.dest)} for ${w.date}. It's ${rupee(w.start_fare)} now; I'll message you as soon as it drops below ${rupee(w.target)}.`,
    { stage: conv.stage },
  );
}
