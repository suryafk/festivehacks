# 🪔 Marg Bandhu (मार्ग बंधु)

**Your festive-season travel companion: getting home, door to door, in your own language.**

Say or type *"26 दिसंबर के आसपास बेंगलुरु से गोंडा जाना है"* (on the web or on WhatsApp) and Marg Bandhu:

- **Plans the whole trip.** Gonda has no airport, so it flies you Bengaluru → Lucknow, then picks the train or shared cab that actually connects, with bigger buffers during festive rush.
- **Tells you when to book.** It shows a **live Google Flights** price, what the route usually costs, and the chance it drops in the next few days, then points you to **Book now / Wait / Let us watch it** and alerts you when the price drops.
- **Finds your cab mates.** A map shows everyone landing at the same airport around your time and heading your way. Share the cab and **split the fare fairly**: you pay only for the road you ride.
- **Keeps working on Diwali eve.** When traffic spikes and workers crash, **NudgeBee** fixes it and **Flagsmith** switches the app into a graceful mode, so your alerts still arrive.

Built at **Festive Hacks 2026** (WeMakeDevs × WeAreDevelopers Conference India, Bengaluru) with all three sponsors: **Sarvam AI · Flagsmith · NudgeBee**.

> 🔗 **Live:** https://34-93-164-65.sslip.io  ·  **Plan a trip:** [/#/plan](https://34-93-164-65.sslip.io/#/plan)  ·  **30-second demo:** [/#/plan?demo=1](https://34-93-164-65.sslip.io/#/plan?demo=1)  ·  **Ops:** [/#/ops](https://34-93-164-65.sslip.io/#/ops)
>
> 📱 **WhatsApp:** send `join <sandbox-code>` (shown on the site) to **+1 415 523 8886**, then e.g. *"Bengaluru se Gonda 26 Dec"* or a Hindi voice note.

---

## The problem

From Diwali to New Year, millions of people working in Bengaluru, Delhi, Mumbai and Hyderabad go home to towns in UP and Bihar. The trip means juggling three apps (flights, IRCTC, cabs), fares that jump by the day, sold-out trains, and a ₹2,000+ solo cab for the last 150 km. Many travellers are more comfortable in Hindi or Bhojpuri than in an English booking flow. **Marg Bandhu is built for that person and that week.**

## What you can do

| | Feature | Where |
|---|---|---|
| 🗣️ | **Describe the trip by text or voice** in Hindi, English, Hinglish or 20+ Indian languages; it fills the form for you (and asks for whatever is missing) | Web "describe it" bar, WhatsApp |
| 🧭 | **Door-to-door plan:** flight → train / shared cab, direct trains, ± flexible dates; recommended / fastest / cheapest, with every leg timed | Web, WhatsApp |
| 📈 | **Flight price outlook:** best price now (**live, Google Flights**), typical range, Google's price level, real price history, chance of a 5%+ drop in 3 and 7 days, and our pointer | Web card, WhatsApp |
| 🔔 | **Price watch:** "monitor & notify me", with an alert on the web and WhatsApp when it drops | Web, WhatsApp `WATCH` |
| 🚕 | **Cab mates map:** who lands at your airport around your time, where they're headed, and on your route or not | Web `#/cabmates` |
| ⚖️ | **Pool + fair split:** watcher pods match a group in seconds; each person's share is shown stretch by stretch | Web, WhatsApp `POOL` |
| 🎙️ | **Voice replies** in your language (Hindi voice note on WhatsApp) | Web, WhatsApp |
| 🛠️ | **Ops:** simulate a Diwali-eve surge and watch pods get OOMKilled, then NudgeBee + Flagsmith recover | Web `#/ops` |
| 🔍 | **Behind the scenes:** every Sarvam, Flagsmith, Google Flights, WhatsApp and pooling call for your trip, live | Web drawer |

Places outside the current network (e.g. Nepal, Ahmedabad, Goa) get an honest *"not covered yet"* rather than a wrong guess.

## How we use each sponsor

### Sarvam AI: the language and voice layer
- **Saaras v4** (speech-to-text) transcribes web-mic recordings and WhatsApp voice notes, auto-detecting the language, including code-mixed Hinglish.
- **Sarvam-105B** (chat, JSON mode) extracts the trip (origin, destination, date, flexibility, modes) from free text. Guards reject anything the user didn't actually say: no swapped cities, no past dates, no invented modes.
- **Bulbul v3** (text-to-speech) speaks the plan back in the user's language.
- **Mayura** (translation) handles reply languages beyond Hindi and English.
- Replies come from templates filled with real plan data, so the model never invents flights or prices.

### Flagsmith: the festive control panel
| Flag | What it does |
|---|---|
| `festive_rush_mode` | 120-min (vs 75) connection buffers, wider cab-pool windows |
| `pooling_enabled` | Cab pooling on/off; rollout per destination hub via the `destination_hub` trait |
| `book_nudge_copy` | **A/B test** of the "book now" message (`urgent` vs `savings`); clicks on Book are tracked |
| `fare_model`, `split_weights`, `watcher_config` | **Remote config** for the fare model, pool matching / fare split, and watcher batch size |
| `live_fares_enabled` | Kill switch for live Google Flights (protects the API quota) |
| `voice_input_enabled`, `whatsapp_channel_enabled`, `judge_controls` | Kill switches |
| `degrade_gracefully` | **Flipped by NudgeBee during a surge:** watchers take 10× smaller batches at half the pace |

### NudgeBee: keeps it up on the busiest night
- The NudgeBee agent runs on our k3s cluster.
- Pool **watcher pods** have a deliberately tight 256 Mi memory limit. Under a Diwali-eve surge (1,500 pool requests) they build a route index of about 600 MB and get **OOMKilled**.
- The NudgeBee workflow:
  1. AI root-cause analysis
  2. human approval
  3. scale `pool-watcher`
  4. call the Flagsmith API to turn on `degrade_gracefully` (watchers drop to about 70–160 MB)
  5. notify, including the app's `/ops` timeline
- We verified the OOMKill → degrade → recovery cycle on the live cluster. Workflow recipe: [`k8s/nudgebee-workflow.md`](k8s/nudgebee-workflow.md).

### Also used
- **Google Flights via SerpApi** for live fares, price insights and price history (6-hour cache).
- **Twilio WhatsApp sandbox** for the WhatsApp channel.

## Architecture

```
   Web app (React)                                  WhatsApp (Twilio)
   Landing · Plan · Cab-mates map · Ops            text / voice note
            │  REST + Server-Sent Events                 │  webhook
            ▼                                            ▼
   ┌──────────────────────── channel adapters ────────────────────────┐
   │ web: REST, SSE, voice upload   ·   whatsapp: async, 2-msg layout  │
   └──────────────────────────────┬───────────────────────────────────┘
                                  ▼
   ┌──────────────── one conversation engine (shared) ────────────────┐
   │ intent (Sarvam-105B + guards) → planner → fare outlook → pooling  │
   │ every decision reads Flagsmith flags (safe defaults if offline)   │
   └──────────────────────────────┬───────────────────────────────────┘
      Sarvam · Flagsmith · Google Flights (SerpApi) · Twilio · SQLite
                                  │
   pool-watcher pods (stateless, N replicas) lease work from the API → match → notify web + WhatsApp
   NudgeBee agent ─ OOMKilled watchers → RCA → approve → scale + Flagsmith degrade_gracefully
```

- **Server:** Node 24 + Fastify; TypeScript runs natively (no build step); SQLite via `node:sqlite`. One Docker image, two entrypoints: `src/server.ts` (API, also serves the web app) and `src/watcher.ts`.
- **Web:** Vite + React 19 + Tailwind v4 + Leaflet (OpenStreetMap).
- **Infra:** GCP VM (e2-medium, Mumbai) running **k3s** with Traefik + Let's Encrypt HTTPS; API (1 replica, SQLite on a volume) + `pool-watcher` (2 replicas) + NudgeBee agent.
- **Resilience:** every external call has a fallback (heuristic parser, default flags, simulated fares, logged WhatsApp sends), so the demo never dead-ends.

More detail: [`CONTEXT.md`](CONTEXT.md) (full technical brief) · [`VERSION_HISTORY.md`](VERSION_HISTORY.md) (change log).

## Run it locally (no keys needed)

Requirements: **Node 24+**, and **ffmpeg** for voice (optional).

```bash
git clone https://github.com/suryafk/festivehacks.git && cd festivehacks
cd web && npm install && npm run build && cd ..
cd server && npm install
INLINE_WATCHER=1 npm run dev          # http://localhost:8080  (reads ../.env if present)
```

Open http://localhost:8080 and click **See a 30-second demo**. Without keys it runs in offline mode: a built-in parser instead of Sarvam, default flags instead of Flagsmith, simulated fares, and WhatsApp messages logged instead of sent. The browser mic needs `localhost` or HTTPS.

**With keys:** `cp .env.example .env` and fill in what you have (each one switches on one integration):

| Variable | Where to get it |
|---|---|
| `SARVAM_API_KEY` | dashboard.sarvam.ai → API keys |
| `FLAGSMITH_ENVIRONMENT_KEY` | Flagsmith → Environment settings → server-side key (`ser.…`) |
| `FLAGSMITH_ADMIN_API_KEY`, `FLAGSMITH_PROJECT_ID` | Only for `node --env-file=.env scripts/flagsmith-setup.mjs`, which creates all flags (accepts an org API key or a personal token) |
| `SERPAPI_KEY` | serpapi.com → API key (free: 250 searches/month) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SANDBOX_JOIN` | Twilio console → WhatsApp sandbox |
| `PUBLIC_BASE_URL`, `INTERNAL_TOKEN`, `OPS_TOKEN` | Your public HTTPS URL; any random strings |

Tests: `cd server && npm test` (Google Flights parsing, fare advice, intent guards).

## Deploy (GCP VM + k3s)

1. Create an Ubuntu VM (2 vCPU / 4 GB) with ports **80/443** open, then on it run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/suryafk/festivehacks/main/scripts/vm-bootstrap.sh | bash
   ```
   This installs Docker, k3s and Helm and clones the repo. Log out and back in afterwards.
2. Configure and deploy:
   ```bash
   cd ~/festivehacks && cp .env.example .env && nano .env
   ./scripts/deploy.sh
   ```
   This builds the image, loads it into k3s, gets HTTPS for `https://<ip-with-dashes>.sslip.io`, creates the secret from `.env`, and rolls out the API and watchers.
3. In Twilio's sandbox settings, set **When a message comes in** to `https://<host>/webhooks/whatsapp` (POST).
4. NudgeBee: add a Kubernetes cluster in NudgeBee and run its `helm install` command on the VM. Then build the workflow in [`k8s/nudgebee-workflow.md`](k8s/nudgebee-workflow.md). The agent needs `runner.enableWritePermissions=true` to scale deployments.

## Demo script (about 3 minutes)

1. **Landing** → *Plan a trip with us*.
2. **🎤 Speak** *"26 दिसंबर के आसपास बेंगलुरु से गोंडा जाना है, सब चलेगा"*. The "Did you mean?" step appears (Sarvam Saaras), the form fills itself, then **Generate**.
3. **Price outlook:** "● Live · Google Flights", typical range, drop chance → **Monitor & notify me** → *simulate a price drop* → alert.
4. **Find cab mates** → map → **Pool with them** → the match arrives in seconds with the fair split.
5. **WhatsApp:** the same trip as a Hindi voice note → a detailed 2-message plan + voice reply → `WATCH`, `POOL`.
6. **Ops** → *Simulate Diwali-eve surge* → watchers OOMKilled → NudgeBee RCA → approve → scale + Flagsmith `degrade_gracefully` → queue drains.
7. **Flagsmith:** toggle `festive_rush_mode` → re-plan → buffers shrink from 120 to 75 min, with no redeploy.
8. Open **Behind the scenes** to show every sponsor call for the trip.

## Honest limitations

- **Simulated:** train timetables, flights on flexible ± dates (scaled to live prices), co-travellers, and the 30-second price-watch quotes. **Live:** Google Flights fares and history for the requested date, Sarvam, Flagsmith, Twilio, NudgeBee.
- **Coverage today:** from Bengaluru, Delhi, Mumbai and Hyderabad to Lucknow, Patna, Varanasi and 13 towns around them.
- **Twilio sandbox:** each phone must send the join code first. Webhook signature validation is not implemented yet.
- **Not built yet:** in-city "go when traffic is light" timing for festive shopping trips.

## Repository layout

```
server/   Fastify API + conversation engine + watcher (TypeScript, runs natively on Node 24)
web/      React app: Landing, Plan, Cab mates, Ops
k8s/      k3s manifests, Traefik Let's Encrypt config, NudgeBee workflow recipe
scripts/  vm-bootstrap.sh, deploy.sh, flagsmith-setup.mjs
```

---

Made with 🪔 at Festive Hacks 2026, Bengaluru.
