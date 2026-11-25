import Fastify from "fastify";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import fstatic from "@fastify/static";
import { existsSync } from "node:fs";
import { config, has } from "./config.ts";
import { webRoutes } from "./channels/web.ts";
import { whatsappRoutes } from "./channels/whatsapp.ts";
import { opsRoutes } from "./channels/ops.ts";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 2 * 1024 * 1024, trustProxy: true });
await app.register(formbody);
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const hasWeb = existsSync(config.webDist + "index.html");
await app.register(fstatic, { root: hasWeb ? config.webDist : config.dataDir, prefix: "/", wildcard: false });

app.get("/healthz", async () => ({ ok: true, sarvam: has.sarvam(), flagsmith: has.flagsmith(), twilio: has.twilio() }));
webRoutes(app);
whatsappRoutes(app);
opsRoutes(app);

// SPA fallback
app.setNotFoundHandler((req, reply) => {
  if (hasWeb && req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/internal")) return reply.sendFile("index.html", config.webDist);
  reply.code(404).send({ error: "not found" });
});

await app.listen({ port: config.port, host: "0.0.0.0" });
const { startFareWatcher } = await import("./engine/fareWatch.ts");
startFareWatcher();

if (process.env.INLINE_WATCHER === "1") {
  const { runWatcher } = await import("./watcher.ts");
  runWatcher().catch((e) => app.log.error(e));
}
