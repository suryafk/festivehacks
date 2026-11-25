# CONTEXT.md: hand-off brief for the next Claude

Read this first, then `VERSION_HISTORY.md` (change log, newest first) and the code. This file explains **what Marg Bandhu is, how it's built, where it runs, how to work on it safely, and what's left**. No secrets are in this file or in git; keys live in `.env.vm` (git-ignored, on the owner's laptop) and in a Kubernetes secret on the VM.

_Last updated: 2026-11-25, deployed commit `e920e1c` (v0.5)._

---

## 1. The project in one paragraph

**Marg Bandhu (मार्ग बंधु, "friend of the road")** is a festive-season travel assistant built for **Festive Hacks 2026** (WeMakeDevs × WeAreDevelopers, Bengaluru, one-day in-person hackathon, 25 Nov 2026; submission = public repo + README + demo video). A user, typically a migrant worker or student in a metro going home to a UP/Bihar town for Diwali/Chhath/Christmas, says or types a trip ("26 दिसंबर के आसपास बेंगलुरु से गोंडा जाना है"). Marg Bandhu returns a **door-to-door plan** (flight + train + cab), a **flight price outlook** (book now / wait / let us watch it), and **cab mates** heading the same way from the landing airport, with a **fair fare split**. It works on the **web** and on **WhatsApp**, in Hindi, English and other Indian languages. **The hackathon requires using all three sponsors: Sarvam AI, Flagsmith and NudgeBee.** All three are integrated and live.

- **Live site:** https://34-93-164-65.sslip.io (use `https://`; plain `http://` returns 404)
- **Repo:** https://github.com/suryafk/festivehacks (public)
- **Local folder:** `/Users/surya/Hackathon/festivehacks`

---

## 2. Working rules agreed with the owner (follow these)

1. **Verify every change locally first** (`http://localhost:8080`, browser + curl).
2. **Never redeploy to GCP unless the owner explicitly says "deploy".** Pushing to GitHub is done as part of a deploy. Infra-only actions (e.g. Helm on the cluster) were done only after explicit approval.
3. **Add an entry to `VERSION_HISTORY.md` for every change** (what, how verified, deployed or not). Unreleased work goes under "Unreleased".
4. Confirm before anything billable, outward-facing, or security-weakening. The owner kept GCP's org policy blocking service-account keys; don't override security controls.
5. Never print, log or commit secret values. When checking `.env.vm`, show only whether each key is set or empty.

Owner preferences seen so far: wants a plan/walk-through before code for new ideas, detailed WhatsApp replies, an honest disclosure of simulated data, and step-by-step instructions for anything they must do in third-party consoles.

---

## 3. Architecture

```
            Web app (React SPA)                         WhatsApp (Twilio sandbox)
   Landing · Plan a trip · Cab mates map · Ops         text or voice note
                │  REST + Server-Sent Events                    │ POST /webhooks/whatsapp
                ▼                                               ▼
   ┌────────────────────── channel adapters (server/src/channels) ─────────────────────┐
   │ web.ts: REST + SSE, voice upload, parse, cab-mates, fare-watch                   │
   │ whatsapp.ts: ack fast, then process async; voice → STT; reply via REST          │
   │ waFormat.ts: detailed WhatsApp layout (2 messages), pool-match message          │
   └──────────────────────────────────────┬────────────────────────────────────────────┘
                                          ▼
   ┌──────────── conversation engine (server/src/engine/conversation.ts) ─────────────┐
   │ intent.ts   Sarvam-105B JSON extraction + deterministic heuristic + guards       │
   │ planner.ts  multi-leg itineraries (flight → train / cab, direct trains)          │
   │ fares.ts    price outlook: live Google data or simulated model, Monte Carlo     │
   │ pooling.ts  match riders + segment-sharing fair split                           │
   │ pools.ts    pool requests, leasing to watchers, results, notifications          │
   │ fareWatch.ts price-drop alerts (30 s re-quotes, simulated)                      │
   │ i18n.ts     hand-written EN + HI replies (Mayura translates other languages)    │
   │ seed.ts     simulated network: cities, flights, trains, co-travellers           │
   └──────────────────────────────────────┬────────────────────────────────────────────┘
        integrations: sarvam.ts · flags.ts (Flagsmith) · googleFlights.ts (SerpApi) · whatsapp.ts (Twilio)
                                          │
              SQLite (node:sqlite) on a PVC · in-process event bus → SSE "Behind the scenes" trace
                                          │
   pool-watcher pods (server/src/watcher.ts, 2 replicas): lease waiting pool requests over HTTP
   (/internal/*), build a route-corridor index (memory-heavy by design), match, post results.
                                          │
   NudgeBee agent on the same k3s cluster: watches the pods (OOMKilled on surge) → workflow
   (RCA → approval → scale → Flagsmith API flips degrade_gracefully → notify).
```

### Key design decisions
- **One engine, two channels.** Web and WhatsApp call the same `turn()` / `handle()`; only input normalisation and rendering differ.
- **The LLM only extracts structured intent.** Reply text comes from templates filled with real plan data, so it can't invent flights or prices. Guards in `intent.ts` reject cities the user didn't say, past dates, invented modes, and from = to. Unsupported places come from a deterministic list (`notCoveredPlaces` in `seed.ts`) and get a clear "not covered yet" reply.
- **Every sponsor call has a safe fallback.** No Sarvam key → heuristic parser. Flagsmith down → defaults. SerpApi error → simulated fares. Twilio not set → the send is logged.
- **The API is a single replica owning SQLite**; watchers are stateless and scale horizontally by leasing work from the API (`/internal/claim`, 20 s lease).
- **Live updates** use Server-Sent Events (`/api/conversations/:id/stream`, `/api/ops/stream`). The "Behind the scenes" drawer shows every Sarvam / Flagsmith / Google Flights / Twilio / pooling call.

---

## 4. Sponsor and third-party integrations (all live)

| Service | Used for | Details |
|---|---|---|
| **Sarvam AI** | Understanding text/speech; voice | `sarvam-105b` (`POST /v1/chat/completions`, `response_format: json_object`) for intent; **Saaras v4** (`/speech-to-text`, `language_code=unknown`; ffmpeg converts audio to 16 kHz WAV first); **Bulbul v3** (`/text-to-speech`, `language_code`); **Mayura** (`/translate`) for languages beyond hi/en. Header `api-subscription-key`. Sync STT limit about 30 s (the web recorder stops at 25 s). |
| **Flagsmith** | Flags, remote config, A/B, kill switches | Project **56018**, environment **"Development"** (client env key `NSsV2qMXcyyE8vXRmAJ7YV`, public by design). The app uses the **server-side key** (`FLAGSMITH_ENVIRONMENT_KEY`, `ser.…`). The environment uses **v2 feature versioning**: to change a flag via API use `PATCH https://api.flagsmith.com/api/__future__/environments/NSsV2qMXcyyE8vXRmAJ7YV/features/<featureId>/` with `{"environment_default":{"enabled":true}}`. The old `/featurestates/` PATCH returns 400. The admin credential is a **personal API token** (header `Token …`, not `Api-Key`). It lives only in `.env.vm`, never on the server. Flagsmith takes about 2–15 s to propagate changes. |
| **NudgeBee** | Ops / incident remediation | Kubernetes agent on the k3s VM (Helm release `nudgebee-agent`, namespace `nudgebee-agent`, lightweight install: no Prometheus stack, OpenCost, OTel collector or ClickHouse). **Write permissions enabled** (`runner.enableWritePermissions=true`, revision 2): can scale deployments and exec into pods in `marg-bandhu`, **cannot read Secrets** there. The values file with the auth key is `~/nb-values.yaml` on the VM (mode 600). The GCP account integration was **skipped** (the org policy blocks service-account keys). The workflow is documented in `k8s/nudgebee-workflow.md`. **Whether the owner finished building the workflow in NudgeBee's UI is unconfirmed.** |
| **Google Flights via SerpApi** | Live fares + price history | `engine=google_flights`, one-way (`type=2`), `currency=INR`, `gl=in`. Free plan, **250 searches/month** (about 248–249 left at hand-off). Results cached 6 h in SQLite (`fare_cache`). Only the requested date's main flight route is fetched; ±flex days are model fares scaled to live prices. Kill switch: Flagsmith `live_fares_enabled`. Check quota for free: `GET https://serpapi.com/account.json?api_key=…`. `SERPAPI_BASE` env overrides the host (used for tests with a mock). |
| **Twilio WhatsApp sandbox** | WhatsApp channel | Trial account, sandbox number `+14155238886`. The join code is in `TWILIO_SANDBOX_JOIN`; the app shows "join <code>". The sandbox webhook is set by the owner to `https://34-93-164-65.sslip.io/webhooks/whatsapp` (POST). Each phone must send the join code first, and it expires after 3 days of inactivity. The owner's phone has joined. Twilio signature validation is **not** implemented. |

### Flagsmith flags (all exist in project 56018)
| Flag | Type | Effect |
|---|---|---|
| `festive_rush_mode` | bool | Connection buffer 120 min (vs 75), pool window ×1.5 |
| `pooling_enabled` | bool | Cab pooling on/off (segment on trait `destination_hub` for per-city rollout) |
| `voice_input_enabled` | bool | Mic button / voice notes |
| `whatsapp_channel_enabled` | bool | WhatsApp kill switch |
| `judge_controls` | bool | Demo buttons (surge simulator, simulate rider, simulate price drop) |
| `degrade_gracefully` | bool | Watchers use batch/10 and interval×2; **feature id 303424**; flipped by NudgeBee; left OFF |
| `live_fares_enabled` | bool | Use SerpApi; **feature id 303454** |
| `book_nudge_copy` | string `urgent`/`savings` | A/B copy on the price pointer (meant to be multivariate 50/50; **check whether the owner set that up in the UI**) |
| `fare_model` | JSON | festiveSurgePct, festiveWindowDays, sweetSpotDays, lastMinutePct, volatilityPct |
| `split_weights` | JSON | maxRiders, windowMin, corridorDeg, detourKmPerStop |
| `watcher_config` | JSON | batchSize (50), intervalMs (3000) |

Identity for evaluation = `user_ref` (`web-<convId>` or `whatsapp:+…`), with traits `channel`, `destination_hub`, `lang`.

---

## 5. Infrastructure (GCP)

| Item | Value |
|---|---|
| GCP project | `project-d549298b-2c05-4b94-b8e` ("My First Project"), under organization `758008451110`, billing enabled |
| Region / zone | `asia-south1` / `asia-south1-a` (Mumbai) |
| VM | `marg-bandhu`, e2-medium (2 vCPU, 4 GB), Ubuntu 24.04, 30 GB disk, network tag `marg-bandhu` |
| Static IP | `marg-bandhu-ip` = **34.93.164.65** |
| Firewall | `marg-bandhu-web`: tcp 80, 443 → tag `marg-bandhu` |
| APIs enabled | Compute, Monitoring, Logging, Recommender, Cloud Resource Manager, BigQuery, IAM |
| Unused | Service account `nudgebee-sa@…` with 7 read-only roles, no key (org policy `iam.disableServiceAccountKeyCreation` is enforced). Safe to delete. |
| Cost | About $25/month for VM + IP. **Delete after the hackathon** (commands in §10). |

**On the VM:** Docker (image builds), **k3s** (Kubernetes) with bundled **Traefik**, Helm. Repo cloned at `~/festivehacks`; env at `~/festivehacks/.env` (mode 600; copy of `.env.vm` **minus** `FLAGSMITH_ADMIN_API_KEY` and `FLAGSMITH_PROJECT_ID`).

**Kubernetes (`k8s/app.yaml`, namespace `marg-bandhu`):**
- `api`: Deployment, 1 replica, `Recreate`, PVC `api-data` (1 Gi, local-path) mounted at `/data` (SQLite + audio files). Readiness/liveness on `/healthz`. Memory limit 512 Mi.
- `pool-watcher`: Deployment, 2 replicas, command `node --max-old-space-size=512 src/watcher.ts`, **memory limit 256 Mi on purpose**: under a 1,500-request surge a normal watcher reaches about 600 MB → **OOMKilled**; with `degrade_gracefully` about 70–160 MB. Verified live several times.
- Service `api:8080`; Ingress for host `34-93-164-65.sslip.io` with Traefik `certresolver: le`.
- Secret `marg-bandhu-env`, created from `.env` by `deploy.sh`.
- `k8s/traefik-letsencrypt.yaml`: HelmChartConfig adding a Let's Encrypt HTTP-01 resolver `le` (email optional; none given). The certificate is valid. The http→https redirect isn't working (http gives 404).
- Image `marg-bandhu:latest`, built on the VM and imported into k3s containerd (`docker save | k3s ctr images import -`). No registry.

**Deploy (only when the owner says "deploy"):**
```bash
# from the laptop, after committing + pushing
# (when keys changed) copy env without admin-only keys:
grep -vE '^(FLAGSMITH_ADMIN_API_KEY|FLAGSMITH_PROJECT_ID)=' .env.vm > /tmp/x.env   # use the session scratchpad, then delete it
gcloud compute scp /tmp/x.env marg-bandhu:festivehacks/.env --project project-d549298b-2c05-4b94-b8e --zone asia-south1-a
gcloud compute ssh marg-bandhu --project project-d549298b-2c05-4b94-b8e --zone asia-south1-a \
  --command "cd ~/festivehacks && git pull && ./scripts/deploy.sh"
```
`scripts/deploy.sh` builds the image, imports it, applies Traefik LE + `k8s/app.yaml` (host = `<ip-with-dashes>.sslip.io`), recreates the secret from `.env`, and rolls out `api` + `pool-watcher`. `scripts/vm-bootstrap.sh` provisions a fresh VM.

**Reading live data:** `kubectl -n marg-bandhu exec deploy/api -- node -e "<script using node:sqlite on /data/marg-bandhu.db>"`. The `events` table has every trace (kinds: sarvam, flagsmith, flights, twilio, engine, pool, watcher, surge, nudgebee).

---

## 6. Code map

**Runtime:** Node **24+**, TypeScript executed **natively** (type stripping, no build step for the server). So: relative imports **must use `.ts` extensions**, use `import type` for types, and avoid enums/namespaces. Fastify 5. SQLite via built-in `node:sqlite`. Web: Vite 7 + React 19 + Tailwind v4 + Leaflet (OpenStreetMap tiles; CARTO now needs an API key).

```
server/src/
  server.ts            Fastify app, static web/dist, SPA fallback, starts the fare watcher; INLINE_WATCHER=1 runs a watcher in-process (local dev)
  config.ts            env → config; has.sarvam()/flagsmith()/twilio()
  db.ts                SQLite schema: conversations, messages, pool_requests, pools, events, heartbeats, fare_watches (+ fare_cache in googleFlights.ts)
  bus.ts               EventEmitter + trace() (persists to events, pushes SSE)
  watcher.ts           pool watcher loop (claim → corridor index → matchGroup → result; heartbeat every 5 s)
  channels/web.ts      /api/* for the web app
  channels/whatsapp.ts Twilio webhook (ack immediately, process async)
  channels/waFormat.ts detailed WhatsApp plan (2 msgs) + pool-match message; planLink() → /#/plan?c=<convId>
  channels/ops.ts      /internal/* (watchers), /api/ops/* (state, SSE, surge, reset, nudgebee callback, local override), /metrics
  engine/*             see §3
  integrations/*       sarvam.ts, flags.ts, googleFlights.ts, whatsapp.ts
server/test/           node --test: googleFlights.test.ts (+ fixture), intent.test.ts; each uses its own temp DATA_DIR
web/src/
  App.tsx              shell, hash routing (#/, #/plan, #/cabmates, #/ops), SSE notifications/toasts, Behind-the-scenes drawer, ErrorBoundary; ?c= deep link
  Landing.tsx          hero + animated route SVG, sliding feature deck (5 cards, autoplay), how-it-works, CTA
  Plan.tsx             "describe it" bar (text/voice → /parse fills the form), form (from/to/date/flex/modes), results
  Cards.tsx            FlightPriceCard (best now / typical / drop chance / chart / pointer / watch), Itineraries, CabTeaser, SplitCard
  CabMates.tsx         Leaflet map of travellers by destination, rider list, join pool, split
  Ops.tsx              surge simulator, watcher pods, timeline (NudgeBee/Flagsmith/pool events)
  Trace.tsx, ErrorBoundary.tsx, api.ts (API client, city lists, formatters)
k8s/                   app.yaml, traefik-letsencrypt.yaml, nudgebee-workflow.md
scripts/               vm-bootstrap.sh, deploy.sh, flagsmith-setup.mjs (creates missing flags; accepts Api-Key or Token auth)
Dockerfile             multi-stage: build web → node:24-slim + ffmpeg, runs as `node`
```

### API surface
`GET /healthz` · `GET /api/config` · `POST /api/conversations` · `GET /api/conversations/:id` · `POST /api/conversations/:id/message` (`{text}` or `{action}` + `wasVoice`/`voiceLang`; actions: `set_trip`, `set_modes`, `join_pool`, `watch_fare`, `simulate_rider`, `reset`) · `POST /:id/voice` (multipart → `{transcript, lang}`) · `POST /:id/parse` (text → form fields + `unknownPlaces`/`message`) · `GET /:id/cabmates` · `POST|GET /:id/fare-watch` · `POST /:id/fare-watch/simulate-drop` · `POST /:id/whatsapp` (link a phone for alerts) · `GET /:id/stream` (SSE) · `POST /api/track` (A/B conversion) · `GET /audio/:file` · `POST /webhooks/whatsapp` · ops: `GET /api/ops/state`, `GET /api/ops/stream`, `POST /api/ops/surge` (gated by `judge_controls`, 60 s cooldown), `POST /api/ops/reset-surge`, `POST /api/ops/nudgebee?token=OPS_TOKEN`, `POST /api/ops/override` (header `x-ops-token`), `GET /metrics` · internal (header `x-internal-token`): `/internal/config|claim|result|heartbeat`.

### Environment variables (names only; values in `.env.vm`)
`PUBLIC_BASE_URL`, `SARVAM_API_KEY` (+ optional `SARVAM_CHAT_MODEL`, `SARVAM_TTS_MODEL`, `SARVAM_TTS_SPEAKER`), `FLAGSMITH_ENVIRONMENT_KEY`, `FLAGSMITH_ADMIN_API_KEY` + `FLAGSMITH_PROJECT_ID` (laptop scripts only), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_SANDBOX_JOIN`, `SERPAPI_KEY` (+ `SERPAPI_BASE` for tests), `INTERNAL_TOKEN`, `OPS_TOKEN`, plus runtime `PORT`, `DATA_DIR`, `WEB_DIST`, `API_URL`, `POD_NAME`, `INLINE_WATCHER`, `LOG_LEVEL`.

---

## 7. Features: how they work

**Plan a trip.**
- **Coverage:** origins are metros (BLR, DEL, BOM, HYD); destinations are hubs (LKO, PAT, VNS) and towns (GKP, GD, BST, AY, BRK, SLN, ARA, HJP, BGS, CPR, JNU, GZP, MZP). Anything else → "not covered yet" (or a coverage message for metro→metro).
- **Planner:** builds Direct flight, Flight + train (airport→station transfer + buffer), Flight + cab (poolable), Direct train, Train + train, across date ± flex. Score = fare + ₹250/hour + penalties (late arrival, off-date). Keeps the best of each kind, top 4, with recommended/fastest/cheapest tags.

**Flight price outlook (`fares.ts`).**
- **Live** (Google): best now = Google's lowest; expected = midpoint of Google's typical range; history = Google's price history; volatility = std of daily % changes (clamped 2–15%).
- **Simulated:** base fare × festive surge × lead-time curve × deterministic noise.
- The forecast keeps the model's shape, anchored to today's price.
- Drop chance = Monte Carlo (600 paths) of a ≥5% dip within 3/7 days.
- Pointer: Google "low" → book now; meaningful saving within 10 days (not festival week) → wait; drop chance ≥25% or Google "high", and >10 days out → monitor.
- The card shows a "Live · Google Flights" or "Simulated fares" badge.

**Price watch.** Re-quotes every 30 s with the simulated model plus jitter (deliberately not SerpApi, to save quota). Alerts at −5% via SSE toast + WhatsApp. There's a judge button to simulate a drop. WhatsApp command **WATCH**.

**Cab mates + fair split.**
- 15 seeded co-travellers (re-seeded per name around each arrival time).
- Compatible = same hub, arrival within ±window (60 min, ×1.5 in rush), bearing within 35°.
- **Segment-sharing split:** each stretch of road between drops costs the same per km and is shared by whoever is still in the cab; plus a 6 km detour per extra stop; rounded to ₹10 and summing exactly.
- Cab: ₹300 base + ₹14/km. Map page with Leaflet. Matching runs on watcher pods; matches are pushed via SSE + WhatsApp.

**Voice.**
- Web: MediaRecorder → `/voice` → Saaras → editable "Did you mean?" → plan (+ Bulbul reply).
- WhatsApp: voice note → Saaras → echo "🎙️ I heard…" → plan (+ voice note reply).
- Spoken text says "से/to" instead of "→" and expands "दिस॰".

**WhatsApp format.** A plan arrives as 2 messages (route + alternatives; price outlook + cab mates + commands + link). Commands **POOL / WATCH / NEW** bypass the LLM. The pool match lists every rider's share. Messages are limited to 1,500 chars each.

**Ops / NudgeBee story.** `/ops` "Simulate Diwali-eve surge" inserts 1,500 synthetic requests → watchers OOMKilled → NudgeBee detects → (workflow) scale + flip `degrade_gracefully` → queue drains. "Clear surge" resets it. Fallback without NudgeBee: `POST /api/ops/override`.

**Data honesty.** Timetables (trains, simulated flights), co-travellers and fare-watch prices are **simulated**; the UI and README say so. Live: Google fares for the requested date, Sarvam, Flagsmith, Twilio, NudgeBee.

---

## 8. Local development

```bash
cd web && npm install && npm run build && cd ..        # npm 12 blocks install scripts; build still works
cd server && npm install
PORT=8080 INLINE_WATCHER=1 node --env-file=../.env.vm src/server.ts   # real keys; omit --env-file for offline mode
node --test test/*.test.ts                              # 10 tests
```

Gotchas learned the hard way:
- **Stop servers with `pkill -f "src/server.ts"`.** `pkill -f "node src/server.ts"` misses processes started with `--env-file`, leaving a stale server on :8080 that silently "passes" tests with old code.
- `@fastify/static` registers file routes **at startup**: after `vite build`, **restart the server** or new asset hashes 404.
- To avoid spending SerpApi quota locally, point `DATA_DIR` at a folder whose `fare_cache` already has the route/date, or use the mock (`SERPAPI_BASE=http://localhost:9911`) with `server/test/fixtures-google-flights.json`.
- The Mac's Python lacks a CA bundle (urllib SSL errors). Use Node or curl for HTTPS checks.
- In zsh, don't put multiple flags in one variable (`$Z`): no word-splitting. Write gcloud flags out in full.
- The browser preview may block third-party tiles/fonts; the CARTO tiles needed a key, so OSM is used.
- Old browsers may hold a conversation from an older schema; the ErrorBoundary + skip-outdated-plan logic prevents blank pages.

---

## 9. Status: done vs left

### Done and live (v0.5)
Landing / Plan / Cab-mates / Ops UI; Sarvam STT/LLM/TTS/translate; Flagsmith flags + kill switches + A/B tracking; live Google Flights fares with cache and fallback; price watch; cab pooling + fair split + map; WhatsApp (text, voice, detailed format, commands); NudgeBee agent with writes; k3s on GCP with HTTPS; surge → OOMKilled → degrade recovery verified; intent guards and "not covered" handling; version history.

### Not done / open items (rough priority for the demo)
1. **Real WhatsApp round trip on v0.5 from the owner's phone**: not yet confirmed (the owner was asked to send "Bengaluru se Gonda 26 Dec", then WATCH, POOL, a voice note).
2. **NudgeBee workflow in NudgeBee's UI** (trigger OOMKilled on `pool-watcher` → RCA → approval → scale to 4 → Flagsmith PATCH (feature 303424) → `POST /api/ops/nudgebee?token=…` → Discord). Unconfirmed; then rehearse the full surge demo.
3. **README.md is stale.** It still describes the v0.1 chat UI and lacks the live URL, Google Flights, the new pages and WhatsApp commands. It must be updated (the submission needs a README someone else can set up from).
4. **Demo video** (about 3 min) for submission: landing → describe trip by voice → plan + live fare card → watch → cab mates map → pool split → WhatsApp → Ops surge + NudgeBee + Flagsmith.
5. `book_nudge_copy` as a 50/50 multivariate in Flagsmith (UI step) and the optional `pooling_enabled` segment.
6. **http→https redirect** (Traefik `ports.web.redirections` didn't take effect; http returns 404).
7. **Twilio request signature validation** on `/webhooks/whatsapp` (currently unauthenticated).
8. In-city **festive traffic timing** ("tell me when traffic is light to go shopping"): part of the original idea, **not built**.
9. Train data is simulated (no IRCTC API). Price-watch quotes are simulated. Coverage is limited to metros → UP/Bihar.
10. "Behind the scenes" trace shows `live_fares_enabled` only in newer events.
11. Post-hackathon cleanup: delete the VM, static IP, firewall rule and the unused `nudgebee-sa`; rotate the NudgeBee auth key (it was pasted in chat), the Twilio auth token and other keys.

---

## 10. Useful commands

```bash
# live health / sponsors
curl -s https://34-93-164-65.sslip.io/healthz
# pods
gcloud compute ssh marg-bandhu --project project-d549298b-2c05-4b94-b8e --zone asia-south1-a --command "kubectl -n marg-bandhu get pods; kubectl -n nudgebee-agent get pods"
# SerpApi quota (free)
node --env-file=.env.vm -e 'fetch("https://serpapi.com/account.json?api_key="+process.env.SERPAPI_KEY).then(r=>r.json()).then(j=>console.log(j.total_searches_left))'
# recreate missing Flagsmith flags
node --env-file=.env.vm scripts/flagsmith-setup.mjs
# teardown after the hackathon (confirm with the owner first; irreversible)
gcloud compute instances delete marg-bandhu --zone asia-south1-a --project project-d549298b-2c05-4b94-b8e
gcloud compute addresses delete marg-bandhu-ip --region asia-south1 --project project-d549298b-2c05-4b94-b8e
gcloud compute firewall-rules delete marg-bandhu-web --project project-d549298b-2c05-4b94-b8e
gcloud iam service-accounts delete nudgebee-sa@project-d549298b-2c05-4b94-b8e.iam.gserviceaccount.com --project project-d549298b-2c05-4b94-b8e
```

## 11. Commit history
| Commit | What |
|---|---|
| `49868bc` | v0.1 first working version |
| `5016118` | LE email optional |
| `2c1ef7f` | v0.3 redesign |
| `2542b50` | seeding fix |
| `c51f763` | blank-page fix |
| `0d9a676` | v0.4 live Google Flights + keys |
| `b0ea786` | history |
| `e920e1c` | v0.5 WhatsApp detail + "not covered" guards |
| `2bc7630` | history |
