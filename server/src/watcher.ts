// Pool watcher: stateless worker pods that lease waiting pool requests from the API and try to match them.
// Run several replicas. Memory grows with batch size × candidates (route-corridor index), which is exactly
// what falls over on a Diwali-eve surge, and what NudgeBee + the `degrade_gracefully` flag fix.
import { config } from "./config.ts";
import { matchGroup, type Rider, type SplitWeights } from "./engine/pooling.ts";
import { cityByCode, registerPlace, type City } from "./engine/seed.ts";

const H = { "Content-Type": "application/json", "x-internal-token": config.internalToken };
const api = async (path: string, body?: unknown) => {
  const r = await fetch(config.apiUrl + path, { method: body ? "POST" : "GET", headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json() as Promise<any>;
};

const SAMPLES = 1024;
/** Sample points along hub → town (straight-line corridor). Used to score how much two routes overlap. */
function corridor(r: Rider) {
  const a = cityByCode.get(r.hub)!;
  const b = cityByCode.get(r.town)!;
  const pts = new Float64Array(SAMPLES * 2);
  for (let i = 0; i < SAMPLES; i++) {
    const f = i / (SAMPLES - 1);
    pts[i * 2] = a.lat + (b.lat - a.lat) * f;
    pts[i * 2 + 1] = a.lng + (b.lng - a.lng) * f;
  }
  return pts;
}
function overlap(p: Float64Array, q: Float64Array) {
  let near = 0;
  for (let i = 0; i < SAMPLES; i += 8) {
    const dl = p[i * 2] - q[i * 2];
    const dg = p[i * 2 + 1] - q[i * 2 + 1];
    if (dl * dl + dg * dg < 0.0025) near++; // ~5 km
  }
  return near / (SAMPLES / 8);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runWatcher() {
  let processed = 0;
  let matched = 0;
  let batchSize = 0;
  const beat = async () => {
    try {
      await api("/internal/heartbeat", { pod: config.podName, batch: batchSize, rssMB: Math.round(process.memoryUsage().rss / 1e6), processed, matched });
    } catch {}
  };
  setInterval(beat, 5000);
  await beat();
  console.log(`[watcher ${config.podName}] started, api=${config.apiUrl}`);

  for (;;) {
    let interval = 3000;
    try {
      const cfg = (await api("/internal/config")) as { watcher: { batchSize: number; intervalMs: number }; degrade: boolean; split: SplitWeights };
      batchSize = cfg.degrade ? Math.max(5, Math.round(cfg.watcher.batchSize / 10)) : cfg.watcher.batchSize;
      interval = cfg.degrade ? cfg.watcher.intervalMs * 2 : cfg.watcher.intervalMs;
      const { jobs, places = [] } = (await api("/internal/claim", { pod: config.podName, n: batchSize })) as { jobs: { request: Rider; candidates: Rider[] }[]; places?: City[] };
      for (const p of places) registerPlace(p); // airports / looked-up towns this batch mentions

      // Build the corridor index for the whole batch first (this is the memory-hungry part).
      const index = jobs.map((job) => ({ job, me: corridor(job.request), cands: job.candidates.map((c) => ({ c, pts: corridor(c) })) }));
      for (const { job, me, cands } of index) {
        // corridor overlap breaks ties between riders arriving at similar times (same town first, then most shared road)
        const ranked = cands.map(({ c, pts }) => ({ c, score: c.town === job.request.town ? 1 : overlap(me, pts) })).sort((a, b) => b.score - a.score);
        const group = matchGroup(job.request, ranked.map((x) => x.c), cfg.split);
        const res = await api("/internal/result", { id: job.request.id, memberIds: group.map((g) => g.id), pod: config.podName });
        processed++;
        if (res.matched) matched++;
      }
    } catch (e) {
      console.error(`[watcher ${config.podName}]`, String(e));
    }
    await sleep(interval);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) runWatcher();
