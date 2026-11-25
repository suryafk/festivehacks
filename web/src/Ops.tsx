import { useEffect, useState } from "react";
import { api, type Trace } from "./api";
import { TraceList } from "./Trace";

export default function Ops() {
  const [s, setS] = useState<any>(null);
  const [live, setLive] = useState<Trace[]>([]);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let stop = false;
    const tick = () => api.ops().then((x) => !stop && setS(x)).catch(() => {});
    tick();
    const iv = setInterval(tick, 2000);
    const es = new EventSource("/api/ops/stream");
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === "trace" && ["nudgebee", "surge", "watcher", "pool", "flagsmith"].includes(ev.kind)) setLive((l) => [...l.slice(-80), ev]);
    };
    return () => { stop = true; clearInterval(iv); es.close(); };
  }, []);
  if (!s) return <p className="p-6 text-stone-500">Loading ops…</p>;
  const alive = s.watchers.filter((w: any) => w.alive);
  const dead = s.watchers.filter((w: any) => !w.alive);
  const history: Trace[] = [...s.events].reverse().map((e: any) => ({ ts: e.ts, kind: e.kind, data: e.data }));
  const merged = [...history, ...live.filter((l) => !history.some((h) => h.ts === l.ts && h.kind === l.kind))].sort((a, b) => a.ts - b.ts).slice(-60);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); setMsg(ok); } catch (e) { setMsg(String(e)); }
  };
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 pb-20 pt-8">
      <div className="rounded-3xl bg-night p-6 text-cream md:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-marigold">Ops</p><h1 className="mt-1 font-display text-4xl font-bold">Surviving Diwali eve</h1>
        <p className="mt-1 max-w-3xl text-sm text-cream/75">
          Pool watchers run as Kubernetes pods. On the night before a festival, pool requests spike and the watcher pods run out of memory.
          <b> NudgeBee</b> spots the OOMKilled pods, runs an AI root-cause analysis, asks a human to approve, scales the watcher deployment, and flips the
          <b> Flagsmith</b> flag <code className="rounded bg-white/15 px-1">degrade_gracefully</code> so watchers take smaller batches instead of crashing.
        </p>
        {s.flags.judge_controls && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => run(api.surge, "Surge injected: 1,500 pool requests. Watch the pods.")} className="rounded-full bg-marigold px-5 py-2.5 font-semibold text-night hover:bg-[#ffb43d]">🎆 Simulate Diwali-eve surge</button>
            <button onClick={() => run(api.clearSurge, "Surge traffic cleared.")} className="rounded-full bg-white/10 px-5 py-2.5 text-sm hover:bg-white/20">Clear surge</button>
            {msg && <span className="self-center text-sm text-cream/75">{msg}</span>}
          </div>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Pool queue waiting" value={s.queue.waiting} warn={s.queue.waiting > 200} />
        <Stat label="Riders matched" value={s.queue.matched} />
        <Stat label="Watcher pods alive" value={alive.length} warn={alive.length === 0} />
        <Stat label="degrade_gracefully" value={s.flags.degrade_gracefully ? "ON" : "off"} warn={s.flags.degrade_gracefully} hint={`Flagsmith (${s.flags.source}) · batch ${s.flags.watcher_config.batchSize}`} />
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        <section className="rounded-3xl border border-ink/10 bg-white p-3 md:col-span-2">
          <h3 className="mb-2 font-semibold">Watcher pods</h3>
          {!s.watchers.length && <p className="text-sm text-stone-500">No watcher has checked in yet.</p>}
          <ul className="space-y-1 text-sm">
            {[...alive, ...dead.slice(0, 8)].map((w: any) => (
              <li key={w.pod} className="flex items-center justify-between rounded-lg bg-stone-50 px-2 py-1">
                <span className="flex items-center gap-2 font-mono text-xs"><span className={`h-2 w-2 rounded-full ${w.alive ? "bg-emerald-500" : "bg-red-500"}`} />{w.pod}</span>
                <span className="text-xs tabular-nums text-stone-500">{w.alive ? `${w.rssMB ?? "?"} MB · batch ${w.batch} · ${w.processed} done` : "gone (restarted / OOMKilled)"}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-3xl border border-ink/10 bg-white md:col-span-3">
          <h3 className="border-b border-stone-100 p-3 font-semibold">Timeline: surge → NudgeBee → Flagsmith</h3>
          <div className="max-h-96 overflow-y-auto"><TraceList items={merged} compact /></div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, warn, hint }: { label: string; value: string | number; warn?: boolean; hint?: string }) {
  return (
    <div className={`rounded-3xl border p-5 ${warn ? "border-red-300 bg-red-50" : "border-ink/10 bg-white"}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 font-display text-4xl font-bold tabular-nums ${warn ? "text-red-700" : ""}`}>{value}</div>
      {hint && <div className="text-xs text-stone-500">{hint}</div>}
    </div>
  );
}
