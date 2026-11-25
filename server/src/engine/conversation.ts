// The shared conversation engine. Channel-agnostic: web and WhatsApp both call `handle()`.
import { convs, messages, j, type ConvRow } from "../db.ts";
import { trace } from "../bus.ts";
import { getFlags, rushKnobs } from "../integrations/flags.ts";
import { textToSpeech, translate } from "../integrations/sarvam.ts";
import { extractIntent, detectLang } from "./intent.ts";
import { plan, type Itinerary, type Trip } from "./planner.ts";
import { adviseFare } from "./fares.ts";
import { t, langKey } from "./i18n.ts";
import { cityByCode, type Mode } from "./seed.ts";
import { addSimulatedRider, createRequest, ensureSeedRiders, poolOf, previewCount, waitingNear } from "./pools.ts";
import { splitFare, compatible } from "./pooling.ts";

export type Action =
  | { type: "set_modes"; modes: Mode[] }
  | { type: "join_pool"; itineraryId?: string }
  | { type: "simulate_rider" }
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
  } else if (a?.type === "simulate_rider") {
    const who = addSimulatedRider(conv.id);
    out = reply(who ? (l === "hi" ? `(डेमो) ${who} ने आपके रास्ते के लिए पूल जॉइन किया…` : `(demo) ${who} just asked for a pool on your route…`) : "Join a pool first.");
  } else {
    if (a?.type === "set_modes") trip = { ...trip, modes: a.modes };
    else if (input.text) {
      const intent = await extractIntent(input.text, trip, today, conv.id);
      if (intent.intent === "reset") return handle(conv, { ...input, text: undefined, action: { type: "reset" } });
      if (intent.intent === "join_pool") return handle(conv, { ...input, text: undefined, action: { type: "join_pool" } });
      if (intent.intent === "help" && !trip.destination) {
        out = reply(t.welcome(l), { quickReplies: ["Bengaluru to Gonda around 26 Dec", "26 दिसंबर के आसपास बेंगलुरु से गोरखपुर"] });
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
  if (input.wasVoice) out.audioUrl = await textToSpeech(spokenVersion(out.text), lang, conv.id);
  convs.update(conv.id, { trip: JSON.stringify(trip), lang, stage: out.stage });
  trace("engine", conv.id, { step: "reply", stage: out.stage, wasVoice: Boolean(input.wasVoice), lang, cards: out.cards.map((c) => c.type) });
  return out;
}

// Speak the headline, not the timetable.
const spokenVersion = (text: string) => text.split("\n").filter((line) => !/^\s*[•\-\d]/.test(line)).join(" ").replace(/[🎙️⏰💰💡🚕👀🎉✈️🚆]/gu, "").slice(0, 450);

async function nextStep(conv: ConvRow, trip: Trip, flags: Awaited<ReturnType<typeof getFlags>>, today: Date, l: "en" | "hi", reply: (t: string, e?: Partial<Reply>) => Reply): Promise<Reply> {
  if (!trip.destination) return reply(t.askDestination(l), { stage: "COLLECTING", quickReplies: ["Gonda", "Gorakhpur", "Patna", "Jaunpur"] });
  if (!trip.origin) return reply(t.askOrigin(l), { stage: "COLLECTING", quickReplies: ["Bengaluru", "Delhi", "Mumbai", "Hyderabad"] });
  if (!trip.date) return reply(t.askDate(l, trip.destination), { stage: "COLLECTING", quickReplies: ["24 Dec", "26 Dec", "30 Dec"] });
  if (!trip.modes?.length) return reply(t.askModes(l), { stage: "COLLECTING", quickReplies: MODE_CHIPS, cards: [{ type: "ask-modes" }] });

  const knobs = rushKnobs(flags);
  const its = plan(trip as Required<Pick<Trip, "origin" | "destination" | "date">> & Trip, { bufferMin: knobs.bufferMin, fareModel: flags.fare_model, today });
  trace("engine", conv.id, { step: "plan", options: its.length, bufferMin: knobs.bufferMin, festive_rush_mode: flags.festive_rush_mode });
  if (!its.length) return reply(t.noRoute(l), { stage: "COLLECTING", quickReplies: MODE_CHIPS, cards: [{ type: "ask-modes" }] });

  const cards: Card[] = [{ type: "plan", trip, itineraries: its, bufferMin: knobs.bufferMin, festiveRush: flags.festive_rush_mode }];
  const lines = [t.planIntro(l, trip)];
  const best = its[0];
  lines.push(...best.legs.filter((x) => x.mode !== "transfer").map((leg) => `• ${t.legLine(l, leg)}`));

  const fl = its.find((i) => i.flight)?.flight;
  if (fl) {
    const advice = adviseFare(fl.baseFare, fl.date, today, flags.fare_model, `${fl.from}${fl.to}`);
    cards.push({ type: "fare", advice, variant: flags.book_nudge_copy, route: `${fl.from}→${fl.to}` });
    lines.push(t.nudge(l, flags.book_nudge_copy, advice));
    trace("engine", conv.id, { step: "fare advice", verdict: advice.verdict, currentFare: advice.currentFare, abVariant: flags.book_nudge_copy });
  }

  const poolIt = its.find((i) => i.pool);
  if (poolIt?.pool && flags.pooling_enabled) {
    const p = poolIt.pool;
    ensureSeedRiders(p.hub, p.arriveAt);
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
