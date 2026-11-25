import { useCallback, useEffect, useState } from "react";
import { api, ensureConv, newConv, store, type Config, type Trace } from "./api";
import Landing from "./Landing";
import Plan from "./Plan";
import CabMates from "./CabMates";
import Ops from "./Ops";
import { TraceList } from "./Trace";
import ErrorBoundary from "./ErrorBoundary";

type Page = "home" | "plan" | "cabmates" | "ops";
const parseRoute = () => {
  const [path, q] = location.hash.replace(/^#\/?/, "").split("?");
  const page = (["plan", "cabmates", "ops"].includes(path) ? path : "home") as Page;
  return { page, demo: new URLSearchParams(q ?? "").has("demo") };
};

export default function App() {
  const [route, setRoute] = useState(parseRoute());
  const [cfg, setCfg] = useState<Config | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [tick, setTick] = useState(0); // bumps when a server push arrives, so pages refetch

  useEffect(() => {
    const on = () => { setRoute(parseRoute()); window.scrollTo({ top: 0 }); };
    addEventListener("hashchange", on);
    api.config().then(setCfg).catch(() => {});
    // A link from WhatsApp (#/plan?c=<conversation>) opens that same trip here: plan, fare chart, cab-mates map.
    const linked = new URLSearchParams(location.hash.split("?")[1] ?? "").get("c");
    if (linked && /^[\w-]{6,40}$/.test(linked)) store.set("mb.conv", linked);
    ensureConv().then(setConvId).catch(() => {});
    return () => removeEventListener("hashchange", on);
  }, []);

  const notify = useCallback((t: string) => {
    setToast(t);
    setTimeout(() => setToast((x) => (x === t ? null : x)), 8000);
    try { if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification("Marg Bandhu", { body: t }); } catch {}
  }, []);

  // one live channel per conversation: pool matches, price drops, and the behind-the-scenes trace
  useEffect(() => {
    if (!convId) return;
    setTraces([]);
    const es = new EventSource(`/api/conversations/${convId}/stream`);
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === "trace") setTraces((t) => [...t.slice(-150), ev]);
      if (ev.type === "message" && ev.payload?.notify) { notify(ev.text); setTick((n) => n + 1); }
    };
    return () => es.close();
  }, [convId, notify]);

  const fresh = async () => { const id = await newConv(); setConvId(id); location.hash = "#/plan"; };

  return (
    <div className="flex min-h-screen flex-col">
      <Nav page={route.page} onNewTrip={fresh} />
      <main className="flex-1">
        <ErrorBoundary resetKey={`${route.page}-${convId}`}>
          {route.page === "home" && <Landing />}
          {route.page === "plan" && <Plan key={convId ?? "x"} convId={convId} cfg={cfg} notify={notify} demo={route.demo} />}
          {route.page === "cabmates" && <CabMates convId={convId} cfg={cfg} notify={notify} tick={tick} />}
          {route.page === "ops" && <Ops />}
        </ErrorBoundary>
      </main>
      <Footer cfg={cfg} />

      {toast && (
        <div className="rise fixed bottom-5 left-1/2 z-[1000] w-[min(92vw,440px)] -translate-x-1/2 rounded-2xl bg-navy px-5 py-4 text-sm text-paper shadow-2xl" role="status" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="text-lg" aria-hidden>🔔</span>
            <p className="flex-1 leading-snug">{toast}</p>
            <button onClick={() => setToast(null)} aria-label="Dismiss" className="text-paper/60 hover:text-paper">✕</button>
          </div>
        </div>
      )}

      {route.page !== "home" && route.page !== "ops" && (
        <>
          <button onClick={() => setDrawer(true)} className="fixed bottom-5 right-5 z-[900] hidden rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold shadow-lg hover:bg-mist md:block">
            🔍 Behind the scenes <span className="ml-1 rounded-full bg-navy px-1.5 text-xs text-paper">{traces.length}</span>
          </button>
          {drawer && (
            <div className="fixed inset-0 z-[1001] flex justify-end bg-navy/30" onClick={() => setDrawer(false)}>
              <aside className="h-full w-[min(100vw,480px)] overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} aria-label="Behind the scenes">
                <div className="sticky top-0 flex items-center justify-between border-b border-ink/10 bg-white px-5 py-4">
                  <div>
                    <h2 className="font-semibold">Behind the scenes</h2>
                    <p className="text-xs text-muted">Every Sarvam, Flagsmith, WhatsApp and pooling call for your trip, live.</p>
                  </div>
                  <button onClick={() => setDrawer(false)} aria-label="Close" className="text-xl text-muted">✕</button>
                </div>
                <div className="flex flex-wrap gap-1.5 px-5 py-3 text-xs">
                  {cfg && Object.entries(cfg.sponsors).map(([k, v]) => <span key={k} className={`rounded-full px-2 py-0.5 ${v ? "bg-leaf-soft text-leaf" : "bg-ink/5 text-muted"}`}>{k} {v ? "live" : "offline"}</span>)}
                </div>
                <TraceList items={traces} />
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Nav({ page, onNewTrip }: { page: Page; onNewTrip: () => void }) {
  const dark = page === "home";
  const link = (href: string, label: string, active: boolean) => (
    <a href={href} className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${active ? (dark ? "bg-paper/15 text-paper" : "bg-navy text-paper") : dark ? "text-paper/75 hover:text-paper" : "text-ink/70 hover:text-ink"}`}>{label}</a>
  );
  return (
    <header className={`sticky top-0 z-[950] ${dark ? "bg-navy/95 text-paper" : "border-b border-ink/10 bg-paper/90"} backdrop-blur`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <a href="#/" className="flex items-center gap-2">
          <Logo />
          <span className="font-display text-xl font-bold tracking-tight">Marg Bandhu</span>
        </a>
        <nav className="flex items-center gap-1">
          <span className="hidden sm:contents">
            {link("#/", "Home", page === "home")}
            {link("#/ops", "Ops", page === "ops")}
          </span>
          {page === "plan" || page === "cabmates" ? (
            <button onClick={onNewTrip} className="ml-1 rounded-full border border-ink/15 px-4 py-1.5 text-sm font-semibold hover:bg-mist">New trip</button>
          ) : (
            <a href="#/plan" className="ml-1 rounded-full bg-sky px-4 py-1.5 text-sm font-semibold text-navy hover:bg-[#8ad8ff]">Plan a trip</a>
          )}
        </nav>
      </div>
    </header>
  );
}

/** Two stops joined by a dashed route: the brand mark (also the favicon). */
function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="8" fill="#1e5bd8" />
      <path d="M9 23c2-9 9-5 14-14" fill="none" stroke="white" strokeWidth="2.4" strokeDasharray="3 3" strokeLinecap="round" />
      <circle cx="9" cy="23" r="3" fill="#5cc8ff" />
      <circle cx="23" cy="9" r="3" fill="white" />
    </svg>
  );
}

function Footer({ cfg }: { cfg: Config | null }) {
  return (
    <footer className="bg-navy text-paper/75">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2 text-paper"><Logo size={30} /><span className="font-display text-2xl font-bold tracking-tight">Marg Bandhu</span><span className="font-deva text-lg text-sky">मार्ग बंधु</span></div>
          <p className="mt-3 max-w-sm text-sm leading-relaxed">Your travel companion across India: one plan from your door to your destination, in your own language.</p>
          <a href="#/plan" className="mt-5 inline-flex rounded-full bg-sky px-5 py-2.5 text-sm font-semibold text-navy">Plan a trip with us →</a>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/50">Product</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li><a className="hover:text-paper" href="#/plan">Plan a trip</a></li>
            <li><a className="hover:text-paper" href="#/plan?demo=1">30-second demo</a></li>
            <li><a className="hover:text-paper" href="#/ops">Ops: surviving the festive rush</a></li>
            <li><a className="hover:text-paper" href="https://github.com/suryafk/festivehacks">Source on GitHub</a></li>
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/50">Built with</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li>Sarvam AI: speech, language, voice</li>
            <li>Flagsmith: feature flags & A/B tests</li>
            <li>NudgeBee: keeps it up on surge nights</li>
            {cfg?.whatsapp && <li>WhatsApp via Twilio</li>}
          </ul>
        </div>
      </div>
      <div className="border-t border-paper/10">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-5 text-xs text-paper/50">
          <span>Made at Festive Hacks 2026, Bengaluru.</span>
          <span>Timetables, fares and co-travellers shown are simulated for the demo.</span>
        </div>
      </div>
    </footer>
  );
}
