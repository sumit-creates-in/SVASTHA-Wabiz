/**
 * The shared brain.
 *
 * Wabiz used to be the only place Svastha's prompt and knowledge base could be edited,
 * which is exactly why the three bots drifted apart. Now identity, voice, guardrails, the
 * programme catalogue, the FAQ and the qualification rules come from one published version
 * that BotPlus and the Instagram bot read too.
 *
 * What stays local: this number's own persona override, the WhatsApp policy guardrails in
 * compliance.ts, the actions, the follow-up logic and the inbox. Only the words are shared.
 *
 * Set BRAIN_URL and BRAIN_API_KEY to switch it on. With them blank nothing changes.
 */
import { env } from "../config/env";

export interface BrainBundle {
  version: string;
  compiledPrompt: string;
  knowledgeBase: string;
  provider: "openai" | "claude" | string;
  model: string;
  maxTokens: number;
  escalationKeywords: string[];
  escalationReply: string;
  channelConfig: {
    label: string;
    offerFocus: string;
    pricePolicy: "state" | "withhold";
    targetChars: number;
    humanHandoff: string;
    collectTestimonials: boolean;
  };
}

let bundle: BrainBundle | null = null;
let etag: string | null = null;
let lastError: string | null = null;

export const brainConfigured = (): boolean =>
  Boolean(env.brain.url && env.brain.apiKey);

export const getBrain = (): BrainBundle | null => bundle;

export const brainStatus = () => ({
  configured: brainConfigured(),
  version: bundle?.version ?? null,
  channel: bundle?.channelConfig?.label ?? null,
  lastError,
});

async function fetchOnce(): Promise<void> {
  const url =
    `${env.brain.url.replace(/\/$/, "")}/v1/brain` +
    `?channel=${encodeURIComponent(env.brain.channel)}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.brain.apiKey}`,
  };
  if (etag) headers["If-None-Match"] = etag;

  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (r.status === 304) return;
  if (!r.ok) throw new Error(`brain returned ${r.status}`);

  const body = (await r.json()) as BrainBundle;
  const changed = bundle?.version !== body.version;
  bundle = body;
  etag = r.headers.get("etag");
  lastError = null;
  if (changed)
    console.log(`[brain] version ${body.version} loaded (${env.brain.channel})`);
}

/**
 * Fetch on boot, then every five minutes.
 *
 * A failure never stops the service. If the brain has never been reached, buildSystemPrompt
 * falls back to the dashboard's own prompt and knowledge documents — an unanswered WhatsApp
 * message costs more than a stale one.
 */
export async function startBrain(): Promise<void> {
  if (!brainConfigured()) {
    console.log("[brain] BRAIN_URL not set — using the dashboard's own prompt");
    return;
  }
  try {
    await fetchOnce();
  } catch (err) {
    lastError = (err as Error).message;
    console.error(
      `[brain] unreachable at boot (${lastError}) — falling back to the dashboard prompt. ` +
        `Replies are still going out, but not from the published brain.`,
    );
  }
  const timer = setInterval(() => {
    fetchOnce().catch((err) => {
      lastError = (err as Error).message;
      console.warn(
        `[brain] refresh failed, keeping version ${bundle?.version ?? "none"}: ${lastError}`,
      );
    });
  }, 5 * 60 * 1000);
  timer.unref?.();
}

/**
 * Fill in the placeholders the brain leaves for the runtime.
 *
 * Function replacement, not string replacement — the knowledge base is owner-edited text
 * and a stray $& or $1 in it would otherwise be read as a substitution pattern.
 */
export function renderBrainPrompt(b: BrainBundle): string {
  const tz = "Asia/Kolkata";
  const now = new Date();
  const values: Record<string, string> = {
    KB: b.knowledgeBase,
    CUSTOMER_DATA:
      "null (their account details, if we have any, appear further down this prompt)",
    TODAY: `${now.toLocaleDateString("en-GB", { timeZone: tz, weekday: "long" })}, ${now.toLocaleDateString("en-CA", { timeZone: tz })}`,
    NOW_TIME: now.toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    BUSINESS_FROM: "10:00 am",
    BUSINESS_TO: "7:00 pm",
  };
  return b.compiledPrompt.replace(
    /\{(KB|CUSTOMER_DATA|TODAY|NOW_TIME|BUSINESS_FROM|BUSINESS_TO)\}/g,
    (_m, key: string) => values[key] ?? "",
  );
}
