import type { Trace } from "./api";

const META: Record<string, { label: string; color: string }> = {
  sarvam: { label: "Sarvam AI", color: "bg-indigo-100 text-indigo-800" },
  flagsmith: { label: "Flagsmith", color: "bg-sky-100 text-sky-800" },
  nudgebee: { label: "NudgeBee", color: "bg-amber-100 text-amber-900" },
  twilio: { label: "WhatsApp", color: "bg-green-100 text-green-800" },
  engine: { label: "Engine", color: "bg-stone-100 text-stone-700" },
  pool: { label: "Pooling", color: "bg-emerald-100 text-emerald-800" },
  watcher: { label: "Watcher", color: "bg-purple-100 text-purple-800" },
  surge: { label: "Surge", color: "bg-red-100 text-red-800" },
};

function summary(t: Trace): string {
  const d = t.data;
  if (d.error) return `⚠ ${String(d.error).slice(0, 140)}`;
  switch (t.kind) {
    case "sarvam":
      if (d.api === "speech-to-text") return `Saaras ${d.model}: “${d.transcript}” (${d.detectedLang}, ${d.ms} ms)`;
      if (d.api === "text-to-speech") return `Bulbul ${d.model}: voice reply in ${d.lang} (${d.ms} ms)`;
      if (d.api === "translate") return `Mayura: translated reply to ${d.target} (${d.ms} ms)`;
      return `${d.model}: ${d.purpose} (${d.ms} ms)${d.output ? " → " + JSON.stringify(d.output).slice(0, 120) : ""}`;
    case "flagsmith":
      if (d.experiment) return `A/B ${d.experiment}: ${d.event} on variant “${d.variant}”`;
      if (d.evaluated) return `${d.source === "flagsmith" ? "Evaluated" : "Defaults (offline)"} for ${d.identity}: ` + Object.entries(d.evaluated).map(([k, v]) => `${k}=${v}`).join(", ");
      return JSON.stringify(d).slice(0, 160);
    case "engine":
      if (d.step === "intent") return `Intent via ${d.via}`;
      if (d.step === "plan") return `Planned ${d.options} options, ${d.bufferMin} min connection buffer`;
      if (d.step === "fare advice") return `Fare advice: ${d.verdict} at ₹${d.currentFare} (copy variant ${d.abVariant})`;
      if (d.step === "reply") return `Reply → stage ${d.stage}${d.wasVoice ? " (voice)" : ""}`;
      return JSON.stringify(d).slice(0, 160);
    case "pool":
      return d.event === "pool matched" ? `Matched by ${d.by}: ${d.members?.join(", ")} · ₹${d.totalFare}` : `${d.event}${d.name ? ": " + d.name : ""}`;
    case "twilio":
      return d.skipped ? `WhatsApp not configured; would send “${d.body}”` : d.inbound ? `Inbound from ${d.from}` : `Sent to ${d.to} (${d.status})`;
    default:
      return String(d.summary ?? d.event ?? d.action ?? JSON.stringify(d)).slice(0, 180);
  }
}

export function TraceList({ items, compact }: { items: Trace[]; compact?: boolean }) {
  if (!items.length) return <p className="p-3 text-sm text-stone-500">Nothing yet. Send a message and watch each sponsor tool fire.</p>;
  return (
    <ul className="divide-y divide-stone-100">
      {[...items].reverse().map((t, i) => {
        const m = META[t.kind] ?? { label: t.kind, color: "bg-stone-100" };
        return (
          <li key={`${t.ts}-${i}`} className={`flex gap-2 ${compact ? "px-2 py-1.5" : "p-2"} text-xs`}>
            <span className="shrink-0 tabular-nums text-stone-400">{new Date(t.ts).toLocaleTimeString("en-IN", { hour12: false })}</span>
            <span className={`h-fit shrink-0 rounded px-1.5 py-0.5 font-semibold ${m.color}`}>{m.label}</span>
            <span className="break-words text-stone-700">{summary(t)}</span>
          </li>
        );
      })}
    </ul>
  );
}
