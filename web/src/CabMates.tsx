import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api, rupee, time, type CabMates as Data, type Config } from "./api";
import { SplitCard } from "./Cards";

const pin = (html: string, size = 36) => L.divIcon({ className: "mb-pin", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

export default function CabMates({ convId, cfg, notify, tick }: { convId: string | null; cfg: Config | null; notify: (t: string) => void; tick: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  const load = async () => {
    if (!convId) return;
    try {
      setData(await api.cabmates(convId));
      setErr(null);
    } catch (e) {
      setErr(String(e).includes("no cab") ? "Your current plan has no cab leg. Plan a trip with Cab selected first." : String(e).slice(0, 140));
    }
  };
  useEffect(() => { load(); }, [convId, tick]);
  const waiting = data?.pool?.request.status === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [waiting, convId]);

  // map
  useEffect(() => {
    if (!data || !mapEl.current) return;
    if (!map.current) {
      map.current = L.map(mapEl.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 12,
      }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
    }
    const g = layer.current!;
    g.clearLayers();
    const hub = data.hub;
    const pts: L.LatLngExpression[] = [[hub.lat, hub.lng], [data.me.lat, data.me.lng]];
    for (const t of data.towns) {
      pts.push([t.lat, t.lng]);
      L.polyline([[hub.lat, hub.lng], [t.lat, t.lng]], { color: t.compatible ? "#5cc8ff" : "#9aa8bb", weight: t.compatible ? 3 : 2, dashArray: "4 8", opacity: 0.9 }).addTo(g);
      const s = 30 + Math.min(4, t.count) * 6;
      L.marker([t.lat, t.lng], {
        icon: pin(`<div style="width:${s}px;height:${s}px" class="flex items-center justify-center rounded-full border-2 ${t.compatible ? "border-[#5cc8ff] bg-[#5cc8ff]/30" : "border-[#9aa8bb] bg-white/80"} font-bold text-[#10213a] shadow">${t.count}</div>`, s),
      }).bindTooltip(`${t.name}: ${t.count} Marg Bandhu${t.count > 1 ? "s" : ""}${t.compatible ? " on your route" : ""}`, { direction: "top" }).addTo(g);
    }
    L.polyline([[hub.lat, hub.lng], [data.me.lat, data.me.lng]], { color: "#1e5bd8", weight: 4 }).addTo(g);
    L.marker([data.me.lat, data.me.lng], { icon: pin(`<div class="flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-white bg-[#1e5bd8] text-lg shadow-lg">🏠</div>`, 44), zIndexOffset: 1000 })
      .bindTooltip(`You → ${data.me.townName}`, { permanent: true, direction: "right", offset: [18, 0] }).addTo(g);
    L.marker([hub.lat, hub.lng], { icon: pin(`<div class="flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-white bg-[#0b1d36] text-lg text-white shadow-lg">✈</div>`, 44), zIndexOffset: 900 })
      .bindTooltip(`${hub.name} airport`, { permanent: true, direction: "bottom", offset: [0, 20] }).addTo(g);
    map.current.invalidateSize();
    map.current.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 9 });
  }, [data]);
  useEffect(() => () => { map.current?.remove(); map.current = null; }, []);

  const join = async () => {
    if (!convId || !data) return;
    setBusy(true);
    try {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
      await api.joinPool(convId, data.me.itineraryId);
      await load();
      notify("You're in the pool queue. We'll notify you the moment a cab mate matches.");
    } finally { setBusy(false); }
  };

  if (err)
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="font-display text-2xl font-bold">No cab leg yet</p>
        <p className="mt-2 text-ink/70">{err}</p>
        <a href="#/plan" className="mt-6 inline-flex rounded-full bg-navy px-6 py-3 font-semibold text-paper">← Back to planning</a>
      </div>
    );

  const onRoute = data?.riders.filter((r) => r.compatible) ?? [];
  const others = data?.riders.filter((r) => !r.compatible) ?? [];
  const matched = data?.pool?.pool;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-8">
      <a href="#/plan" className="text-sm font-medium text-muted hover:text-ink">← Back to your plan</a>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">Cab mates</p>
          <h1 className="mt-1 font-display text-4xl font-bold md:text-5xl">
            {!data ? "Finding cab mates…" : matched
              ? <>You're riding with <span className="text-brand">{matched.members.length - 1}</span> Marg Bandhu{matched.members.length === 2 ? "" : "s"}</>
              : <><span className="text-brand">{onRoute.length}</span> Marg Bandhu{onRoute.length === 1 ? "" : "s"} heading your way</>}
          </h1>
          {data && <p className="mt-2 text-ink/70">Landing at {data.hub.name} airport within ±{data.windowMin} min of your {time(data.me.arriveAt)} arrival, going towards {data.me.townName}. {others.length ? `${others.length} more are headed elsewhere.` : ""}</p>}
        </div>
        {data && !data.pool && (
          <button onClick={join} disabled={busy} className="rounded-full bg-brand px-6 py-3.5 font-semibold text-white shadow-[0_10px_24px_-10px_rgba(30,91,216,0.8)] disabled:opacity-60">
            🚕 Pool with them: about {rupee(Math.round(data.me.soloFare / Math.max(2, Math.min(4, onRoute.length + 1)) / 10) * 10)} instead of {rupee(data.me.soloFare)}
          </button>
        )}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="relative overflow-hidden rounded-3xl border border-ink/10 bg-mist shadow-sm">
          <div ref={mapEl} className="h-[420px] w-full lg:h-[560px]" role="region" aria-label="Map of Marg Bandhus landing at the same airport and where they are headed" />
          <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-wrap gap-2 rounded-2xl bg-white/90 px-3 py-2 text-xs shadow">
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-sky" />on your route</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#9aa8bb]" />other direction</span>
            <span className="flex items-center gap-1"><span className="h-1 w-4 rounded bg-brand" />your ride</span>
          </div>
        </div>

        <aside className="space-y-4">
          {matched ? (
            <SplitCard split={matched} me={data?.pool?.request.id} members={matched.members} />
          ) : data?.pool?.request.status === "waiting" ? (
            <div className="rounded-3xl border-2 border-dashed border-sky bg-sky-soft/40 p-5">
              <div className="flex items-center gap-2 font-semibold"><span className="relative flex h-3 w-3"><span className="absolute h-full w-full animate-ping rounded-full bg-sky" /><span className="relative h-3 w-3 rounded-full bg-sky" /></span>Matching you with cab mates…</div>
              <p className="mt-1 text-sm text-ink/70">Our watcher pods check every few seconds. You'll get a notification the moment a group forms.</p>
              {cfg?.judgeControls && <button onClick={() => convId && api.simulateRider(convId).then(load)} className="mt-3 text-sm font-semibold text-brand underline">Demo: simulate another traveller joining</button>}
            </div>
          ) : null}

          <div className="rounded-3xl border border-ink/10 bg-white">
            <h2 className="border-b border-ink/10 px-5 py-3 font-semibold">Landing around your time</h2>
            <ul className="max-h-[420px] divide-y divide-ink/5 overflow-y-auto">
              {[...onRoute, ...others].sort((a, b) => a.arriveAt - b.arriveAt).map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-semibold ${r.compatible ? "bg-sky-soft text-navy" : "bg-ink/5 text-ink/50"}`}>{r.name[0]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.name} <span className="font-normal text-muted">→ {r.townName}</span></div>
                    <div className="text-xs text-muted">lands {time(r.arriveAt)} · {r.dropKm} km</div>
                  </div>
                  {r.compatible ? <span className="rounded-full bg-leaf-soft px-2 py-0.5 text-[11px] font-semibold text-leaf">your route</span> : <span className="text-[11px] text-muted">other way</span>}
                </li>
              ))}
              {data && !data.riders.length && <li className="px-5 py-6 text-sm text-muted">Nobody yet. Join the pool and we'll keep watching.</li>}
            </ul>
          </div>
          <p className="px-1 text-[11px] text-muted">Co-travellers are simulated for the demo. Names only; no phone numbers are shared until everyone confirms.</p>
        </aside>
      </div>
    </div>
  );
}
