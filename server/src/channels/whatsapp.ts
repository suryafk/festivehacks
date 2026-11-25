// WhatsApp channel adapter (Twilio sandbox webhook). Same engine as the web app.
import type { FastifyInstance } from "fastify";
import { convs } from "../db.ts";
import { turn } from "../engine/conversation.ts";
import { downloadMedia, sendWhatsApp, mask } from "../integrations/whatsapp.ts";
import { speechToText } from "../integrations/sarvam.ts";
import { getFlags } from "../integrations/flags.ts";
import { trace } from "../bus.ts";
import { t, langKey } from "../engine/i18n.ts";
import { formatPlanForWhatsApp } from "./waFormat.ts";

export function whatsappRoutes(app: FastifyInstance) {
  app.post("/webhooks/whatsapp", async (req, reply) => {
    const body = req.body as Record<string, string>;
    // Ack immediately: Sarvam calls can take longer than Twilio's 15 s webhook timeout. We reply via the REST API.
    reply.type("text/xml").send("<Response></Response>");
    processInbound(body).catch((e) => trace("twilio", null, { error: String(e) }));
  });
}

async function processInbound(body: Record<string, string>) {
  const from = body.From;
  if (!from) return;
  const flags = await getFlags(from);
  if (!flags.whatsapp_channel_enabled) return;
  let conv = convs.byUser(from) ?? convs.create("whatsapp", from, body.ProfileName || "Traveller");
  trace("twilio", conv.id, { inbound: true, from: mask(from), media: Number(body.NumMedia ?? 0) });

  let text = body.Body?.trim() ?? "";
  let wasVoice = false;
  let voiceLang: string | undefined;
  if (Number(body.NumMedia ?? 0) > 0 && (body.MediaContentType0 ?? "").startsWith("audio")) {
    try {
      const audio = await downloadMedia(body.MediaUrl0);
      const stt = await speechToText(audio, body.MediaContentType0, conv.id);
      text = stt.transcript;
      voiceLang = stt.lang;
      wasVoice = true;
    } catch (e) {
      trace("sarvam", conv.id, { api: "speech-to-text", error: String(e) });
      await sendWhatsApp(from, "Sorry, I couldn't hear that clearly. Could you type it, or send the voice note again?", null, conv.id);
      return;
    }
  }
  if (!text) return;
  const out = await turn(conv, { text, wasVoice, voiceLang }, wasVoice ? `🎙️ ${text}` : text);
  conv = convs.get(conv.id)!;
  const l = langKey(out.lang);
  // Voice path differs slightly: echo what we heard so the user can correct it by just replying.
  const heard = wasVoice ? t.heard(l, text) + "\n\n" : "";

  // A full plan gets the detailed WhatsApp layout (route, alternatives, price outlook, cab mates, link).
  const detailed = out.stage === "PLAN_READY" ? formatPlanForWhatsApp(out.cards, out.lang, conv.id) : null;
  if (detailed?.length) {
    for (const [i, msg] of detailed.entries()) {
      // voice note (if any) rides on the first message; messages go out in order
      await sendWhatsApp(from, (i === 0 ? heard : "") + msg, i === 0 ? out.audioUrl : null, conv.id);
    }
    return;
  }
  const chips = out.quickReplies.length ? `\n\n↪ ${out.quickReplies.map((q) => (q === "pool" ? "POOL" : q === "reset" ? "NEW" : q)).join("  ·  ")}` : "";
  await sendWhatsApp(from, heard + out.text + chips, out.audioUrl, conv.id);
}
