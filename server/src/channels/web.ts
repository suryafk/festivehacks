// Web channel adapter: REST + Server-Sent Events. Same engine as WhatsApp.
import type { FastifyInstance, FastifyReply } from "fastify";
import { convs, messages, db, j } from "../db.ts";
import { bus, trace } from "../bus.ts";
import { turn, type Input } from "../engine/conversation.ts";
import { speechToText } from "../integrations/sarvam.ts";
import { getFlags } from "../integrations/flags.ts";
import { config, has } from "../config.ts";
import { poolOf, ensureSeedRiders, waitingNear } from "../engine/pools.ts";
import { extractIntent } from "../engine/intent.ts";
import { createWatch, getWatch, simulateDrop } from "../engine/fareWatch.ts";
import { cityByCode } from "../engine/seed.ts";
import { compatible } from "../engine/pooling.ts";
import { rushKnobs } from "../integrations/flags.ts";
import type { Itinerary, Trip } from "../engine/planner.ts";
import { t } from "../engine/i18n.ts";
import { sendWhatsApp } from "../integrations/whatsapp.ts";

export function sse(reply: FastifyReply, channel: string, replay: () => unknown[] = () => []) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const send = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  for (const ev of replay()) send(ev);
  bus.on(channel, send);
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  res.on("close", () => {
    clearInterval(ping);
    bus.off(channel, send);
  });
}

export function webRoutes(app: FastifyInstance) {
  app.get("/api/config", async () => {
    const f = await getFlags();
    return {
      voiceInput: f.voice_input_enabled,
      judgeControls: f.judge_controls,
      whatsapp: f.whatsapp_channel_enabled,
      festiveRush: f.festive_rush_mode,
      sponsors: { sarvam: has.sarvam(), flagsmith: has.flagsmith() && f.source === "flagsmith", twilio: has.twilio() },
      sandbox: { number: config.twilio.from.replace("whatsapp:", ""), join: process.env.TWILIO_SANDBOX_JOIN ?? "" },
    };
  });

  app.post("/api/conversations", async (req) => {
    const { name } = (req.body ?? {}) as { name?: string };
    const conv = convs.create("web", null, name?.slice(0, 30) || "Traveller");
    convs.update(conv.id, { user_ref: `web-${conv.id}` });
    const welcome = t.welcome("en");
    messages.add(conv.id, "bot", welcome, { quickReplies: ["Bengaluru to Gonda around 26 Dec", "26 दिसंबर के आसपास बेंगलुरु से गोरखपुर जाना है"] });
    return { id: conv.id };
  });

  app.get("/api/conversations/:id", async (req, reply) => {
    const conv = convs.get((req.params as { id: string }).id);
    if (!conv) return reply.code(404).send({ error: "not found" });
    return { id: conv.id, name: conv.name, stage: conv.stage, lang: conv.lang, trip: j(conv.trip, {}), whatsapp: Boolean(conv.whatsapp), messages: messages.list(conv.id), pool: poolOf(conv.id) };
  });

  app.post("/api/conversations/:id/message", async (req, reply) => {
    const conv = convs.get((req.params as { id: string }).id);
    if (!conv) return reply.code(404).send({ error: "not found" });
    const body = (req.body ?? {}) as Input & { display?: string };
    if (body.text) body.text = body.text.slice(0, 500);
    const display = body.action ? undefined : body.wasVoice ? `🎙️ ${body.text}` : body.text;
    const out = await turn(conv, body, display);
    return out;
  });

  // Voice step 1 (web): transcribe only. The UI shows the transcript for the user to confirm/edit, then sends it as a message.
  app.post("/api/conversations/:id/voice", async (req, reply) => {
    const conv = convs.get((req.params as { id: string }).id);
    if (!conv) return reply.code(404).send({ error: "not found" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "no audio" });
    const buf = await file.toBuffer();
    try {
      return await speechToText(buf, file.mimetype, conv.id);
    } catch (e) {
      return reply.code(502).send({ error: String(e).slice(0, 200) });
    }
  });

  app.post("/api/conversations/:id/whatsapp", async (req, reply) => {
    const conv = convs.get((req.params as { id: string }).id);
    if (!conv) return reply.code(404).send({ error: "not found" });
    const { phone } = (req.body ?? {}) as { phone?: string };
    const digits = (phone ?? "").replace(/[^\d+]/g, "");
    if (!/^\+?\d{10,15}$/.test(digits)) return reply.code(400).send({ error: "invalid number" });
    const e164 = digits.startsWith("+") ? digits : digits.length === 10 ? `+91${digits}` : `+${digits}`;
    convs.update(conv.id, { whatsapp: `whatsapp:${e164}` });
    await sendWhatsApp(`whatsapp:${e164}`, "✅ Marg Bandhu will send your trip alerts here.", null, conv.id);
    return { ok: true };
  });

  app.get("/api/conversations/:id/stream", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!convs.get(id)) return reply.code(404).send({ error: "not found" });
    const recent = () =>
      (db.prepare("SELECT ts, kind, data FROM events WHERE conv_id = ? ORDER BY id DESC LIMIT 40").all(id) as { ts: number; kind: string; data: string }[])
        .reverse()
        .map((e) => ({ type: "trace", ts: e.ts, kind: e.kind, convId: id, data: j(e.data, {}) }));
    sse(reply, `conv:${id}`, recent);
  });

  // Plan page: turn a typed / spoken sentence into form fields (Sarvam-105B with heuristic fallback).
  app.post("/api/conversations/:id/parse", async (req, reply) => {
    const conv = convs.get((req.params as { id: string }).id);
    if (!conv) return reply.code(404).send({ error: "not found" });
    const { text } = (req.body ?? {}) as { text?: string };
    if (!text?.trim()) return reply.code(400).send({ error: "empty" });
    const current = j<Trip>(conv.trip, {});
    const intent = await extractIntent(text.slice(0, 500), current, new Date(), conv.id);
    return { origin: intent.origin, destination: intent.destination, date: intent.date, flexDays: intent.flexDays, modes: intent.modes, travellers: intent.travellers, lang: intent.lang };
  });

  // Cab-mates map: who else lands at my hub around my time, and where they're headed.
  app.get("/api/conversations/:id/cabmates", async (req, reply) => {
    const conv = convs.get((req.params as { id: string }).id);
    if (!conv) return reply.code(404).send({ error: "not found" });
    const its = j<Itinerary[]>(conv.plan, []);
    const it = its.find((i) => i.pool);
    if (!it?.pool) return reply.code(409).send({ error: "no cab leg in this plan" });
    const p = it.pool;
    const f = await getFlags(conv.user_ref ?? conv.id);
    const w = { ...f.split_weights, windowMin: rushKnobs(f).poolWindowMin };
    ensureSeedRiders(p.hub, p.arriveAt);
    const me = { id: "__me", name: conv.name ?? "You", hub: p.hub, town: p.town, arriveAt: p.arriveAt, dropKm: p.km };
    const mine = poolOf(conv.id);
    const riders = waitingNear(p.hub, p.arriveAt, 180)
      .filter((r) => r.conv_id !== conv.id)
      .map((r) => {
        const c = cityByCode.get(r.town)!;
        const rr = { id: r.id, name: r.name, hub: r.hub, town: r.town, arriveAt: r.arrive_at, dropKm: r.drop_km };
        return { id: r.id, name: r.name, town: r.town, townName: c.name, lat: c.lat, lng: c.lng, arriveAt: r.arrive_at, dropKm: r.drop_km, compatible: compatible(me, rr, w) };
      });
    const hub = cityByCode.get(p.hub)!;
    const dest = cityByCode.get(p.town)!;
    const towns = [...new Set(riders.map((r) => r.town))].map((code) => {
      const c = cityByCode.get(code)!;
      const list = riders.filter((r) => r.town === code);
      return { code, name: c.name, lat: c.lat, lng: c.lng, count: list.length, compatible: list.some((r) => r.compatible) };
    });
    return {
      hub: { code: hub.code, name: hub.name, lat: hub.lat, lng: hub.lng },
      me: { town: dest.code, townName: dest.name, lat: dest.lat, lng: dest.lng, arriveAt: p.arriveAt, km: p.km, soloFare: p.soloFare, itineraryId: it.id },
      windowMin: w.windowMin,
      riders,
      towns,
      pool: mine,
    };
  });

  app.post("/api/conversations/:id/fare-watch", async (req, reply) => {
    const conv = convs.get((req.params as { id: string }).id);
    if (!conv) return reply.code(404).send({ error: "not found" });
    const its = j<Itinerary[]>(conv.plan, []);
    const fl = its.find((i) => i.flight);
    if (!fl?.flight) return reply.code(409).send({ error: "no flight in this plan" });
    const { currentFare } = (req.body ?? {}) as { currentFare?: number };
    const leg = fl.legs.find((l) => l.mode === "flight");
    return createWatch(conv.id, fl.flight.from, fl.flight.to, fl.flight.date, fl.flight.baseFare, Number(currentFare) || leg?.fare || fl.flight.baseFare);
  });
  app.get("/api/conversations/:id/fare-watch", async (req) => getWatch((req.params as { id: string }).id) ?? null);
  app.post("/api/conversations/:id/fare-watch/simulate-drop", async (req, reply) => {
    const f = await getFlags();
    if (!f.judge_controls) return reply.code(403).send({ error: "judge_controls flag is off" });
    return { ok: await simulateDrop((req.params as { id: string }).id) };
  });

  // A/B test conversion: user tapped the "book" CTA
  app.post("/api/track", async (req) => {
    const { convId, event, variant } = (req.body ?? {}) as { convId?: string; event?: string; variant?: string };
    trace("flagsmith", convId ?? null, { experiment: "book_nudge_copy", event, variant });
    return { ok: true };
  });

  app.get("/audio/:file", async (req, reply) => {
    const file = (req.params as { file: string }).file;
    if (!/^[\w-]+\.wav$/.test(file)) return reply.code(400).send();
    return reply.sendFile(file, config.dataDir + "audio");
  });
}
