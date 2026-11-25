import { useEffect, useRef, useState } from "react";
import { api, city, day, registerNames, type Card, type Config, type FareWatch, type Mode, type PlaceSuggestion, type Reply, type Trip } from "./api";
import { CabTeaser, FlightPriceCard, Itineraries } from "./Cards";

const MODES: { m: Mode; icon: string; label: string; hint: string }[] = [
  { m: "flight", icon: "✈️", label: "Flight", hint: "to the nearest airport" },
  { m: "train", icon: "🚆", label: "Train", hint: "intercity & long distance" },
  { m: "cab", icon: "🚕", label: "Cab", hint: "shared, last mile" },
];

const isoToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** From / To: type any place in India. Suggestions come from the server's list (cities, airports, places looked up
 * before); anything else is looked up on OpenStreetMap when you generate the plan. */
function PlaceInput({ id, label, value, placeholder, className, onChange }: { id: string; label: string; value?: string; placeholder: string; className: string; onChange: (v: string) => void }) {
  const [opts, setOpts] = useState<PlaceSuggestion[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const text = city(value);
  const onType = (v: string) => {
    onChange(v);
    clearTimeout(timer.current);
    if (v.trim().length < 2) return setOpts([]);
    timer.current = window.setTimeout(() => api.places(v).then(setOpts).catch(() => {}), 150);
  };
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      <input list={`${id}-list`} aria-label={label} autoComplete="off" className={className} value={text} placeholder={placeholder}
        onChange={(e) => onType(e.target.value)} />
      <datalist id={`${id}-list`}>
        {opts.map((o) => <option key={o.code} value={o.name}>{o.detail}</option>)}
      </datalist>
    </label>
  );
}

function useRecorder() {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const start = async (onDone: (b: Blob) => void) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); setRec(null); onDone(new Blob(chunks.current, { type: r.mimeType })); };
    r.start();
    setRec(r);
    setTimeout(() => r.state === "recording" && r.stop(), 25_000); // Sarvam sync STT limit is 30 s
  };
  return { recording: Boolean(rec), start, stop: () => rec?.state === "recording" && rec.stop() };
}

export default function Plan({ convId, cfg, notify, demo }: { convId: string | null; cfg: Config | null; notify: (t: string) => void; demo: boolean }) {
  const [trip, setTrip] = useState<Trip>({ origin: "BLR", modes: ["flight", "train", "cab"], flexDays: 1, travellers: 1 });
  const [flash, setFlash] = useState<string[]>([]);
  const [describe, setDescribe] = useState("");
  const [heard, setHeard] = useState<{ transcript: string; lang: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [watch, setWatch] = useState<FareWatch | null>(null);
  const [phone, setPhone] = useState("");
  const [waLinked, setWaLinked] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const rec = useRecorder();
  const ranDemo = useRef(false);

  // restore last plan for this conversation (so Back from the map keeps your results)
  useEffect(() => {
    if (!convId) return;
    api.get(convId).then((c) => {
      setWaLinked(c.whatsapp);
      const last = [...c.messages].reverse().find((m) => m.payload?.cards?.some((x) => x.type === "plan"));
      for (const m of c.messages) registerNames(m.payload?.cards?.find((x) => x.type === "plan")?.names);
      if (c.trip?.destination) setTrip((t) => ({ ...t, ...c.trip }));
      // Only restore plans saved by this version of the app; older ones lack the price-outlook fields.
      const fare = last?.payload?.cards?.find((x) => x.type === "fare");
      const current = !fare || Array.isArray(fare.advice?.dropProb);
      if (last?.payload?.cards && current) setResult({ text: last.text, lang: "en-IN", cards: last.payload.cards, quickReplies: [], stage: c.stage });
    }).catch(() => {});
    api.getWatch(convId).then(setWatch).catch(() => {});
  }, [convId]);

  // live fare-watch updates
  useEffect(() => {
    if (!convId || watch?.status !== "watching") return;
    const iv = setInterval(() => api.getWatch(convId).then(setWatch).catch(() => {}), 5000);
    return () => clearInterval(iv);
  }, [convId, watch?.status]);

  useEffect(() => {
    if (demo && convId && !ranDemo.current) {
      ranDemo.current = true;
      fillFromText("26 दिसंबर के आसपास बेंगलुरु से गोंडा जाना है, फ्लाइट ट्रेन कैब सब चलेगा", true);
    }
  }, [demo, convId]);

  const set = (patch: Trip) => setTrip((t) => ({ ...t, ...patch }));

  async function fillFromText(text: string, thenPlan = false) {
    if (!convId || !text.trim()) return;
    setBusy("Understanding your trip…");
    setError(null);
    try {
      const p = await api.parse(convId, text);
      registerNames(p.names);
      if (p.unknownPlaces?.length) {
        setError(p.message ?? `Couldn't find ${p.unknownPlaces.join(" and ")}.`);
        return;
      }
      const patch: Trip = {};
      for (const k of ["origin", "destination", "date", "flexDays", "modes", "travellers"] as const) if (p[k] != null) (patch as any)[k] = p[k];
      setTrip((t) => ({ ...t, ...patch }));
      setFlash(Object.keys(patch));
      setTimeout(() => setFlash([]), 1300);
      if (thenPlan) {
        const next = { ...trip, ...patch };
        if (!next.destination || !next.date) setError(`Got it so far. Please pick ${!next.destination ? "where you're going" : "a date"} below, then generate the plan.`);
        else await generate(next);
      }
    } catch (e) {
      setError(`Couldn't understand that: ${String(e).slice(0, 100)}`);
    } finally {
      setBusy(null);
    }
  }

  async function generate(t = trip) {
    if (!convId) return;
    if (!t.origin || !t.destination || !t.date || !t.modes?.length) {
      setError("Pick where from, where to, a date and at least one mode.");
      return;
    }
    if (t.origin.trim().toLowerCase() === t.destination.trim().toLowerCase()) return setError("From and To can't be the same.");
    setError(null);
    setBusy("Building your door-to-door plan…");
    try {
      const r = await api.plan(convId, t);
      const planCard = r.cards.find((c) => c.type === "plan");
      registerNames(planCard?.names);
      if (planCard?.trip) setTrip((x) => ({ ...x, origin: planCard.trip.origin, destination: planCard.trip.destination })); // typed names → places
      setResult(r);
      setWatch(null);
      if (!r.cards.some((c) => c.type === "plan")) setError(r.text);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (e) {
      setError(String(e).slice(0, 160));
    } finally {
      setBusy(null);
    }
  }

  const onMic = async () => {
    if (rec.recording) return rec.stop();
    try {
      await rec.start(async (blob) => {
        if (!convId) return;
        setBusy("Listening with Sarvam Saaras…");
        try { setHeard(await api.voice(convId, blob)); }
        catch (e) { setError(`Couldn't transcribe (${String(e).slice(0, 80)}). Try typing instead.`); }
        finally { setBusy(null); }
      });
    } catch { setError("Microphone permission was blocked. You can type instead."); }
  };

  const cards = result?.cards ?? [];
  const find = (type: string) => cards.find((c) => c.type === type) as Card | undefined;
  const plan = find("plan"), fare = find("fare"), pool = find("pool-preview");
  const fieldCls = (k: string) => `w-full rounded-xl border border-ink/15 bg-white px-3 py-3 text-[15px] outline-none transition focus:border-navy focus:ring-2 focus:ring-sky/40 ${flash.includes(k) ? "filled" : ""}`;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-10">
      <header className="rise">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">Plan a trip</p>
        <h1 className="mt-2 font-display text-4xl font-bold md:text-5xl">Where are you headed?</h1>
        <p className="mt-2 max-w-2xl text-ink/70">Fill it in, or just describe it in a sentence, typed or spoken, in any Indian language.</p>
      </header>

      {/* describe it */}
      <div className="mt-8 rounded-3xl bg-navy p-2 pl-4 text-paper shadow-lg">
        {heard ? (
          <div className="p-2">
            <div className="text-xs font-semibold text-sky">🎙️ Did you mean? ({heard.lang} · Sarvam Saaras). Edit if needed.</div>
            <textarea aria-label="Transcript" className="mt-2 w-full rounded-xl bg-white/10 p-3 font-deva text-[15px] outline-none" rows={2} value={heard.transcript} onChange={(e) => setHeard({ ...heard, transcript: e.target.value })} />
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => setHeard(null)} className="rounded-full px-4 py-2 text-sm text-paper/70 hover:text-paper">Discard</button>
              <button onClick={() => { const h = heard; setHeard(null); fillFromText(h.transcript, true); }} className="rounded-full bg-sky px-4 py-2 text-sm font-semibold text-navy">Yes, plan it</button>
            </div>
          </div>
        ) : (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); fillFromText(describe); }}>
            <span className="hidden text-sm text-paper/60 sm:block">✨</span>
            <input aria-label="Describe your trip" value={describe} onChange={(e) => setDescribe(e.target.value)} placeholder="e.g. Bengaluru se Gorakhpur, 26 Dec ke aas-paas, flight aur cab" className="min-w-0 flex-1 bg-transparent py-3 text-[15px] placeholder:text-paper/40 outline-none" />
            {cfg?.voiceInput !== false && (
              <button type="button" onClick={onMic} aria-label={rec.recording ? "Stop recording" : "Speak your trip"} className={`h-11 w-11 shrink-0 rounded-full text-lg ${rec.recording ? "recording bg-danger text-white" : "bg-white/10 hover:bg-white/20"}`}>{rec.recording ? "■" : "🎤"}</button>
            )}
            <button className="h-11 shrink-0 rounded-full bg-paper px-5 text-sm font-semibold text-navy hover:bg-white">Fill the form</button>
          </form>
        )}
      </div>

      {/* the form */}
      <form className="mt-6 rounded-3xl border border-ink/10 bg-white p-5 md:p-7" onSubmit={(e) => { e.preventDefault(); generate(); }}>
        <div className="grid gap-5 md:grid-cols-2">
          <PlaceInput id="from" label="From" value={trip.origin} placeholder="City, town or village" className={fieldCls("origin")} onChange={(v) => set({ origin: v })} />
          <PlaceInput id="to" label="To" value={trip.destination} placeholder="e.g. Gonda, Shimla, Madhubani" className={fieldCls("destination")} onChange={(v) => set({ destination: v })} />
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Around which date?</span>
            <input type="date" min={isoToday()} className={fieldCls("date")} value={trip.date ?? ""} onChange={(e) => set({ date: e.target.value })} />
          </label>
          <div>
            <span className="mb-1.5 block text-sm font-semibold">How flexible?</span>
            <div className={`grid grid-cols-4 gap-1 rounded-xl bg-mist/70 p-1 ${flash.includes("flexDays") ? "filled" : ""}`} role="radiogroup" aria-label="Date flexibility">
              {[0, 1, 2, 3].map((n) => (
                <button type="button" role="radio" aria-checked={trip.flexDays === n} key={n} onClick={() => set({ flexDays: n })} className={`rounded-lg py-2.5 text-sm font-medium ${trip.flexDays === n ? "bg-white shadow-sm" : "text-ink/60 hover:text-ink"}`}>
                  {n === 0 ? "Exact" : `± ${n} day${n > 1 ? "s" : ""}`}
                </button>
              ))}
            </div>
          </div>
        </div>
        <fieldset className="mt-6">
          <legend className="mb-2 text-sm font-semibold">Modes you're comfortable with</legend>
          <div className={`grid gap-3 sm:grid-cols-3 ${flash.includes("modes") ? "filled rounded-2xl" : ""}`}>
            {MODES.map(({ m, icon, label, hint }) => {
              const on = trip.modes?.includes(m);
              return (
                <button type="button" aria-pressed={on} key={m} onClick={() => set({ modes: on ? trip.modes!.filter((x) => x !== m) : [...(trip.modes ?? []), m] })}
                  className={`flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition ${on ? "border-navy bg-navy text-paper" : "border-ink/10 bg-white hover:border-ink/30"}`}>
                  <span className="text-2xl" aria-hidden>{icon}</span>
                  <span><span className="block font-semibold">{label}</span><span className={`block text-xs ${on ? "text-paper/60" : "text-muted"}`}>{hint}</span></span>
                  <span className={`ml-auto flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] ${on ? "border-sky bg-sky text-navy" : "border-ink/20"}`}>{on ? "✓" : ""}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        {error && <p role="alert" className="mt-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted">{trip.destination && trip.date ? `${city(trip.origin)} → ${city(trip.destination)}, around ${day(trip.date)}` : "We'll compare every combination for you."}</span>
          <button disabled={Boolean(busy)} className="rounded-full bg-brand px-7 py-3.5 font-semibold text-white shadow-[0_10px_24px_-10px_rgba(30,91,216,0.8)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60">
            {busy ?? "Generate a trip plan for me"}
          </button>
        </div>
      </form>

      {/* results */}
      <div ref={resultsRef} className="scroll-mt-6">
        {plan && (
          <div className="mt-12 space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/10 pb-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">Your plan</p>
                <h2 className="mt-1 font-display text-3xl font-bold md:text-4xl">{city(plan.trip.origin)} → {city(plan.trip.destination)}</h2>
              </div>
              {result?.audioUrl && <audio controls src={result.audioUrl} className="h-9" />}
            </div>
            {plan.notes?.length > 0 && (
              <ul className="rise space-y-1 rounded-2xl bg-mist/70 px-4 py-3 text-sm text-ink/80">
                {plan.notes.map((n: string) => <li key={n}>{n}</li>)}
              </ul>
            )}
            {/* order: how to get there, then the last mile, then when to book */}
            <div className="rise"><Itineraries card={plan} /></div>
            {pool && <div className="rise" style={{ animationDelay: "60ms" }}><CabTeaser card={pool} onFind={() => { location.hash = "#/cabmates"; }} /></div>}
            {fare && (
              <div className="rise" style={{ animationDelay: "120ms" }}>
                <FlightPriceCard card={fare} watch={watch} judge={Boolean(cfg?.judgeControls)}
                  onBook={() => { convId && api.track(convId, "book_cta_click", fare.variant); notify("This would hand off to the airline or an OTA to book (demo)."); }}
                  onWatch={async () => { if (!convId) return; try { setWatch(await api.watchFare(convId, fare.advice.currentFare)); notify("Watching this fare. We'll alert you here" + (waLinked ? " and on WhatsApp." : ".")); } catch (e) { notify(String(e)); } }}
                  onSimulateDrop={() => convId && api.simulateDrop(convId).then(() => api.getWatch(convId).then(setWatch))} />
              </div>
            )}
            {cfg?.whatsapp && !waLinked && (
              <form className="flex flex-wrap items-center gap-3 rounded-3xl border border-leaf/30 bg-leaf-soft/60 p-4 text-sm" onSubmit={(e) => { e.preventDefault(); convId && api.linkWhatsApp(convId, phone).then(() => { setWaLinked(true); notify("WhatsApp linked."); }).catch((er) => notify(String(er))); }}>
                <span className="font-semibold">📱 Also send alerts to WhatsApp</span>
                <input aria-label="WhatsApp number" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98xxx xxxxx" className="w-44 rounded-full border border-leaf/30 bg-white px-3 py-1.5" />
                <button className="rounded-full bg-leaf px-4 py-1.5 font-semibold text-white">Link</button>
                {cfg.sandbox.join && <span className="text-xs text-leaf">First send “{cfg.sandbox.join}” to {cfg.sandbox.number} (Twilio sandbox).</span>}
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
