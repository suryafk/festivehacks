import { useState } from "react";
import { city, day, dur, rupee, time, type Card, type FareAdvice, type Itinerary, type Mode, type Split } from "./api";

const ICON: Record<string, string> = { flight: "✈️", train: "🚆", cab: "🚕", transfer: "🚶" };

export function PlanCard({ card }: { card: Card }) {
  const its = card.itineraries as Itinerary[];
  const [open, setOpen] = useState<string | undefined>(its[0]?.id);
  return (
    <section className="rounded-2xl border border-marigold-100 bg-white p-4 shadow-sm">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">
          {city(card.trip.origin)} → {city(card.trip.destination)}
          <span className="ml-2 text-sm font-normal text-stone-500">around {day(card.trip.date)}</span>
        </h3>
        {card.festiveRush && (
          <span className="rounded-full bg-maroon-700/10 px-2 py-0.5 text-xs font-medium text-maroon-700" title="Flagsmith flag festive_rush_mode">
            🪔 Festive rush mode · {card.bufferMin} min buffers
          </span>
        )}
      </header>
      <div className="space-y-2">
        {its.map((it) => (
          <div key={it.id} className={`rounded-xl border ${open === it.id ? "border-marigold-500 bg-marigold-50" : "border-stone-200"} transition`}>
            <button className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left" onClick={() => setOpen(open === it.id ? undefined : it.id)}>
              <div className="flex items-center gap-2">
                <span className="text-lg">{it.legs.filter((l) => l.mode !== "transfer").map((l) => ICON[l.mode]).join(" → ")}</span>
                <span className="font-medium">{it.label}</span>
                {it.tags.filter((t) => ["recommended", "fastest", "cheapest"].includes(t)).map((t) => (
                  <span key={t} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${t === "recommended" ? "bg-marigold-500 text-white" : "bg-stone-100 text-stone-600"}`}>{t}</span>
                ))}
              </div>
              <div className="text-right text-sm">
                <div className="font-semibold">{rupee(it.totalFare)}</div>
                <div className="text-stone-500">{dur(it.totalMin)} · {day(it.depart)}</div>
              </div>
            </button>
            {open === it.id && (
              <ol className="relative mx-3 mb-3 border-l-2 border-dashed border-marigold-300 pl-5">
                {it.legs.map((l, i) => (
                  <li key={i} className="relative mb-3 last:mb-0">
                    <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full bg-white text-sm ring-2 ring-marigold-300">{ICON[l.mode]}</span>
                    <div className="flex flex-wrap justify-between gap-x-3 text-sm">
                      <span className="font-medium">{l.name}</span>
                      <span className="tabular-nums text-stone-600">{time(l.depart)} → {time(l.arrive)}{l.fare ? ` · ${rupee(l.fare)}` : ""}</span>
                    </div>
                    <div className="text-xs text-stone-500">{l.mode === "transfer" ? `at ${city(l.from)}` : `${city(l.from)} → ${city(l.to)}`}{l.note ? ` · ${l.note}` : ""}</div>
                  </li>
                ))}
                {it.tags.filter((t) => !["recommended", "fastest", "cheapest", "poolable"].includes(t)).length > 0 && (
                  <li className="text-xs text-stone-500">{it.tags.filter((t) => !["recommended", "fastest", "cheapest", "poolable"].includes(t)).join(" · ")}</li>
                )}
              </ol>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-stone-400">Timetables and fares are simulated for the demo.</p>
    </section>
  );
}

function FareChart({ a }: { a: FareAdvice }) {
  const pts = [...a.history.map((p) => ({ ...p, past: true })), ...a.forecast.map((p) => ({ ...p, past: false }))];
  const W = 320, H = 90, P = 6;
  const min = Math.min(...pts.map((p) => p.fare)) * 0.95;
  const max = Math.max(...pts.map((p) => p.fare)) * 1.02;
  const x = (i: number) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (f: number) => H - P - ((f - min) / (max - min)) * (H - 2 * P);
  const line = (sel: (p: (typeof pts)[number]) => boolean) =>
    pts.map((p, i) => ({ p, i })).filter(({ p }) => sel(p)).map(({ p, i }, k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(p.fare).toFixed(1)}`).join(" ");
  const todayI = a.history.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label="Fare trend: past 3 weeks and forecast until travel">
      <path d={line((p) => p.past)} fill="none" stroke="#a8a29e" strokeWidth="2" />
      <path d={line((p) => !p.past)} fill="none" stroke="#d97706" strokeWidth="2.5" strokeDasharray="5 3" />
      <line x1={x(todayI)} x2={x(todayI)} y1={P} y2={H - P} stroke="#7a1f2b" strokeWidth="1" strokeDasharray="2 2" />
      <text x={x(todayI) + 3} y={P + 8} fontSize="9" fill="#7a1f2b">today</text>
      <circle cx={x(todayI)} cy={y(a.currentFare)} r="3.5" fill="#7a1f2b" />
      <text x={W - P} y={H - 2} fontSize="9" textAnchor="end" fill="#78716c">travel day</text>
    </svg>
  );
}

export function FareCard({ card, onTrack }: { card: Card; onTrack: (event: string, variant: string) => void }) {
  const a = card.advice as FareAdvice;
  const wait = a.verdict === "wait";
  const copy = wait
    ? `Wait: booking by ${day(a.bestBookBy)} should save about ${rupee(a.savings)}.`
    : card.variant === "urgent"
      ? `Fares climb sharply ${a.riseAfter ? "after " + day(a.riseAfter) : "soon"}. Book now.`
      : `${rupee(a.currentFare)} today is close to the lowest you'll see. Book now and save vs last-minute.`;
  return (
    <section className="rounded-2xl border border-marigold-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">When to book · {card.route}</div>
          <div className={`mt-1 text-xl font-bold ${wait ? "text-emerald-700" : "text-maroon-700"}`}>{wait ? "💡 Wait a little" : "⏰ Book now"}</div>
          <p className="mt-1 text-sm text-stone-700">{copy}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums">{rupee(a.currentFare)}</div>
          <div className="text-xs text-stone-500">{a.daysOut} days out{a.festival ? ` · ${a.festival} surge` : ""}</div>
        </div>
      </div>
      <FareChart a={a} />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-stone-400" title="Flagsmith multivariate flag book_nudge_copy">A/B copy: {card.variant}</span>
        <button onClick={() => onTrack("book_cta_click", card.variant)} className="rounded-lg bg-maroon-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-maroon-800">
          Book this flight →
        </button>
      </div>
    </section>
  );
}

export function PoolPreviewCard({ card, onJoin, disabled }: { card: Card; onJoin: () => void; disabled?: boolean }) {
  return (
    <section className="rounded-2xl border border-marigold-100 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Last mile · shared cab from {city(card.hub)} airport</div>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">
            {card.waiting > 0 ? `${card.waiting} traveller${card.waiting > 1 ? "s" : ""} heading your way` : "No co-travellers yet"}
          </div>
          <p className="text-sm text-stone-600">
            Landing around {time(card.arriveAt)} → {city(card.town)}. Solo cab {rupee(card.soloFare)}
            {card.estShare ? <>, shared about <b className="text-emerald-700">{rupee(card.estShare)}</b></> : null}.
          </p>
        </div>
        <button disabled={disabled} onClick={onJoin} className="rounded-lg bg-marigold-500 px-4 py-2 font-semibold text-white shadow hover:bg-marigold-600 disabled:opacity-50">
          🚕 Find my pool
        </button>
      </div>
    </section>
  );
}

export function PoolCard({ card, onSimulate, judge }: { card: Card; onSimulate: () => void; judge: boolean }) {
  if (card.status === "waiting")
    return (
      <section className="rounded-2xl border-2 border-dashed border-marigold-300 bg-marigold-50 p-4">
        <div className="flex items-center gap-2 font-semibold"><span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-marigold-500 opacity-75" /><span className="relative inline-flex h-3 w-3 rounded-full bg-marigold-600" /></span>Watching for co-travellers to {city(card.town)}</div>
        <p className="mt-1 text-sm text-stone-600">Watcher pods are checking every few seconds. You'll get a notification here{card.whatsapp ? " and on WhatsApp" : ""} the moment someone matches.</p>
        {judge && <button onClick={onSimulate} className="mt-2 text-sm font-medium text-maroon-700 underline">Demo: simulate another traveller joining</button>}
      </section>
    );
  const split = card.split as Split;
  const members = card.members as { id: string; name: string; town: string }[];
  const maxKm = split.totalKm;
  return (
    <section className="pop rounded-2xl border-2 border-emerald-500 bg-white p-4 shadow">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold text-emerald-700">🎉 Pool confirmed · {members.length} riders</h3>
        <span className="text-sm text-stone-600">Cab leaves {time(split.departAt)} · {split.totalKm} km · {rupee(split.totalFare)} total</span>
      </div>
      <div className="mt-3 space-y-2">
        {split.lines.map((l) => (
          <div key={l.riderId} className={`rounded-lg p-2 ${l.riderId === card.me ? "bg-emerald-50 ring-1 ring-emerald-300" : "bg-stone-50"}`}>
            <div className="flex justify-between text-sm">
              <span className="font-medium">{l.riderId === card.me ? "You" : l.name} → {city(l.town)} <span className="text-stone-400">({l.dropKm} km)</span></span>
              <span className="tabular-nums"><b>{rupee(l.pays)}</b> <span className="text-emerald-700">save {rupee(l.saves)}</span></span>
            </div>
            <div className="mt-1 flex h-2 overflow-hidden rounded bg-stone-200">
              {l.segments.map((s, i) => (
                <div key={i} title={`${s.fromKm}–${s.toKm} km shared by ${s.sharedWith}: ${rupee(s.cost)}`} style={{ width: `${((s.toKm - s.fromKm) / maxKm) * 100}%`, opacity: 0.35 + 0.65 / s.sharedWith }} className="border-r border-white bg-marigold-500" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-stone-500">How it's split: each stretch of road costs the same per km and is shared by whoever is still in the cab. Getting off earlier means paying less. Lighter bar = more people sharing that stretch.</p>
    </section>
  );
}

export function AskModes({ onPick }: { onPick: (m: Mode[]) => void }) {
  const [sel, setSel] = useState<Mode[]>(["flight", "train", "cab"]);
  const toggle = (m: Mode) => setSel((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {(["flight", "train", "cab"] as Mode[]).map((m) => (
        <button key={m} onClick={() => toggle(m)} className={`rounded-full border px-3 py-1 text-sm ${sel.includes(m) ? "border-marigold-500 bg-marigold-100" : "border-stone-300 bg-white text-stone-500"}`}>
          {ICON[m]} {m}
        </button>
      ))}
      <button disabled={!sel.length} onClick={() => onPick(sel)} className="rounded-full bg-maroon-700 px-3 py-1 text-sm font-medium text-white disabled:opacity-40">Plan it →</button>
    </div>
  );
}
