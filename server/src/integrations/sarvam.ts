// Sarvam AI: Saaras (speech→text), Sarvam-105B (chat / structured extraction), Bulbul (text→speech), Mayura (translate).
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { config, has } from "../config.ts";
import { trace } from "../bus.ts";
import { uid } from "../db.ts";

const headers = () => ({ "api-subscription-key": config.sarvam.apiKey });

async function sarvamFetch(path: string, init: RequestInit, timeoutMs = 25_000) {
  const res = await fetch(config.sarvam.base + path, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { ...headers(), ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`Sarvam ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<any>;
}

/** Convert any browser/WhatsApp audio to 16 kHz mono WAV. Falls back to the original bytes if ffmpeg is missing. */
export function toWav(input: Buffer): Promise<{ data: Buffer; mime: string; name: string } | null> {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"]);
    const chunks: Buffer[] = [];
    p.stdout.on("data", (c) => chunks.push(c));
    p.on("error", () => resolve(null));
    p.on("close", (code) => resolve(code === 0 && chunks.length ? { data: Buffer.concat(chunks), mime: "audio/wav", name: "voice.wav" } : null));
    p.stdin.on("error", () => {});
    p.stdin.end(input);
  });
}

export async function speechToText(audio: Buffer, mime: string, convId: string | null): Promise<{ transcript: string; lang: string }> {
  if (!has.sarvam()) throw new Error("SARVAM_API_KEY not set");
  const t0 = performance.now();
  const wav = await toWav(audio);
  const file = wav ?? { data: audio, mime, name: mime.includes("ogg") ? "voice.ogg" : "voice.webm" };
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.data)], { type: file.mime }), file.name);
  form.append("model", config.sarvam.sttModel);
  form.append("language_code", "unknown");
  const r = await sarvamFetch("/speech-to-text", { method: "POST", body: form });
  const out = { transcript: String(r.transcript ?? "").trim(), lang: String(r.language_code ?? "hi-IN") };
  trace("sarvam", convId, { api: "speech-to-text", model: config.sarvam.sttModel, ms: Math.round(performance.now() - t0), detectedLang: out.lang, transcript: out.transcript, converted: Boolean(wav) });
  return out;
}

function extractJson(s: string): any {
  const cleaned = s.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```json|```/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function chatJson<T>(system: string, user: string, convId: string | null, purpose: string): Promise<T> {
  if (!has.sarvam()) throw new Error("SARVAM_API_KEY not set");
  const t0 = performance.now();
  const r = await sarvamFetch("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.sarvam.chatModel,
      temperature: 0.1,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const content = r.choices?.[0]?.message?.content ?? "";
  const parsed = extractJson(content);
  trace("sarvam", convId, { api: "chat/completions", model: config.sarvam.chatModel, purpose, ms: Math.round(performance.now() - t0), output: parsed });
  return parsed as T;
}

export async function chatText(system: string, user: string, convId: string | null, purpose: string, opts: { timeoutMs?: number; maxTokens?: number; temperature?: number; model?: string } = {}): Promise<string> {
  if (!has.sarvam()) throw new Error("SARVAM_API_KEY not set");
  const t0 = performance.now();
  const r = await sarvamFetch("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: opts.model ?? config.sarvam.chatModel, temperature: opts.temperature ?? 0.4, max_tokens: opts.maxTokens ?? 600, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  }, opts.timeoutMs);
  const text = String(r.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  trace("sarvam", convId, { api: "chat/completions", model: opts.model ?? config.sarvam.chatModel, purpose, ms: Math.round(performance.now() - t0) });
  return text;
}

const TTS_LANGS = new Set(["en-IN", "hi-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "mr-IN", "gu-IN", "pa-IN", "od-IN"]);

/** Returns a public URL to a WAV file, or null on failure (the text reply still goes out). */
export async function textToSpeech(text: string, lang: string, convId: string | null): Promise<string | null> {
  if (!has.sarvam() || !text) return null;
  const t0 = performance.now();
  try {
    const body: Record<string, unknown> = { text: text.slice(0, 1500), language_code: TTS_LANGS.has(lang) ? lang : "hi-IN", model: config.sarvam.ttsModel };
    if (config.sarvam.ttsSpeaker) body.speaker = config.sarvam.ttsSpeaker;
    const r = await sarvamFetch("/text-to-speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const b64 = r.audios?.[0];
    if (!b64) throw new Error("no audio returned");
    const name = `${uid()}.wav`;
    writeFileSync(config.dataDir + "audio/" + name, Buffer.from(b64, "base64"));
    trace("sarvam", convId, { api: "text-to-speech", model: config.sarvam.ttsModel, lang: body.language_code, ms: Math.round(performance.now() - t0), chars: text.length });
    return `/audio/${name}`;
  } catch (e) {
    trace("sarvam", convId, { api: "text-to-speech", error: String(e) });
    return null;
  }
}

export async function translate(text: string, target: string, convId: string | null): Promise<string> {
  if (!has.sarvam() || target === "en-IN") return text;
  const t0 = performance.now();
  try {
    const r = await sarvamFetch("/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text.slice(0, 1000), source_language_code: "en-IN", target_language_code: target, model: "mayura:v1", mode: "modern-colloquial" }),
    });
    trace("sarvam", convId, { api: "translate", model: "mayura:v1", target, ms: Math.round(performance.now() - t0) });
    return String(r.translated_text ?? text);
  } catch (e) {
    trace("sarvam", convId, { api: "translate", error: String(e) });
    return text;
  }
}
