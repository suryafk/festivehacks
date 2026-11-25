// Flagsmith wrapper. Every flag has a safe default so the app runs (and demos) even if Flagsmith is unreachable.
import { Flagsmith } from "flagsmith-nodejs";
import { config, has } from "../config.ts";
import { defaultFareModel, type FareModel } from "../engine/fares.ts";
import { defaultSplitWeights, type SplitWeights } from "../engine/pooling.ts";
import { trace } from "../bus.ts";

export interface WatcherConfig {
  batchSize: number;
  intervalMs: number;
}

export interface Flags {
  festive_rush_mode: boolean;
  pooling_enabled: boolean;
  voice_input_enabled: boolean;
  whatsapp_channel_enabled: boolean;
  judge_controls: boolean;
  degrade_gracefully: boolean;
  live_fares_enabled: boolean;
  book_nudge_copy: "urgent" | "savings";
  fare_model: FareModel;
  split_weights: SplitWeights;
  watcher_config: WatcherConfig;
  source: "flagsmith" | "defaults";
}

export const defaults: Omit<Flags, "source"> = {
  festive_rush_mode: true,
  pooling_enabled: true,
  voice_input_enabled: true,
  whatsapp_channel_enabled: true,
  judge_controls: true,
  degrade_gracefully: false,
  live_fares_enabled: true,
  book_nudge_copy: "urgent",
  fare_model: defaultFareModel,
  split_weights: defaultSplitWeights,
  watcher_config: { batchSize: 50, intervalMs: 3000 },
};

// Local overrides, so the /ops page can still demo the degrade path when no Flagsmith admin token is configured.
export const localOverrides: Partial<Flags> = {};

const client = has.flagsmith()
  ? new Flagsmith({ environmentKey: config.flagsmith.envKey, apiUrl: config.flagsmith.apiUrl, requestTimeoutSeconds: 3, enableAnalytics: true })
  : null;

const jsonOr = <T>(v: unknown, d: T): T => {
  if (v == null || v === "") return d;
  if (typeof v === "object") return { ...d, ...(v as object) };
  try {
    return { ...d, ...JSON.parse(String(v)) };
  } catch {
    return d;
  }
};

/**
 * Evaluate flags for an identity. Traits (city, channel) drive Flagsmith segments, e.g. pooling rolled out
 * only to `destination_hub in [LKO, PAT]`, and the A/B split on `book_nudge_copy` is per identity.
 */
export async function getFlags(identity?: string, traits: Record<string, string | number | boolean> = {}, convId: string | null = null): Promise<Flags> {
  let f: Flags = { ...defaults, source: "defaults" };
  if (client) {
    try {
      const fl = identity ? await client.getIdentityFlags(identity, traits) : await client.getEnvironmentFlags();
      const bool = (k: keyof Flags) => {
        try {
          return fl.isFeatureEnabled(k);
        } catch {
          return defaults[k as keyof typeof defaults] as boolean;
        }
      };
      const val = (k: string) => {
        try {
          return fl.getFeatureValue(k);
        } catch {
          return undefined;
        }
      };
      const copy = val("book_nudge_copy");
      f = {
        festive_rush_mode: bool("festive_rush_mode"),
        pooling_enabled: bool("pooling_enabled"),
        voice_input_enabled: bool("voice_input_enabled"),
        whatsapp_channel_enabled: bool("whatsapp_channel_enabled"),
        judge_controls: bool("judge_controls"),
        degrade_gracefully: bool("degrade_gracefully"),
        live_fares_enabled: bool("live_fares_enabled"),
        book_nudge_copy: copy === "savings" ? "savings" : "urgent",
        fare_model: jsonOr(val("fare_model"), defaults.fare_model),
        split_weights: jsonOr(val("split_weights"), defaults.split_weights),
        watcher_config: jsonOr(val("watcher_config"), defaults.watcher_config),
        source: "flagsmith",
      };
    } catch (e) {
      trace("flagsmith", convId, { error: String(e), fallback: "defaults" });
    }
  }
  f = { ...f, ...localOverrides };
  if (convId) {
    trace("flagsmith", convId, {
      identity: identity ?? "(environment)",
      traits,
      source: f.source,
      evaluated: {
        festive_rush_mode: f.festive_rush_mode,
        pooling_enabled: f.pooling_enabled,
        book_nudge_copy: f.book_nudge_copy,
        degrade_gracefully: f.degrade_gracefully,
        live_fares_enabled: f.live_fares_enabled,
      },
    });
  }
  return f;
}

/** Rush-mode derived knobs. */
export function rushKnobs(f: Flags) {
  const rush = f.festive_rush_mode;
  return {
    bufferMin: rush ? 120 : 75,
    poolWindowMin: rush ? Math.round(f.split_weights.windowMin * 1.5) : f.split_weights.windowMin,
  };
}
