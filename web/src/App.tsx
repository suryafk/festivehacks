import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, store, type Card, type Msg, type Mode, type Trace } from "./api";
import { AskModes, FareCard, PlanCard, PoolCard, PoolPreviewCard } from "./Cards";
import { TraceList } from "./Trace";
import Ops from "./Ops";

type Cfg = Awaited<ReturnType<typeof api.config>>;
const route = () => (location.hash.replace("#/", "") || "plan") as "plan" | "ops" | "how";

export default function App() {
  const [page, setPage] = useState(route());
  const [cfg, setCfg] = useState<Cfg | null>(null);
  useEffect(() => {
    const on = () => setPage(route());
    addEventListener("hashchange", on);
    api.config().then(setCfg).catch(() => {});
    return () => removeEventListener("hashchange", on);
  }, []);
  return (
    <div className="min-h-screen">
      <div className="toran" />
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <a href="#/plan" className="flex items-center gap-2">
          <span className="text-3xl">🪔</span>
          <div>
            <div className="text-xl font-bold leading-tight text-maroon-800">Marg Bandhu <span className="font-normal text-marigold-600">मार्ग बंधु</span></div>
            <div className="text-xs text-stone-500">Your festive-season travel companion: get home, door to door</div>
          </div>
        </a>
        <nav className="flex gap-1 rounded-xl bg-white p-1 text-sm shadow-sm ring-1 ring-stone-200">
          {(["plan", "ops", "how"] as const).map((p) => (
            <a key={p} href={`#/${p}`} className={`rounded-lg px-3 py-1.5 font-medium ${page === p ? "bg-maroon-700 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
              {p === "plan" ? "Plan a trip" : p === "ops" ? "Ops (NudgeBee)" : "How it works"}
            </a>
          ))}
        </nav>
      </header>
      {page === "plan" && <PlanPage cfg={cfg} />}
      {page === "ops" && <Ops />}
      {page === "how" && <How cfg={cfg} />}
      <footer className="mx-auto max-w-6xl px-4 py-6 text-xs text-stone-400">
        Built at Festive Hacks 2026 with Sarvam AI · Flagsmith · NudgeBee. Travel data is simulated. <a className="underline" href="https://github.com/suryafk/festivehacks">Source</a>
      </footer>
    </div>
  );
}

function useRecorder() {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const start = async (onDone: (b: Blob) => void) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearTimeout(timer.current);
      setRec(null);
      onDone(new Blob(chunks.current, { type: r.mimeType }));
    };
    r.start();
    setRec(r);
    timer.current = window.setTimeout(() => r.state === "recording" && r.stop(), 25_000); // Sarvam sync STT limit is 30 s
  };
  const stop = () => rec?.state === "recording" && rec.stop();
  return { recording: Boolean(rec), start, stop };
}

function PlanPage({ cfg }: { cfg: Cfg | null }) {
  const [convId, setConvId] = useState<string | null>(store.get("mb.conv"));
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [heard, setHeard] = useState<{ transcript: string; lang: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(true);
  const [phone, setPhone] = useState("");
  const [waLinked, setWaLinked] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const rec = useRecorder();

  const boot = useCallback(async (name?: string) => {
    const { id } = await api.create(name);
    store.set("mb.conv", id);
    setConvId(id);
    setTraces([]);
    return id;
  }, []);

  useEffect(() => {
    if (!convId) {
      boot();
      return;
    }
    api.get(convId).then((c) => { setMsgs(c.messages); setWaLinked(c.whatsapp); }).catch(() => boot());
    const es = new EventSource(`/api/conversations/${convId}/stream`);
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === "trace") setTraces((t) => (t.some((x) => x.ts === ev.ts && x.kind === ev.kind && JSON.stringify(x.data) === JSON.stringify(ev.data)) ? t : [...t.slice(-150), ev]));
      if (ev.type === "message") {
        setMsgs((m) => [...m, { role: ev.role, text: ev.text, ts: ev.ts, payload: ev.payload }]);
        if (ev.payload?.notify) notify(ev.text);
      }
    };
    return () => es.close();
  }, [convId, boot]);

  useEffect(() => { scroller.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [msgs, busy, heard]);

  const notify = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 9000);
    try {
      if ("Notification" in window && Notification.permission === "granted") new Notification("Marg Bandhu", { body: t, icon: "/favicon.ico" });
    } catch {}
  };

  const send = async (body: { text?: string; action?: unknown; wasVoice?: boolean; voiceLang?: string }, display?: string) => {
    if (!convId) return;
    if (display) setMsgs((m) => [...m, { role: "user", text: display, ts: Date.now(), payload: body.wasVoice ? { voice: true } : null }]);
    setBusy(body.wasVoice ? "Understanding your voice note…" : "Planning…");
    try {
      const r = await api.send(convId, body);
      setMsgs((m) => [...m, { role: "bot", text: r.text, ts: Date.now(), payload: { cards: r.cards, quickReplies: r.quickReplies, audioUrl: r.audioUrl } }]);
      if (r.audioUrl) {
        audio.current?.pause();
        audio.current = new Audio(r.audioUrl);
        audio.current.play().catch(() => {});
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: "system", text: `Something went wrong: ${String(e).slice(0, 120)}`, ts: Date.now() }]);
    } finally {
      setBusy(null);
    }
  };

  const submitText = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    send({ text: t }, t);
  };

  const onMic = async () => {
    if (rec.recording) return rec.stop();
    try {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
      await rec.start(async (blob) => {
        if (!convId) return;
        setBusy("Transcribing with Sarvam Saaras…");
        try {
          setHeard(await api.voice(convId, blob));
        } catch (e) {
          setMsgs((m) => [...m, { role: "system", text: `Couldn't transcribe (${String(e).slice(0, 80)}). Try typing instead.`, ts: Date.now() }]);
        } finally {
          setBusy(null);
        }
      });
    } catch {
      setMsgs((m) => [...m, { role: "system", text: "Microphone permission was blocked. You can type instead.", ts: Date.now() }]);
    }
  };

  const joinPool = (itineraryId?: string) => {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    send({ action: { type: "join_pool", itineraryId } }, "🚕 Find me a shared cab");
  };

  const latest = useMemo(() => {
    const find = (type: string) => [...msgs].reverse().flatMap((m) => m.payload?.cards ?? []).find((c) => c.type === type);
    const lastPlanIdx = msgs.map((m) => m.payload?.cards?.some((c) => c.type === "plan")).lastIndexOf(true);
    const afterPlan = (type: string) => msgs.slice(Math.max(0, lastPlanIdx)).reverse().flatMap((m) => m.payload?.cards ?? []).find((c) => c.type === type);
    return { plan: find("plan"), fare: afterPlan("fare"), preview: afterPlan("pool-preview"), pool: afterPlan("pool") };
  }, [msgs]);
  const lastBot = [...msgs].reverse().find((m) => m.role === "bot");
  const askModes = lastBot?.payload?.cards?.some((c) => c.type === "ask-modes");

  const tryAs = async () => {
    const id = await boot("Rohit");
    setMsgs([]);
    const c = await api.get(id);
    setMsgs(c.messages);
    setTimeout(() => {
      const t = "26 दिसंबर के आसपास बेंगलुरु से गोंडा जाना है, फ्लाइट ट्रेन कैब सब चलेगा";
      setMsgs((m) => [...m, { role: "user", text: t, ts: Date.now() }]);
      setBusy("Planning…");
      api.send(id, { text: t }).then((r) => setMsgs((m) => [...m, { role: "bot", text: r.text, ts: Date.now(), payload: { cards: r.cards, quickReplies: r.quickReplies } }])).finally(() => setBusy(null));
    }, 50);
  };

  return (
    <main className="mx-auto max-w-6xl px-4">
      {toast && (
        <div className="pop fixed right-4 top-4 z-50 max-w-sm rounded-2xl bg-emerald-600 p-4 text-sm text-white shadow-xl" role="status">
          <div className="font-semibold">🔔 Marg Bandhu</div>
          {toast}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-maroon-800 to-maroon-700 p-4 text-white">
        <div>
          <div className="text-lg font-semibold">Festive rush? Ghar pahunchna aasaan.</div>
          <div className="text-sm text-marigold-100">Type or speak in Hindi, English or your own language. Flight + train + shared cab, planned for you.</div>
        </div>
        <div className="flex gap-2">
          <button onClick={tryAs} className="rounded-lg bg-marigold-500 px-3 py-2 text-sm font-semibold text-maroon-900 hover:bg-marigold-300">▶ Try as Rohit (30 s demo)</button>
          <button onClick={() => { boot(); setMsgs([]); }} className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20">New trip</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* chat */}
        <section className="flex h-[70vh] min-h-[480px] flex-col rounded-2xl border border-stone-200 bg-white shadow-sm lg:col-span-2">
          <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto p-3">
            {msgs.map((m, i) => (
              <div key={i} className={`pop flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-[15px] leading-snug ${m.role === "user" ? "rounded-br-sm bg-maroon-700 text-white" : m.role === "system" ? "bg-red-50 text-red-700" : "rounded-bl-sm bg-marigold-50 text-stone-800 ring-1 ring-marigold-100"}`}>
                  {m.text}
                  {m.payload?.audioUrl && <audio className="mt-2 h-8 w-full" controls src={m.payload.audioUrl} />}
                </div>
              </div>
            ))}
            {busy && <div className="text-sm italic text-stone-500">{busy}</div>}
          </div>

          {askModes && !busy && <div className="px-3"><AskModes onPick={(modes: Mode[]) => send({ action: { type: "set_modes", modes } }, modes.join(" + "))} /></div>}
          {lastBot?.payload?.quickReplies?.length && !askModes && !busy ? (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2">
              {lastBot.payload.quickReplies.map((q) => (
                <button key={q} onClick={() => (q === "pool" ? joinPool() : q === "reset" ? send({ action: { type: "reset" } }, "New trip") : send({ text: q }, q))} className="rounded-full border border-marigold-300 bg-white px-3 py-1 text-sm hover:bg-marigold-50">
                  {q === "pool" ? "🚕 Find a shared cab" : q === "reset" ? "↺ New trip" : q}
                </button>
              ))}
            </div>
          ) : null}

          {heard ? (
            <div className="m-3 rounded-xl bg-indigo-50 p-3 ring-1 ring-indigo-200">
              <div className="mb-1 text-xs font-semibold text-indigo-800">🎙️ Did you mean? (Sarvam Saaras · {heard.lang}) Edit if needed.</div>
              <textarea className="w-full rounded-lg border border-indigo-200 bg-white p-2 text-[15px]" rows={2} value={heard.transcript} onChange={(e) => setHeard({ ...heard, transcript: e.target.value })} />
              <div className="mt-2 flex justify-end gap-2">
                <button onClick={() => setHeard(null)} className="rounded-lg px-3 py-1 text-sm text-stone-600">Discard</button>
                <button onClick={() => { const h = heard; setHeard(null); send({ text: h.transcript, wasVoice: true, voiceLang: h.lang }, `🎙️ ${h.transcript}`); }} className="rounded-lg bg-indigo-600 px-3 py-1 text-sm font-medium text-white">Yes, send ✓</button>
              </div>
            </div>
          ) : (
            <form onSubmit={submitText} className="flex items-center gap-2 border-t border-stone-100 p-3">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Bengaluru se Gorakhpur, 26 Dec ke aas-paas" className="min-w-0 flex-1 rounded-xl border border-stone-300 px-3 py-2 text-[15px] outline-none focus:border-marigold-500" />
              {cfg?.voiceInput !== false && (
                <button type="button" onClick={onMic} title={rec.recording ? "Stop recording" : "Speak (any Indian language)"} className={`h-10 w-10 shrink-0 rounded-full text-lg ${rec.recording ? "recording bg-red-600 text-white" : "bg-marigold-100 hover:bg-marigold-300"}`}>
                  {rec.recording ? "■" : "🎤"}
                </button>
              )}
              <button className="h-10 shrink-0 rounded-xl bg-maroon-700 px-4 font-medium text-white hover:bg-maroon-800">Send</button>
            </form>
          )}
        </section>

        {/* plan */}
        <section className="space-y-3 lg:col-span-3">
          {!latest.plan && (
            <div className="rounded-2xl border-2 border-dashed border-marigold-300 bg-white/60 p-8 text-center text-stone-500">
              Your door-to-door plan appears here: the best mix of flight, train and cab, when to book, and who you can share the last mile with.
            </div>
          )}
          {latest.pool && <PoolCard card={{ ...latest.pool, whatsapp: waLinked }} judge={Boolean(cfg?.judgeControls)} onSimulate={() => send({ action: { type: "simulate_rider" } })} />}
          {latest.preview && !latest.pool && <PoolPreviewCard card={latest.preview} onJoin={() => joinPool(latest.preview!.itineraryId)} disabled={Boolean(busy)} />}
          {latest.fare && <FareCard card={latest.fare} onTrack={(ev, v) => { convId && api.track(convId, ev, v); notify("Booking hand-off would open the airline/aggregator here (demo)."); }} />}
          {latest.plan && <PlanCard card={latest.plan as Card} />}
          {cfg?.whatsapp && latest.plan && !waLinked && (
            <form className="flex flex-wrap items-center gap-2 rounded-2xl border border-green-200 bg-green-50 p-3 text-sm" onSubmit={(e) => { e.preventDefault(); convId && api.linkWhatsApp(convId, phone).then(() => setWaLinked(true)).catch((er) => notify(String(er))); }}>
              <span>📱 Get pool alerts on WhatsApp:</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98xxxxxx" className="w-40 rounded-lg border border-green-300 px-2 py-1" />
              <button className="rounded-lg bg-green-600 px-3 py-1 font-medium text-white">Link</button>
              {cfg.sandbox.join && <span className="text-xs text-green-800">First send “{cfg.sandbox.join}” to {cfg.sandbox.number} on WhatsApp (Twilio sandbox).</span>}
            </form>
          )}
        </section>
      </div>

      {/* behind the scenes */}
      <section className="mt-4 rounded-2xl border border-stone-200 bg-white shadow-sm">
        <button onClick={() => setShowTrace(!showTrace)} className="flex w-full items-center justify-between p-3 text-left">
          <span className="font-semibold">🔍 Behind the scenes <span className="font-normal text-stone-500">: every Sarvam, Flagsmith, WhatsApp and pooling call for this conversation, live</span></span>
          <span className="flex items-center gap-2 text-xs">
            {cfg && Object.entries(cfg.sponsors).map(([k, v]) => (
              <span key={k} className={`rounded px-1.5 py-0.5 ${v ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"}`}>{k} {v ? "live" : "offline"}</span>
            ))}
            {showTrace ? "▲" : "▼"}
          </span>
        </button>
        {showTrace && <div className="max-h-72 overflow-y-auto border-t border-stone-100"><TraceList items={traces} /></div>}
      </section>
    </main>
  );
}

function How({ cfg }: { cfg: Cfg | null }) {
  const rows = [
    ["Sarvam AI", "Saaras v4 turns voice notes (web mic or WhatsApp) into text in 22 languages, including code-mixed Hinglish. Sarvam-105B extracts the trip as JSON. Bulbul speaks the plan back. Mayura translates replies for languages beyond Hindi and English."],
    ["Flagsmith", "festive_rush_mode (bigger connection buffers, wider pool windows), pooling_enabled (rolled out per destination hub via segments), book_nudge_copy (A/B test on the ‘book now’ message, measured by CTA taps), fare_model and split_weights (remote config), voice_input_enabled / whatsapp_channel_enabled / judge_controls (kill switches), degrade_gracefully (flipped by NudgeBee during a surge)."],
    ["NudgeBee", "Agent on the k3s cluster. When watcher pods get OOMKilled on a festive spike, a NudgeBee workflow runs RCA, waits for human approval, scales the watcher deployment, calls the Flagsmith API to turn on degrade_gracefully, and notifies Discord + this app's /ops timeline."],
    ["WhatsApp", "Same engine as the web app via Twilio. Voice notes are transcribed, the bot echoes what it heard, and replies with text + a Bulbul voice note. Pool matches are pushed to WhatsApp."],
  ];
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <h2 className="text-2xl font-bold text-maroon-800">One engine, two channels, three sponsors</h2>
      <pre className="overflow-x-auto rounded-2xl bg-ink p-4 text-xs leading-relaxed text-marigold-100">{`Web (text / 🎤)      WhatsApp (text / voice note)
        │                       │
        └──── channel adapters ─┘
                    │  voice → Sarvam Saaras → text (web: confirm/edit step)
                    ▼
        Conversation engine  ── Sarvam-105B intent JSON
        planner · fare advisor · pooling · fair split
                    │  flags ← Flagsmith
                    ▼
        reply renderer: cards (web) / text + voice note (WhatsApp)

watcher pods (k3s) ── lease pool requests → match → notify web + WhatsApp
NudgeBee agent ── OOMKilled? → RCA → approve → scale + Flagsmith degrade_gracefully`}</pre>
      <div className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-stone-200 bg-white p-4">
            <div className="font-semibold">{k} {cfg?.sponsors?.[k.toLowerCase().split(" ")[0]] === false && <span className="ml-1 text-xs font-normal text-stone-400">(not configured on this deployment)</span>}</div>
            <p className="mt-1 text-sm text-stone-700">{v}</p>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-700">
        <b>Fair split, explained.</b> The cab goes hub → first drop → next drop. Each stretch of road costs the same per km and is shared equally by whoever is still in the cab. So if Imran gets off at Gonda (125 km) and you continue to Gorakhpur (275 km), you share the first 125 km and pay the rest alone. A small detour allowance is added per extra stop.
      </div>
    </div>
  );
}
