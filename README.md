# 🪔 Marg Bandhu (मार्ग बंधु)

**Your festive-season travel companion.** Tell it, by typing or speaking in Hindi, English or your own language, *"26 दिसंबर के आसपास बेंगलुरु से गोंडा जाना है"* and it plans the whole trip home, door to door:

- **Flight + train + cab, stitched together.** Gonda has no airport, so: fly BLR→LKO, take the 16:45 Saryu Intercity, with a connection buffer that grows in festive rush mode.
- **When to book.** A fare forecast tells you whether to book now or wait, and when fares jump.
- **Share the last mile.** It shows who else lands at Lucknow at the same time heading your way, keeps watching if nobody is there yet, and notifies you on the web and on WhatsApp when someone joins.
- **A fair fare split.** Each stretch of road is shared by whoever is still in the cab, so the person who gets off first pays least.

Built in one day at **Festive Hacks 2026** (WeMakeDevs × WeAreDevelopers, Bengaluru) with **Sarvam AI**, **Flagsmith** and **NudgeBee**.

> **Live demo:** `https://<vm-ip>.sslip.io` (see *Deploy*) · Ops: `/#/ops` · How it works: `/#/how`
> Travel timetables, fares and co-travellers are **simulated** (there is no public IRCTC / fare-history API). Everything else is real.

---

## Who it's for

Someone working or studying in Bengaluru, Delhi or Mumbai going home to a tier-2 or tier-3 town in UP or Bihar for Diwali, Chhath or Christmas, and more comfortable in Hindi than in an English-only booking app. They currently juggle three apps, the fares and seats that run out first, and a ₹2,000 solo cab at the end.

## How each sponsor is used

| Sponsor | What it does in Marg Bandhu |
|---|---|
| **Sarvam AI** | **Saaras v4** transcribes voice from the web mic or WhatsApp voice notes, with auto language detection and code-mixed Hinglish. **Sarvam-105B** turns free text into structured trip JSON. **Bulbul** speaks the plan back in the user's language. **Mayura** translates replies for languages beyond Hindi and English. |
| **Flagsmith** | `festive_rush_mode` (bigger connection buffers, wider pool windows) · `pooling_enabled` (rolled out per destination hub with segments on the `destination_hub` trait) · `book_nudge_copy` (A/B test of "urgent" vs "savings" copy, conversion tracked on the Book button) · `fare_model`, `split_weights`, `watcher_config` (remote config) · `voice_input_enabled`, `whatsapp_channel_enabled`, `judge_controls` (kill switches) · `degrade_gracefully` (flipped by NudgeBee during a surge). |
| **NudgeBee** | The agent runs on the k3s cluster. On a Diwali-eve spike, `pool-watcher` pods get OOMKilled. A NudgeBee workflow runs AI root-cause analysis, waits for **human approval**, scales the deployment, calls the **Flagsmith API** to turn on `degrade_gracefully`, and posts to Discord and the app's `/ops` timeline. See [`k8s/nudgebee-workflow.md`](k8s/nudgebee-workflow.md). |
| **WhatsApp** (Twilio) | Second channel on the same engine. Voice notes are transcribed, the bot echoes what it heard, and it replies with text plus a voice note. Pool matches are pushed here too. |

## Architecture

```
Web (text / 🎤)          WhatsApp (text / voice note, Twilio)
      │                              │
      └──────── channel adapters ────┘
                     │  voice → Sarvam Saaras → text   (web: confirm/edit step; WhatsApp: echo "I heard…")
                     ▼
         Conversation engine (one code path)
         Sarvam-105B intent JSON → planner → fare advisor → pool preview
                     │  every decision reads Flagsmith flags (with safe defaults)
                     ▼
         Reply renderer: rich cards + live SSE (web) / text + Bulbul voice note (WhatsApp)

pool-watcher pods (k3s, N replicas, stateless) ── lease waiting pool requests → corridor match → API notifies web + WhatsApp
NudgeBee agent ── OOMKilled watcher → RCA → approval → scale + Flagsmith degrade_gracefully
```

- `server/`: Node 24 + Fastify, TypeScript run natively (no build step), SQLite via `node:sqlite`. One image with two entrypoints: `src/server.ts` (API, which also serves the web app) and `src/watcher.ts`.
- `web/`: Vite + React + Tailwind. Pages: **Plan a trip**, **Ops (NudgeBee)** and **How it works**, plus a live **Behind the scenes** panel showing every Sarvam, Flagsmith, WhatsApp and pooling call.
- `k8s/`: manifests for k3s (API + PVC, watcher deployment, Traefik ingress with Let's Encrypt).

## Run locally (2 minutes, no keys needed)

```bash
cd web && npm install && npm run build && cd ..
cd server && npm install && INLINE_WATCHER=1 npm run dev
# open http://localhost:8080 → "Try as Rohit"
```

Without keys the app uses a deterministic intent parser, default flags, and logs WhatsApp sends instead of sending them. Add keys to `.env` (copy `.env.example`) to turn on Sarvam, Flagsmith and Twilio. The voice mic needs `localhost` or HTTPS.

Hot-reload UI: `cd web && npm run dev` (proxies `/api` to `:8080`).

## Deploy (cloud VM + k3s)

1. Create an Ubuntu VM (2 vCPU / 4 GB) with ports **22, 80, 443** open.
2. SSH in and run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/suryafk/festivehacks/main/scripts/vm-bootstrap.sh | bash
   ```
   Then log out and back in.
3. Configure and deploy:
   ```bash
   cd ~/festivehacks && cp .env.example .env && nano .env
   ./scripts/deploy.sh you@example.com
   ```
   The email is only for the Let's Encrypt certificate. The site comes up at `https://<ip-with-dashes>.sslip.io`.
4. Set up Flagsmith flags in one go:
   ```bash
   node --env-file=.env scripts/flagsmith-setup.mjs
   ```
   Then in the Flagsmith UI, make `book_nudge_copy` multivariate (50/50).
5. Twilio sandbox: set *When a message comes in* to `https://<host>/webhooks/whatsapp` (POST).
6. NudgeBee: install the agent with the Helm command from your NudgeBee dashboard, then build the workflow in [`k8s/nudgebee-workflow.md`](k8s/nudgebee-workflow.md).

## Demo script (3 minutes)

1. **Plan a trip → "Try as Rohit".** A Hindi request produces a flight + train plan with festive-rush buffers, a "Book now" call with the fare curve, and "3 travellers heading your way".
2. **🎤 Speak** a new trip in Hindi. Show the "Did you mean?" step, then the plan with a spoken Hindi reply. The Behind the scenes panel shows the Saaras, Sarvam-105B, Bulbul and Flagsmith calls.
3. **Find my pool.** A watcher pod matches you in seconds. The split shows who pays what and why. If nobody matches, press "simulate another traveller" and the popup arrives.
4. **WhatsApp:** send a voice note to the sandbox and get the same plan back as text plus a voice note.
5. **Ops → Simulate Diwali-eve surge.** Watchers get OOMKilled, NudgeBee runs RCA, you approve, it scales and flips `degrade_gracefully` in Flagsmith, and the queue drains.
6. **Flagsmith:** toggle `festive_rush_mode` off and re-plan. Buffers shrink from 120 to 75 minutes with no redeploy.

## API surface

| Route | What |
|---|---|
| `POST /api/conversations` | start a conversation |
| `POST /api/conversations/:id/message` | `{text}` or `{action}`, with `wasVoice` and `voiceLang` for voice |
| `POST /api/conversations/:id/voice` | multipart audio → `{transcript, lang}` (Sarvam Saaras) |
| `GET /api/conversations/:id/stream` | SSE: messages + behind-the-scenes trace |
| `POST /webhooks/whatsapp` | Twilio inbound |
| `GET /api/ops/state`, `POST /api/ops/surge` | ops page / surge simulator (gated by `judge_controls`) |
| `POST /api/ops/nudgebee?token=` | NudgeBee workflow callback |
| `GET /metrics` | Prometheus: queue depth, watchers alive |

## Honest limitations

- Travel data is simulated: timetables, fares and fare history. Real integrations would use airline/OTA and IRCTC partner APIs.
- The Twilio sandbox requires each phone to send the join code first, so the web app is the main path for judges.
- The in-city traffic-timing idea (leave when traffic is lighter) is designed for but not built in this version.
