#!/usr/bin/env node
// Creates every Marg Bandhu flag in your Flagsmith project in one go.
//   node --env-file=.env scripts/flagsmith-setup.mjs
// Needs FLAGSMITH_ADMIN_API_KEY (Organisation settings → API keys) and FLAGSMITH_PROJECT_ID.
const KEY = process.env.FLAGSMITH_ADMIN_API_KEY;
const PROJECT = process.env.FLAGSMITH_PROJECT_ID;
const BASE = process.env.FLAGSMITH_ADMIN_URL ?? "https://api.flagsmith.com/api/v1";
if (!KEY || !PROJECT) {
  console.error("Set FLAGSMITH_ADMIN_API_KEY and FLAGSMITH_PROJECT_ID in .env");
  process.exit(1);
}

const flags = [
  { name: "festive_rush_mode", enabled: true, description: "Festive season: bigger connection buffers, wider pool windows, stronger booking nudge" },
  { name: "pooling_enabled", enabled: true, description: "Shared-cab pooling. Add a segment on trait destination_hub to roll out per city" },
  { name: "voice_input_enabled", enabled: true, description: "Show the mic button / accept WhatsApp voice notes" },
  { name: "whatsapp_channel_enabled", enabled: true, description: "Kill switch for the WhatsApp channel" },
  { name: "judge_controls", enabled: true, description: "Show demo controls (surge simulator, simulate rider) on the live site" },
  { name: "degrade_gracefully", enabled: false, description: "Flipped ON by NudgeBee during a surge: watchers take small batches at a slower pace" },
  { name: "book_nudge_copy", enabled: true, value: "urgent", description: "A/B test: 'urgent' vs 'savings' copy on the book-now nudge (make it multivariate 50/50)" },
  { name: "fare_model", enabled: true, value: JSON.stringify({ festiveSurgePct: 38, festiveWindowDays: 5, sweetSpotDays: [21, 45], lastMinutePct: 70 }), description: "Remote config for the fare forecast" },
  { name: "split_weights", enabled: true, value: JSON.stringify({ maxRiders: 4, windowMin: 60, corridorDeg: 35, detourKmPerStop: 6 }), description: "Remote config for pool matching + fare split" },
  { name: "watcher_config", enabled: true, value: JSON.stringify({ batchSize: 50, intervalMs: 3000 }), description: "Pool watcher batch size + poll interval" },
];

const h = { Authorization: `Api-Key ${KEY}`, "Content-Type": "application/json" };
const existing = await fetch(`${BASE}/projects/${PROJECT}/features/?page_size=100`, { headers: h }).then((r) => r.json());
const have = new Set((existing.results ?? []).map((f) => f.name));

for (const f of flags) {
  if (have.has(f.name)) {
    console.log(`= ${f.name} (exists)`);
    continue;
  }
  const r = await fetch(`${BASE}/projects/${PROJECT}/features/`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ name: f.name, description: f.description, default_enabled: f.enabled, initial_value: f.value ?? null, type: "STANDARD" }),
  });
  console.log(`${r.ok ? "+" : "✗"} ${f.name}${r.ok ? "" : " " + (await r.text()).slice(0, 200)}`);
}
console.log("\nNext in the Flagsmith UI: make book_nudge_copy multivariate (urgent / savings, 50/50) and add a segment for pooling_enabled.");
