import { useState } from "react";
import { city, day, dur, rupee, time, weekday, type Card, type FareAdvice, type FareWatch, type Itinerary, type Split } from "./api";

const ICON: Record<string, string> = { flight: "✈️", train: "🚆", cab: "🚕", transfer: "🚶" };
const cardCls = "rounded-3xl border border-ink/10 bg-white p-5 shadow-[0_1px_0_rgba(0,0,0,0.03),0_16px_40px_-28px_rgba(27,21,48,0.45)] md:p-6";

/* ---------------- Flight price prediction ---------------- */

function FareChart({ a }: { a: FareAdvice }) {
  const pts = [...a.history.map((p) => ({ ...p, past: true })), ...a.forecast.map((p) => ({ ...p, past: false }))];
  const W = 820, H = 150, P = 10;
  const min = Math.min(...pts.map((p) => p.fare), a.expectedFare) * 0.96;
  const max = Math.max(...pts.map((p) => p.fare)) * 1.03;
  const x = (i: number) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (f: number) => H - P - ((f - min) / (max - min)) * (H - 2 * P);
  const path = (sel: (p: (typeof pts)[number]) => boolean) =>
    pts.map((p, i) => ({ p, i })).filter(({ p }) => sel(p)).map(({ p, i }, k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(p.fare).toFixed(1)}`).join(" ");
  const ti = a.history.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label="Fare for your travel date: last 3 weeks of quotes and our forecast until travel day">
      <line x1={P} x2={W - P} y1={y(a.expectedFare)} y2={y(a.expectedFare)} stroke="#0f766e" strokeDasharray="3 4" strokeWidth="1.2" />
      <text x={P + 2} y={y(a.expectedFare) - 5} fontSize="11" fill="#0f766e">expected {rupee(a.expectedFare)}</text>
      <path d={path((p) => p.past)} fill="none" stroke="#a59fb0" strokeWidth="2.2" />
      <path d={path((p) => !p.past)} fill="none" stroke="#e2483d" strokeWidth="2.5" strokeDasharray="6 4" />
      <line x1={x(ti)} x2={x(ti)} y1={P} y2={H - P} stroke="#1b1530" strokeOpacity="0.4" />
      <circle cx={x(ti)} cy={y(a.currentFare)} r="5" fill="#1b1530" />
      <text x={x(ti)} y={H + 14} fontSize="11" textAnchor="middle" fill="#1b1530">today</text>
      <text x={P} y={H + 14} fontSize="11" fill="#6b6478">{a.history[0] ? `since ${day(a.history[0].date)}` : ""}</text>
      <text x={W - P} y={H + 14} fontSize="11" textAnchor="end" fill="#6b6478">travel day</text>
    </svg>
  );
}

const VERDICT = {
  book_now: { label: "Book now", tone: "bg-vermilion text-white", line: "Prices only climb from here." },
  wait: { label: "Wait a little", tone: "bg-leaf text-white", line: "A cheaper fare is likely soon." },
  monitor: { label: "Let us watch it", tone: "bg-marigold text-night", line: "There's a real chance it dips. We'll alert you." },
};

export function FlightPriceCard({ card, watch, judge, onBook, onWatch, onSimulateDrop }: {
  card: Card; watch: FareWatch | null; judge: boolean;
  onBook: () => void; onWatch: () => void; onSimulateDrop: () => void;
}) {
  // Tolerate advice saved by older versions (no expected price / drop probability yet).
  const raw = (card.advice ?? {}) as Partial<FareAdvice>;
  const a: FareAdvice = {
    verdict: "book_now", currentFare: 0, bestFare: 0, bestBookBy: "", daysOut: 0, savings: 0, history: [], forecast: [],
    ...raw,
    expectedFare: raw.expectedFare ?? raw.currentFare ?? 0,
    vsExpectedPct: raw.vsExpectedPct ?? 0,
    dropProb: Array.isArray(raw.dropProb) ? raw.dropProb : [],
  } as FareAdvice;
  const v = VERDICT[a.verdict] ?? VERDICT.book_now;
  const why =
    a.verdict === "wait"
      ? `Booking by ${day(a.bestBookBy)} should save about ${rupee(a.savings)}.`
      : a.verdict === "monitor"
        ? `Today's fare is ${Math.abs(a.vsExpectedPct)}% ${a.vsExpectedPct <= 0 ? "below" : "above"} what it usually costs, and there's a ${a.dropProb.at(-1)?.pct ?? 0}% chance of a 5%+ drop within ${a.dropProb.at(-1)?.days ?? 7} days.`
        : card.variant === "savings"
          ? `${rupee(a.currentFare)} is close to the lowest you'll see${a.festival ? ` before the ${a.festival} rush` : ""}.`
          : `Fares climb sharply ${a.riseAfter ? "after " + day(a.riseAfter) : "soon"}${a.festival ? `: it's ${a.festival} week` : ""}.`;
  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Flight price outlook · {card.route}</p>
          <h3 className="mt-1 font-display text-2xl font-bold">Should you book today?</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.source === "google_flights"
            ? <span className="rounded-full bg-leaf-soft px-3 py-1 text-xs font-semibold text-leaf" title={a.fetchedAt ? `Fetched ${new Date(a.fetchedAt).toLocaleString("en-IN")}` : undefined}>● Live · Google Flights</span>
            : <span className="rounded-full bg-ink/5 px-3 py-1 text-xs font-semibold text-muted">Simulated fares</span>}
          {a.festival && <span className="rounded-full bg-vermilion/10 px-3 py-1 text-xs font-semibold text-vermilion">🪔 {a.festival} surge pricing</span>}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-night p-4 text-cream">
          <div className="text-xs uppercase tracking-wider text-cream/60">Best price now</div>
          <div className="mt-1 font-display text-3xl font-bold tabular-nums">{rupee(a.currentFare)}</div>
          <div className="text-xs text-cream/60">{a.daysOut} days before travel</div>
        </div>
        <div className="rounded-2xl bg-sand/70 p-4">
          <div className="text-xs uppercase tracking-wider text-muted">{a.typicalRange ? "Typical (Google)" : "Expected (history)"}</div>
          <div className="mt-1 font-display text-3xl font-bold tabular-nums">{rupee(a.expectedFare)}</div>
          <div className={`text-xs font-medium ${a.vsExpectedPct <= 0 ? "text-leaf" : "text-vermilion"}`}>
            today is {Math.abs(a.vsExpectedPct)}% {a.vsExpectedPct <= 0 ? "cheaper" : "dearer"}
          </div>
          {a.typicalRange && <div className="text-xs text-muted">range {rupee(a.typicalRange[0])}–{rupee(a.typicalRange[1])}{a.priceLevel ? ` · Google says "${a.priceLevel}"` : ""}</div>}
        </div>
        <div className="rounded-2xl bg-sand/70 p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Chance it drops ≥5%</div>
          <div className="mt-2 space-y-2">
            {a.dropProb.length ? a.dropProb.map((d) => (
              <div key={d.days}>
                <div className="flex justify-between text-xs"><span>within {d.days} days</span><b className="tabular-nums">{d.pct}%</b></div>
                <div className="mt-1 h-1.5 rounded-full bg-ink/10"><div className="h-1.5 rounded-full bg-leaf" style={{ width: `${d.pct}%` }} /></div>
              </div>
            )) : <div className="text-sm text-muted">Too close to travel</div>}
          </div>
        </div>
      </div>

      <div className="mt-4"><FareChart a={a} /></div>

      <div className="mt-4 rounded-2xl border border-ink/10 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${v.tone}`}>Our pointer: {v.label}</span>
          <span className="text-sm text-ink/80">{why}</span>
        </div>
        {watch?.status === "watching" ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-marigold-soft/60 px-3 py-2 text-sm">
            <span className="relative flex h-2.5 w-2.5"><span className="absolute h-full w-full animate-ping rounded-full bg-marigold" /><span className="relative h-2.5 w-2.5 rounded-full bg-marigold" /></span>
            Watching {city(watch.origin)}→{city(watch.dest)}. We'll notify you below <b>{rupee(watch.target)}</b> (last check {rupee(watch.last_quote)}).
            {judge && <button onClick={onSimulateDrop} className="ml-auto text-xs font-semibold text-vermilion underline">Demo: simulate a price drop</button>}
          </div>
        ) : watch?.status === "fired" ? (
          <div className="mt-3 rounded-xl bg-leaf-soft px-3 py-2 text-sm text-leaf">📉 Price dropped to <b>{rupee(watch.last_quote)}</b>, {rupee(watch.start_fare - watch.last_quote)} less than when you started watching.</div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={onBook} className={`rounded-full px-4 py-2 text-sm font-semibold ${a.verdict === "book_now" ? "bg-night text-cream" : "border border-ink/15 bg-white"}`}>Book now at {rupee(a.currentFare)}</button>
          <button disabled={watch?.status === "watching"} onClick={onWatch} className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50 ${a.verdict !== "book_now" ? "bg-night text-cream" : "border border-ink/15 bg-white"}`}>
            🔔 Monitor & notify me when it drops
          </button>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted">
        {a.source === "google_flights"
          ? `Today's price, typical range and price history: Google Flights via SerpApi. Forecast and drop chance: our model, calibrated to that history (daily volatility ${a.volatilityPct ?? "?"}%).`
          : "Fares and history are simulated for the demo (no live fare feed for this search)."} A/B copy variant: {card.variant} (Flagsmith).
      </p>
    </section>
  );
}

/* ---------------- Itineraries ---------------- */

export function Itineraries({ card }: { card: Card }) {
  const its = card.itineraries as Itinerary[];
  const [open, setOpen] = useState<string | undefined>(its[0]?.id);
  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-2xl font-bold">Ways to get there</h3>
        {card.festiveRush && <span className="text-xs font-medium text-muted" title="Flagsmith flag festive_rush_mode">Festive rush mode: {card.bufferMin} min connection buffers</span>}
      </div>
      <div className="mt-4 space-y-3">
        {its.map((it) => {
          const isOpen = open === it.id;
          return (
            <div key={it.id} className={`rounded-2xl border transition ${isOpen ? "border-night/70 shadow-sm" : "border-ink/10 hover:border-ink/25"}`}>
              <button aria-expanded={isOpen} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left" onClick={() => setOpen(isOpen ? undefined : it.id)}>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg" aria-hidden>{it.legs.filter((l) => l.mode !== "transfer").map((l) => ICON[l.mode]).join("  ")}</span>
                    <span className="font-semibold">{it.label}</span>
                    {it.tags.filter((t) => ["recommended", "fastest", "cheapest"].includes(t)).map((t) => (
                      <span key={t} className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${t === "recommended" ? "bg-marigold text-night" : "bg-ink/5 text-ink/70"}`}>{t}</span>
                    ))}
                  </div>
                  <div className="mt-1 text-sm text-muted">{weekday(it.date)} · {time(it.depart)} → {time(it.arrive)}{new Date(it.arrive).getDate() !== new Date(it.depart).getDate() ? " (+1)" : ""}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-xl font-bold tabular-nums">{rupee(it.totalFare)}</div>
                  <div className="text-sm text-muted">{dur(it.totalMin)}</div>
                </div>
              </button>
              {isOpen && (
                <ol className="mx-4 mb-4 border-l-2 border-dashed border-ink/15 pl-6">
                  {it.legs.map((l, i) => (
                    <li key={i} className="relative pb-4 last:pb-0">
                      <span className="absolute -left-[37px] flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm ring-2 ring-ink/10" aria-hidden>{ICON[l.mode]}</span>
                      <div className="flex flex-wrap justify-between gap-x-3 text-sm">
                        <span className="font-semibold">{l.name}</span>
                        <span className="tabular-nums text-ink/70">{time(l.depart)} → {time(l.arrive)}{l.fare ? ` · ${rupee(l.fare)}` : ""}</span>
                      </div>
                      <div className="text-xs text-muted">{l.mode === "transfer" ? `in ${city(l.from)}` : `${city(l.from)} → ${city(l.to)}`}{l.note ? ` · ${l.note}` : ""}</div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted">Timetables are simulated for the demo.</p>
    </section>
  );
}

/* ---------------- Cab mates teaser ---------------- */

export function CabTeaser({ card, onFind }: { card: Card; onFind: () => void }) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-night p-6 text-cream">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-marigold/15 blur-2xl" aria-hidden />
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cream/60">The last mile · from {city(card.hub)} airport</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="font-display text-3xl font-bold">
            {card.waiting > 0 ? <><span className="text-marigold">{card.waiting}</span> Marg Bandhu{card.waiting > 1 ? "s" : ""} heading your way</> : "Be the first cab mate on this route"}
          </h3>
          <p className="mt-1 text-cream/75">
            Landing around {time(card.arriveAt)}, going towards {city(card.town)}. A solo cab is {rupee(card.soloFare)}
            {card.estShare ? <>; shared, your part is about <b className="text-marigold">{rupee(card.estShare)}</b></> : null}.
          </p>
        </div>
        <button onClick={onFind} className="rounded-full bg-marigold px-6 py-3 font-semibold text-night hover:bg-[#ffb43d]">Find cab mates for me →</button>
      </div>
    </section>
  );
}

/* ---------------- Pool status + fair split ---------------- */

export function SplitCard({ split, me, members }: { split: Split; me?: string; members: { id: string; name: string; town: string }[] }) {
  const maxKm = split.totalKm;
  return (
    <section className="rise rounded-3xl border-2 border-leaf bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-2xl font-bold text-leaf">🎉 Pool confirmed · {members.length} riders</h3>
        <span className="text-sm text-muted">Leaves {time(split.departAt)} · {split.totalKm} km · {rupee(split.totalFare)} total</span>
      </div>
      <div className="mt-4 space-y-2">
        {split.lines.map((l) => (
          <div key={l.riderId} className={`rounded-xl p-3 ${l.riderId === me ? "bg-leaf-soft ring-1 ring-leaf/40" : "bg-sand/50"}`}>
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="font-semibold">{l.riderId === me ? "You" : l.name} → {city(l.town)} <span className="font-normal text-muted">({l.dropKm} km)</span></span>
              <span className="tabular-nums"><b>{rupee(l.pays)}</b> <span className="text-leaf">saves {rupee(l.saves)}</span></span>
            </div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-ink/10">
              {l.segments.map((s, i) => (
                <div key={i} title={`${s.fromKm}–${s.toKm} km shared by ${s.sharedWith}: ${rupee(s.cost)}`} style={{ width: `${((s.toKm - s.fromKm) / maxKm) * 100}%`, opacity: 0.35 + 0.65 / s.sharedWith }} className="border-r border-white bg-marigold" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">Fair split: each stretch of road is shared equally by whoever is still in the cab, so getting off earlier costs less. A lighter bar means more people shared that stretch.</p>
    </section>
  );
}
