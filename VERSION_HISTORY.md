# Marg Bandhu: version history

Running log of every change, newest first. Each entry says what changed, how it was verified, and whether it is deployed.

**Working rules (from the team):**
- Every change is verified **locally** first (`http://localhost:8080`).
- The GCP deployment is updated **only when explicitly asked** ("deploy").
- Add an entry here for every change.

**Live:** https://34-93-164-65.sslip.io (GCP, project `project-d549298b-2c05-4b94-b8e`, VM `marg-bandhu`, `asia-south1-a`, k3s).
**Currently deployed commit:** `e920e1c` (v0.5)

---

## Docs · 2026-11-25 · README rewrite · no deploy needed
- `README.md` rewritten for the submission: problem, features table, how each sponsor is used (Sarvam models, the Flagsmith flag table, the NudgeBee surge → OOMKilled → workflow story), architecture, run locally (offline mode + key table), deploy, 3-minute demo script, honest limitations, repo layout, live links incl. WhatsApp sandbox.
- Verified from a **fresh clone** of GitHub: web build OK, `npm test` 10/10, `INLINE_WATCHER=1 npm run dev` serves the app (HTTP 200) and plans a Hindi trip offline (PLAN_READY, simulated fares). Checked against `.env.vm`: no secret values.

## Docs · 2026-11-25 · `427614c` · no deploy needed
- Added `CONTEXT.md`: hand-off brief for another Claude (project, working rules, architecture, sponsor integrations with IDs, GCP/k3s infra, code map, API, env var names, features, local-dev gotchas, done vs open items, commands). Checked against `.env.vm`: no secret values included.

## v0.5 · 2026-11-25 · `e920e1c` · deployed
**Verified on the live site after deploy:**
- Nepal/Ahmedabad (web parse + engine) → "माफ़ कीजिए, अहमदाबाद और नेपाल अभी मार्ग बंधु पर उपलब्ध नहीं है…".
- A normal trip still plans with live Google Flights (₹7,935).
- A simulated WhatsApp inbound produced a PLAN_READY reply sent as **2 messages** (detailed format); Twilio refused only the deliberate dummy number.
- `/#/plan?c=…` serves (HTTP 200).

**WhatsApp confirmed live:** the user's text message produced a plan with live Google Flights fares (BLR→LKO 5 Dec, IndiGo 6E 903, "Wait a little") and Twilio accepted the reply (201).

**Fix: "Nepal → Ahmedabad" (Hindi voice) gave "couldn't find a route with those modes"**
- Root cause (from the live logs): speech-to-text was perfect, but Sarvam-105B **swapped in cities the user never said** (Nepal→Delhi, Ahmedabad→Mumbai), invented modes (cab + train), and on the retry picked a past date (25 Oct). The plan then failed and the reply blamed the modes.
- Fixes in `intent.ts`, `conversation.ts`, `i18n.ts`, `seed.ts`, the web `parse` endpoint and `Plan.tsx`:
  - A city from the model is accepted only if the user's words contain it, or it is already part of the trip being edited; dropped ones are logged as "intent guard".
  - Past dates from the model are rejected (the heuristic date is used).
  - Modes from the model are used only if the user talked about transport.
  - From = To is rejected.
  - New list of well-known places we don't cover (Ahmedabad, Nepal, Goa, Chennai, Kolkata, Pune…, in English + Hindi), detected without the AI. The model's own "unknown places" are used only when that list finds nothing.
  - Clear reply: "माफ़ कीजिए, अहमदाबाद और नेपाल अभी मार्ग बंधु पर उपलब्ध नहीं है… (what we cover)". Hindi replies use Hindi place names.
  - Covered-but-impossible trips (e.g. Delhi → Mumbai) get a coverage message instead of "those modes".
  - The web Plan page shows the message instead of silently planning, and asks for the missing field if only part of the trip was understood.
- Verified locally with the real Sarvam model, 3 runs each: both Nepal/Ahmedabad transcripts and "Bangalore to Goa" / "Kochi via Mysore" → correct "not covered" every time, no substitution. Normal trips still plan (English, Hindi with modes). A Hindi trip without modes now asks for modes instead of inventing them. 4 new unit tests (`server/test/intent.test.ts`); all 10 pass. Browser check on the Plan page shows the message.

**Detailed WhatsApp replies** (new `server/src/channels/waFormat.ts`)
- A plan now arrives as **2 WhatsApp messages** (~600 chars each, under Twilio's 1,600 limit), in English or Hindi, using WhatsApp formatting:
  1. Route: header with dates and festive-rush buffers; recommended option with every leg (times, flight number, fares, live/estimated tag) and arrival time; up to 3 alternatives with date, duration, first flight and fastest/cheapest tags.
  2. Price outlook (best now, Google typical range + level, drop chance in 3/7 days, our pointer); cab mates (count, arrival time, solo vs shared fare); reply commands; link to the full plan on the web.
- New reply commands: **WATCH** starts a fare alert for the plan's flight (reply confirms the current price and alert threshold), **NEW** starts a new trip; **POOL** as before. One-word commands skip the LLM, so they answer instantly.
- Pool match on WhatsApp now lists every rider, destination, km, what each pays and saves, departure time, the fair-split note and the link.
- Web: `#/plan?c=<conversation>` opens the same trip (plan, fare chart, cab-mates map) from the WhatsApp link.
- Hindi polish: route names, Google price level, word order of the arrival line.
- Tests: each test file now uses its own temp folder (they raced on a shared SQLite file when run together). 10/10 pass, 3 runs in a row.
- Verified locally: previews generated by the real engine with live (cached) Google Flights data in EN + HI; WATCH / POOL → watcher match → detailed message / NEW all work; the browser opens the linked trip with the live badge and cab mates.

## v0.4 · 2026-11-25 · `0d9a676` · deployed
**Live sponsor keys + Google Flights live fares**
- The VM `.env` now holds the Sarvam, Flagsmith (server key), Twilio and SerpApi keys. The Flagsmith admin token and project ID are deliberately **not** on the server (only scripts on the laptop use them).
- Verified on the live site:
  - `/healthz` shows sarvam, flagsmith and twilio all true.
  - Sarvam-105B parsed a Hindi sentence into the form (BLR→GD, 26 Dec, ±2, all modes).
  - The plan uses **live Google Flights**: ₹7,935 now vs typical ₹7,900 (₹6,500–₹9,300), Google "typical", verdict "Let us watch it". Recommended trip IndiGo 6E 6596 (live fare); 5 cab mates waiting.
  - Bulbul voice reply served (HTTP 200, ~580 KB WAV).
  - 2 watchers alive, flags from Flagsmith, `degrade_gracefully` off.
  - The browser shows the "● Live · Google Flights" badge.
- SerpApi quota after deploy: 249/250 left. SerpApi served the repeat query from its own cache.
- Includes everything previously listed under "Unreleased" below.
- **To finish WhatsApp:** in the Twilio console set Sandbox → "When a message comes in" = `https://34-93-164-65.sslip.io/webhooks/whatsapp` (POST), then message the sandbox from a joined phone.

### Changes included in v0.4 (previously "Unreleased")
- Added this `VERSION_HISTORY.md`.
- **GCP (infra):** enabled the Monitoring, Logging, Recommender, Cloud Resource Manager, BigQuery and IAM APIs. Created service account `nudgebee-sa@project-d549298b-2c05-4b94-b8e.iam.gserviceaccount.com` with read-only roles (viewer, monitoring.viewer, logging.viewer, bigquery.dataViewer, bigquery.jobUser, recommender.viewer, serviceusage.serviceUsageConsumer).
  - **JSON key NOT created:** the organization policy `iam.disableServiceAccountKeyCreation` is enforced on org `758008451110`. Left in place; it's a security control, and changing it is the owner's call.
  - `.gitignore` now ignores `*-sa-key.json`.
  - **Decision:** skip NudgeBee's GCP account integration and use only the NudgeBee Kubernetes agent on the k3s VM. The `nudgebee-sa` service account is unused and can be deleted.
- **NudgeBee agent installed (cluster only, app not redeployed):** `helm upgrade --install nudgebee-agent` in namespace `nudgebee-agent`, using the user's lightweight command (no Prometheus stack, OpenCost, OTel collector or ClickHouse). The values file with the auth key is at `~/nb-values.yaml` on the VM (mode 600), not in git. All agent pods are Running: runner, forwarder, node-agent, plus first-run scans (kube-bench, trivy). The VM ran at about 96% CPU during the first scans; memory 37%, disk 30%. App pods and the live site were unaffected.
- **Surge test with NudgeBee watching (live, no redeploy):** 1,500 simulated requests → both `pool-watcher` pods OOMKilled → CrashLoopBackOff. The NudgeBee agent relay was connected and NudgeBee began investigating, but its `kubectl exec` was refused: the agent is **read-only** by default (`runner.enableWritePermissions` is off). The workflow's "scale deployment" step will need write permission. Surge cleared afterwards; watchers back to Running, queue 0.
- **NudgeBee agent write permissions ON** (user approved): `helm upgrade ... --set runner.enableWritePermissions=true` (release revision 2). Verified with `kubectl auth can-i` as the runner's service account: scaling deployments in `marg-bandhu` **yes**, pods/exec **yes**, reading Secrets in `marg-bandhu` **no**. Right after the upgrade a NudgeBee-launched pod `nb-llm-…` appeared in `nudgebee-agent` (NudgeBee's own investigation job). The app was not redeployed.
- **Flagsmith set up (project 56018, environment "Development"):** all 10 flags created by `scripts/flagsmith-setup.mjs`. The script now accepts either an organisation Master API key (`Api-Key …`) or a personal API token (`Token …`); the user's admin key is a personal token.
- **Real keys verified locally** (`.env.vm` → localhost): Flagsmith flags are read live (source "flagsmith"). Sarvam-105B parsed "दिसंबर के आखिरी हफ्ते में दिल्ली से बस्ती…" to DEL→BST, train + cab. Bulbul produced a Hindi voice reply. Saaras transcribed a browser-style webm recording correctly.
- **NudgeBee step 5 rehearsed:** the environment uses Flagsmith **v2 feature versioning**, so the old featurestates PATCH returns 400. `PATCH /api/__future__/environments/NSsV2qMXcyyE8vXRmAJ7YV/features/303424/` with `{"environment_default":{"enabled":true|false}}` works: the running app saw `degrade_gracefully` flip ON then OFF within seconds. The flag was left OFF. `k8s/nudgebee-workflow.md` is updated with the exact call.
- **Fix: spoken replies** read "→" as "gives" and "दिस॰" badly. The voice text now says "से" / "to" and "दिसंबर". Verified: reply audio transcribes as "बेंगलुरु से गोंडा छब्बीस दिसंबर…".
- Testing note: a stale local server (started with `--env-file`, so the old stop pattern didn't match it) briefly hid this fix. Use `pkill -f "src/server.ts"` to stop local servers.
- **Not deployed:** the live site still has no sponsor keys; it needs a "deploy" to push `.env.vm` to the VM. Twilio is still pending.
- **Google Flights live fares (SerpApi)**, new `server/src/integrations/googleFlights.ts`:
  - One cached search per route + date (6 h cache in SQLite, `fare_cache` table) to stay within the free plan's 250 searches/month. Only the requested date is fetched; ± flex dates and train legs stay simulated and say so ("simulated fare").
  - Real flights (airline, flight number, times, price, stops) feed the planner for that date.
  - Fare advice when live: "best price now" = Google's lowest price; "expected" = midpoint of Google's typical range; history = Google's price history; drop chance = Monte Carlo using volatility measured from that history. The forecast keeps the model's lead-time/festive shape, anchored to today's real price. Google "low" → Book now; "high" → Let us watch it.
  - New Flagsmith kill switch `live_fares_enabled` (feature 303454, created in project 56018).
  - Any SerpApi error → automatic fallback to the simulated model, logged in the trace.
  - UI: "Live · Google Flights" / "Simulated fares" badge, typical range + Google price level, honest source note, real history start date on the chart, and a "Google Flights" entry in Behind the scenes.
  - Verified locally (no real key yet): 6 new unit tests against a fixture in SerpApi's documented format (`server/test/`). End to end against a local mock SerpApi: correct request (BLR→LKO, one way, INR); the card shows the live data; a repeat search is served from cache (1 SerpApi call). With SerpApi down the plan falls back to simulated. Flag OFF → 0 SerpApi calls; ON → calls resume after ~15 s of Flagsmith propagation.
  - The price-watch alerts (30 s re-quotes) still use the simulated model, so the quota isn't spent on polling.
- **Real SerpApi key verified locally** (Free Plan, 250/month; **1 search used → 249 left**): BLR→LKO on 26 Dec returned 8 real flights (6 nonstop: IndiGo 6E 6353/6596/903, Akasa QP 1501/1521…), lowest ₹7,935, Google level "typical", typical range ₹6,500–₹9,300, 61 days of price history. The parser handled the real response as built.
- **Fix: live data was being ignored when a ±flex day won.** Simulated fares on neighbouring dates were cheaper than real ones (₹6,360 vs ₹7,935), so the recommended trip and the price card fell back to simulated. Now:
  - The price card always uses the live data for the requested date.
  - Neighbouring dates' fares are scaled to the live market level and labelled "estimated · scaled to live Google Flights prices".
  - Retested on cached data (no extra quota): card source google_flights, ₹7,935 vs typical ₹7,900, volatility 6.8% from real history, verdict "Let us watch it". The recommended trip is IndiGo 6E 6596 at ₹7,935 (live).
- **Twilio verified locally** (read-only): trial account active. The user's phone (+91…675) has already joined the sandbox. A simulated inbound webhook ran plan → reply → Twilio API with the real credentials; Twilio authenticated and rejected only the deliberate dummy recipient. No real message was sent. `/api/config` now shows all three sponsors live (sarvam, flagsmith, twilio).
- **Fix:** the sandbox join code is shown as "join salt-gentle" even when the env holds only "salt-gentle".
- Still needed for live WhatsApp: deploy, then set the Twilio sandbox "When a message comes in" URL to `https://34-93-164-65.sslip.io/webhooks/whatsapp` (POST).

## v0.3.2 · 2026-11-25 · `c51f763` · deployed
**Fix: Plan page went blank about 1 s after loading**
- Cause: browsers still held a trip saved by v0.2. Restoring its fare card crashed React (`dropProb` missing).
- Fix: the fare card tolerates missing fields, outdated saved plans aren't restored, and a new `ErrorBoundary` shows a "Start a fresh trip" screen instead of a blank page.
- Verified locally with a recreated old-format trip: no crash, and regenerating works.

## v0.3.1 · 2026-11-25 · `2542b50` · deployed
- Seeded co-travellers are now topped up one by one, by name, so the cab-mates map stays populated (8 travellers at Lucknow) even after earlier matches.

## v0.3 · 2026-11-25 · `2c1ef7f` · deployed
**UI/UX redesign, following the team's layout**
- **Landing (`#/`):** hero with the name, pitch and animated route; sliding deck of 5 feature cards; how-it-works; footer.
- **Plan a trip (`#/plan`):** form (From, To, date, flexibility, modes) plus a "describe it" bar that fills the form from text or voice (Sarvam). "Generate a trip plan for me" shows results on the same page.
- **Flight price outlook:** best price now, expected price (median of the last 3 weeks), chance of a drop of 5% or more within 3 and 7 days (Monte Carlo), and a pointer: Book now / Wait / Let us watch it. "Monitor & notify me" adds a price watch, re-quoted every 30 s, that alerts on the web and WhatsApp. There's a judge-only "simulate price drop" button.
- **Cab mates (`#/cabmates`):** Leaflet map (OpenStreetMap tiles; CARTO now needs a key), hub airport, destinations sized by traveller count, your ride highlighted, a rider list, join pool, and the fair split.
- **New API:** `POST /:id/parse`, `GET /:id/cabmates`, `POST|GET /:id/fare-watch`, `POST /:id/fare-watch/simulate-drop`, and a `set_trip` action.
- Design skills (frontend-design, ui-ux-pro-max, taste) were not installed, so the redesign was done without them.

## v0.2 · 2026-11-25 · infra (no code commit) · deployed
**GCP deployment**
- Enabled the Compute Engine API. Created VM `marg-bandhu` (e2-medium, Ubuntu 24.04), static IP `34.93.164.65` (`marg-bandhu-ip`), and firewall rule `marg-bandhu-web` (80/443).
- k3s with 1 API pod (SQLite on a PVC) and 2 `pool-watcher` pods (256 Mi limit), Traefik with a Let's Encrypt certificate for `34-93-164-65.sslip.io`.
- Verified live: plan → pool match. A surge of 1,500 requests got both watchers **OOMKilled**, and `degrade_gracefully` brought them back (~70–116 MB) with the queue draining.
- The VM env file is kept locally as `.env.vm` (git-ignored).

## v0.1.1 · 2026-11-25 · `5016118`
- `deploy.sh`: the Let's Encrypt email is optional, so no personal email is sent.

## v0.1 · 2026-11-25 · `49868bc`
**First working version**
- Server (Node 24, Fastify, `node:sqlite`): shared conversation engine (Sarvam-105B intent extraction with a heuristic fallback), multi-leg planner, fare advisor, pooling with a segment-sharing fair split, Flagsmith flags with safe defaults, and watcher pods that lease pool requests.
- Channels: web (text + voice with a confirm step) and WhatsApp (Twilio sandbox webhook).
- Ops page: surge simulator, watcher heartbeats, `/metrics`, a NudgeBee callback endpoint.
- k8s manifests, `vm-bootstrap.sh`, `deploy.sh`, `flagsmith-setup.mjs`, `k8s/nudgebee-workflow.md`.

---

## Known gaps / next
- No sponsor keys on the VM yet: Sarvam, Flagsmith and Twilio all show "offline".
- NudgeBee agent not installed on the cluster yet.
- `http://` returns 404 instead of redirecting to `https://`.
- The in-city traffic-timing feature is not built.
- After the hackathon, delete the VM and the static IP (about $25/month).
