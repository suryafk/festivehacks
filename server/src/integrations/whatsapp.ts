// Twilio WhatsApp (sandbox) outbound + media download.
import { config, has } from "../config.ts";
import { trace } from "../bus.ts";

const auth = () => "Basic " + Buffer.from(`${config.twilio.sid}:${config.twilio.token}`).toString("base64");

export async function sendWhatsApp(to: string, body: string, mediaPath?: string | null, convId: string | null = null) {
  if (!has.twilio()) {
    trace("twilio", convId, { skipped: "TWILIO_* not set", to: mask(to), body: body.slice(0, 120) });
    return;
  }
  const form = new URLSearchParams({ From: config.twilio.from, To: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`, Body: body.slice(0, 1550) });
  if (mediaPath && config.publicBaseUrl.startsWith("https://")) form.append("MediaUrl", config.publicBaseUrl + mediaPath);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    const r = (await res.json()) as any;
    trace("twilio", convId, { to: mask(to), status: res.status, sid: r.sid, error: r.message, withVoice: Boolean(mediaPath) });
  } catch (e) {
    trace("twilio", convId, { to: mask(to), error: String(e) });
  }
}

export async function downloadMedia(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { Authorization: auth() }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`media download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export const mask = (n: string) => n.replace(/(\d{2})\d+(\d{3})/, "$1•••••$2");
