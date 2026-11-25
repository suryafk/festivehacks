import { useEffect, useRef, useState } from "react";

const FEATURES = [
  {
    kicker: "Speak, don't fill forms",
    title: "Tell it in your own language",
    body: "“26 दिसंबर के आसपास बेंगलुरु से गोंडा जाना है.” Type it or say it in Hindi, Bhojpuri-flavoured Hinglish, Tamil or 20 other languages. Sarvam AI understands it and answers back out loud.",
    tag: "Sarvam AI · Saaras + Bulbul",
    visual: "voice",
  },
  {
    kicker: "Door to door",
    title: "Flight, train and cab, stitched together",
    body: "Your town has no airport? We fly you to the nearest good airport, pick the train or cab that actually connects, and leave a safe buffer, more of it when festive crowds slow everything down.",
    tag: "Multi-leg planner",
    visual: "route",
  },
  {
    kicker: "Book now or wait?",
    title: "Fare prediction you can act on",
    body: "See today's best price next to 60 days of real price history for your route, how often it has dropped from this level, and a clear pointer: book now, or let us watch it and ping you.",
    tag: "Price watch + alerts",
    visual: "fare",
  },
  {
    kicker: "The last 200 km",
    title: "Find your cab mates",
    body: "See every Marg Bandhu landing at the same airport around your time, heading your way, on a map. Share the cab and split the fare fairly: you pay only for the road you ride.",
    tag: "Pooling + fair split",
    visual: "pool",
  },
  {
    kicker: "Built for the festive rush",
    title: "Doesn't fall over on the busiest night",
    body: "Festive rush mode is a switch we flip in Flagsmith. When traffic spikes, NudgeBee spots failing workers, scales them up, and turns on graceful mode, so your alerts still arrive.",
    tag: "Flagsmith · NudgeBee",
    visual: "ops",
  },
];

function Visual({ kind }: { kind: string }) {
  if (kind === "voice")
    return (
      <div className="flex h-full flex-col justify-center gap-2 p-5">
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-navy px-3 py-2 font-deva text-sm text-paper">🎙️ 26 दिसंबर के आसपास बेंगलुरु से गोंडा जाना है</div>
        <div className="flex items-end gap-[3px] self-end pr-2">
          {[6, 12, 18, 10, 16, 22, 12, 8, 15, 20, 9, 5].map((h, i) => <span key={i} className="w-[3px] rounded bg-sky" style={{ height: h }} />)}
        </div>
        <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 font-deva text-sm shadow-sm">✈️ BLR→LKO 09:30, 🚆 सरयू इंटरसिटी 16:45…</div>
      </div>
    );
  if (kind === "route")
    return (
      <svg viewBox="0 0 300 170" className="h-full w-full">
        <path d="M30 140 Q 110 20 190 60" fill="none" stroke="#0b1d36" strokeWidth="2" className="route-dash" />
        <path d="M190 60 L 270 100" fill="none" stroke="#1e5bd8" strokeWidth="3" strokeDasharray="2 5" />
        {[["BLR", 30, 140], ["LKO", 190, 60], ["Gonda", 270, 100]].map(([n, x, y]) => (
          <g key={n as string}>
            <circle cx={x as number} cy={y as number} r="7" fill="#5cc8ff" stroke="#0b1d36" strokeWidth="2" />
            <text x={x as number} y={(y as number) + 22} textAnchor="middle" fontSize="12" fontWeight="600" fill="#10213a">{n}</text>
          </g>
        ))}
        <text x="100" y="62" fontSize="18">✈️</text>
        <text x="222" y="72" fontSize="16">🚆</text>
      </svg>
    );
  if (kind === "fare")
    return (
      <div className="flex h-full flex-col justify-center p-5">
        <div className="flex items-baseline justify-between"><span className="text-xs uppercase tracking-wider text-muted">Best today</span><span className="font-display text-2xl font-bold">₹7,935</span></div>
        <svg viewBox="0 0 260 70" className="mt-2 w-full" aria-hidden>
          <rect x="0" y="22" width="260" height="30" fill="#0f766e" fillOpacity="0.08" />
          <path d="M0 18 L26 14 L52 24 L78 20 L104 36 L130 30 L156 44 L182 40 L208 46 L234 42 L254 44" fill="none" stroke="#9aa8bb" strokeWidth="2" />
          <circle cx="156" cy="44" r="3" fill="#0f766e" />
          <circle cx="254" cy="44" r="4.5" fill="#0b1d36" />
        </svg>
        <div className="mt-2 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-leaf-soft px-2 py-0.5 text-leaf">cheaper than 65% of the last 60 days</span><span className="rounded-full bg-navy/5 px-2 py-0.5 text-navy">Book now</span></div>
      </div>
    );
  if (kind === "pool")
    return (
      <svg viewBox="0 0 300 170" className="h-full w-full">
        <circle cx="60" cy="90" r="12" fill="#0b1d36" />
        <text x="60" y="94" textAnchor="middle" fontSize="11" fill="#f6f9fc">✈</text>
        {[[230, 40, 3], [250, 95, 2], [200, 140, 1], [150, 60, 1]].map(([x, y, n], i) => (
          <g key={i}>
            <line x1="60" y1="90" x2={x} y2={y} stroke="#5cc8ff" strokeWidth="2" strokeDasharray="3 4" />
            <circle cx={x} cy={y} r={9 + n * 3} fill="#5cc8ff" fillOpacity="0.25" stroke="#5cc8ff" />
            <text x={x} y={y + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#10213a">{n}</text>
          </g>
        ))}
      </svg>
    );
  return (
    <div className="flex h-full flex-col justify-center gap-2 p-5 font-mono text-xs">
      <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-danger" />watcher-7vf6g OOMKilled</div>
      <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-sky" />NudgeBee RCA → approve → scale ×4</div>
      <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-leaf" />degrade_gracefully = ON</div>
      <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-leaf" />queue draining · alerts flowing</div>
    </div>
  );
}

function FeatureDeck() {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const go = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const n = (i + FEATURES.length) % FEATURES.length;
    const card = el.children[n] as HTMLElement;
    el.scrollTo({ left: card.offsetLeft - el.offsetLeft, behavior: "smooth" });
    setIdx(n);
  };
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => go(idx + 1), 5000);
    return () => clearInterval(t);
  }, [idx, paused]);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const w = (el.children[0] as HTMLElement)?.offsetWidth ?? 1;
    setIdx(Math.round(el.scrollLeft / (w + 20)));
  };
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">What Marg Bandhu does</p>
          <h2 className="mt-2 font-display text-4xl font-bold leading-tight tracking-tight md:text-5xl">Everything between your door<br className="hidden md:block" /> and your destination.</h2>
        </div>
        <div className="flex gap-2">
          <button aria-label="Previous feature" onClick={() => go(idx - 1)} className="h-11 w-11 rounded-full border border-ink/15 bg-white text-lg hover:bg-mist">←</button>
          <button aria-label="Next feature" onClick={() => go(idx + 1)} className="h-11 w-11 rounded-full bg-navy text-lg text-paper hover:bg-navy-2">→</button>
        </div>
      </div>
      <div ref={ref} onScroll={onScroll} className="deck -mx-4 flex gap-5 overflow-x-auto px-4 pb-4">
        {FEATURES.map((f, i) => (
          <article key={f.title} className="flex w-[86%] shrink-0 flex-col overflow-hidden rounded-3xl border border-ink/10 bg-white shadow-[0_1px_0_rgba(0,0,0,0.04),0_12px_32px_-18px_rgba(11,29,54,0.35)] sm:w-[60%] lg:w-[40%]">
            <div className="mapgrid h-44 border-b border-ink/5 bg-mist/60">
              <Visual kind={f.visual} />
            </div>
            <div className="flex flex-1 flex-col p-6">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                <span className="tabular-nums text-brand">0{i + 1}</span>
                <span>{f.kicker}</span>
              </div>
              <h3 className="mt-2 font-display text-2xl font-bold leading-snug">{f.title}</h3>
              <p className="mt-2 flex-1 text-[15px] leading-relaxed text-ink/80">{f.body}</p>
              <span className="mt-4 w-fit rounded-full bg-navy/5 px-3 py-1 text-xs font-medium text-navy">{f.tag}</span>
            </div>
          </article>
        ))}
      </div>
      <div className="mt-4 flex justify-center gap-2">
        {FEATURES.map((f, i) => (
          <button key={f.title} aria-label={`Show ${f.title}`} onClick={() => go(i)} className={`h-2 rounded-full transition-all ${i === idx ? "w-8 bg-brand" : "w-2 bg-ink/20"}`} />
        ))}
      </div>
    </section>
  );
}

function HeroRoute() {
  return (
    <svg viewBox="0 0 520 420" className="h-full w-full" role="img" aria-label="Route from Bengaluru by flight to Lucknow, train to Gonda, and a shared cab home">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5cc8ff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#5cc8ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M70 360 C 110 220, 200 200, 290 220" fill="none" stroke="#f6f9fc" strokeOpacity="0.7" strokeWidth="2" className="route-dash" />
      <path d="M290 220 L 390 140" fill="none" stroke="#5cc8ff" strokeWidth="3" strokeDasharray="1 7" strokeLinecap="round" />
      <path d="M390 140 Q 440 110 465 60" fill="none" stroke="#1e5bd8" strokeWidth="3" strokeLinecap="round" />
      {[
        { x: 70, y: 360, label: "Bengaluru", sub: "Thu 09:30" },
        { x: 290, y: 220, label: "Lucknow", sub: "lands 12:15" },
        { x: 390, y: 140, label: "Gonda", sub: "train 16:45" },
      ].map((p) => (
        <g key={p.label}>
          <circle cx={p.x} cy={p.y} r="26" fill="url(#glow)" />
          <circle cx={p.x} cy={p.y} r="7" fill="#5cc8ff" stroke="#0b1d36" strokeWidth="3" />
          <text x={p.x + 14} y={p.y + 26} fill="#f6f9fc" fontSize="15" fontWeight="600">{p.label}</text>
          <text x={p.x + 14} y={p.y + 44} fill="#f6f9fc" fillOpacity="0.6" fontSize="12">{p.sub}</text>
        </g>
      ))}
      <g transform="translate(465 55)">
        <circle r="30" fill="url(#glow)" />
        <text x="-12" y="9" fontSize="26">🏠</text>
      </g>
      <text x="160" y="232" fontSize="26" transform="rotate(-15 160 232)">✈️</text>
      <text x="322" y="172" fontSize="20">🚆</text>
      <text x="440" y="112" fontSize="18">🚕</text>
    </svg>
  );
}

export default function Landing() {
  return (
    <div>
      <section className="relative overflow-hidden bg-navy text-paper">
        <div className="mapgrid-dark absolute inset-0" aria-hidden />
        <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-sky/10 blur-3xl" aria-hidden />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-20 pt-16 md:grid-cols-[1.15fr_1fr] md:pt-24">
          <div className="rise">
            <p className="inline-flex items-center gap-2 rounded-full border border-paper/15 bg-paper/5 px-3 py-1 text-xs font-medium tracking-wide text-paper/80">
              <span className="h-1.5 w-1.5 rounded-full bg-sky" /> Door to door · anywhere in India · 22+ languages
            </p>
            <h1 className="mt-6 font-display text-6xl font-extrabold leading-[0.95] tracking-tighter md:text-7xl">
              Marg Bandhu
              <span className="mt-3 block font-deva text-4xl font-normal text-sky md:text-5xl">मार्ग बंधु</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-paper/80">
              A trip across India shouldn't take three apps and a prayer. Tell us where and when, in your own language. We plan the flight, the train and the cab, tell you <em className="not-italic text-paper">when</em> to book, and find people to split the last mile with.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#/plan" className="rounded-full bg-sky px-7 py-3.5 text-base font-semibold text-navy shadow-[0_8px_24px_-8px_rgba(92,200,255,0.7)] transition hover:-translate-y-0.5 hover:bg-[#8ad8ff]">
                Plan a trip with us →
              </a>
              <a href="#/plan?demo=1" className="rounded-full border border-paper/25 px-6 py-3.5 text-base font-medium text-paper hover:bg-paper/10">
                See a 30-second demo
              </a>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-paper/10 pt-6 text-sm">
              <div><dt className="text-paper/55">Languages</dt><dd className="mt-1 font-display text-2xl font-bold">22+</dd></div>
              <div><dt className="text-paper/55">Modes, one plan</dt><dd className="mt-1 font-display text-2xl font-bold">3</dd></div>
              <div><dt className="text-paper/55">Apps to juggle</dt><dd className="mt-1 font-display text-2xl font-bold">1</dd></div>
            </dl>
          </div>
          <div className="relative aspect-[5/4] w-full rise" style={{ animationDelay: "120ms" }}>
            <HeroRoute />
          </div>
        </div>
      </section>

      <FeatureDeck />

      <section id="how" className="border-y border-ink/10 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-3">
          {[
            ["1", "Tell us the trip", "From where, to where, around which date, and which modes you're fine with. Or just say it."],
            ["2", "Get a plan, not a list", "The best combination door to door, the fare outlook, and how many Marg Bandhus share your last mile."],
            ["3", "We keep watching", "Price drops and new cab mates reach you as a notification here and on WhatsApp."],
          ].map(([n, t, b]) => (
            <div key={n}>
              <div className="font-display text-5xl font-bold text-brand">{n}</div>
              <h3 className="mt-2 text-lg font-semibold">{t}</h3>
              <p className="mt-1 text-ink/75">{b}</p>
            </div>
          ))}
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-16">
          <a href="#/plan" className="inline-flex rounded-full bg-navy px-6 py-3 font-semibold text-paper hover:bg-navy-2">Plan a trip with us →</a>
        </div>
      </section>
    </div>
  );
}
