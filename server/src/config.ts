import { fileURLToPath } from "node:url";

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8080),
  publicBaseUrl: (env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT ?? 8080}`).replace(/\/$/, ""),
  dataDir: env.DATA_DIR ?? fileURLToPath(new URL("../data/", import.meta.url)),
  webDist: env.WEB_DIST ?? fileURLToPath(new URL("../../web/dist/", import.meta.url)),
  internalToken: env.INTERNAL_TOKEN ?? "dev-internal-token",
  opsToken: env.OPS_TOKEN ?? "dev-ops-token",

  sarvam: {
    apiKey: env.SARVAM_API_KEY ?? "",
    base: "https://api.sarvam.ai",
    chatModel: env.SARVAM_CHAT_MODEL ?? "sarvam-105b",
    // fare explanations: the chat-tuned variant answers in ~1–3 s; sarvam-105b reasons for ~2,400 tokens (~12 s) first
    explainModel: env.SARVAM_EXPLAIN_MODEL ?? "sarvam-105b-conversations",
    sttModel: env.SARVAM_STT_MODEL ?? "saaras:v4",
    ttsModel: env.SARVAM_TTS_MODEL ?? "bulbul:v3",
    ttsSpeaker: env.SARVAM_TTS_SPEAKER ?? "",
  },

  flagsmith: {
    envKey: env.FLAGSMITH_ENVIRONMENT_KEY ?? "",
    apiUrl: env.FLAGSMITH_API_URL ?? "https://edge.api.flagsmith.com/api/v1/",
  },

  twilio: {
    sid: env.TWILIO_ACCOUNT_SID ?? "",
    token: env.TWILIO_AUTH_TOKEN ?? "",
    from: env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886",
  },

  // watcher only
  apiUrl: (env.API_URL ?? `http://localhost:${env.PORT ?? 8080}`).replace(/\/$/, ""),
  podName: env.POD_NAME ?? env.HOSTNAME ?? `watcher-${process.pid}`,
};

export const has = {
  sarvam: () => Boolean(config.sarvam.apiKey),
  flagsmith: () => Boolean(config.flagsmith.envKey),
  twilio: () => Boolean(config.twilio.sid && config.twilio.token),
};
