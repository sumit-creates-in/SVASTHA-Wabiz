/**
 * The shared brain.
 *
 * Wabiz used to be the only place Svastha's prompt and knowledge base could be edited,
 * which is exactly why the three bots drifted apart. Now identity, voice, guardrails, the
 * programme catalogue, the FAQ and the qualification rules come from one published version
 * that BotPlus and the Instagram bot read too.
 *
 * Since the two-action brain (book_sales_call / book_support_call), the brain also DOES the
 * actions: it offers real free call slots, books them into Google Calendar, puts the lead in
 * the CRM and notifies the automator. Wabiz just forwards the model's tool call — see
 * callBrainAction(). Nobody reads these chats, so that call is the only way a human helps.
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
  /** True when the brain executes the actions itself (two-action catalogue). */
  gatewayActions?: boolean;
  /** Native OpenAI tool schemas for this channel. */
  tools?: unknown[] | null;
  channelConfig: {
    label: string;
    offerFocus: string;
    pricePolicy: "state" | "withhold";
    targetChars: number;
    humanHandoff: string;
    collectTestimonials: boolean;
  };
}

/** What the brain answers when asked to book something. */
export interface BrainActionResult {
  ok: boolean;
  status?: string;
  error?: string;
  bookingId?: number;
  slot?: { start: string; label: string };
  dueAt?: string;
  messageForModel: string;
}

let bundle: BrainBundle | null = null;
let etag: string | null = null;
let lastError: string | null = null;

export const brainConfigured = (): boolean =>
  Boolean(env.brain.url && env.brain.apiKey);

export const getBrain = (): BrainBundle | null => bundle;

/** The brain books calls itself — use its tools and forward every tool call to it. */
export const brainDoesActions = (): boolean =>
  Boolean(bundle?.gatewayActions && Array.isArray(bundle.tools) && bundle.tools.length);

export const brainStatus = () => ({
  configured: brainConfigured(),
  version: bundle?.version ?? null,
  channel: bundle?.channelConfig?.label ?? null,
  actionsViaBrain: brainDoesActions(),
  lastError,
});

const base = () => env.brain.url.replace(/\/$/, "");
const auth = () => ({ Authorization: `Bearer ${env.brain.apiKey}` });

async function fetchOnce(): Promise<void> {
  // features=slots: we fill {SLOTS} ourselves from /v1/slots, with live calendar times.
  const url =
    `${base()}/v1/brain?channel=${encodeURIComponent(env.brain.channel)}&features=slots`;
  const headers: Record<string, string> = auth();
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
    console.log(
      `[brain] version ${body.version} loaded (${env.brain.channel})${body.gatewayActions ? " — actions run by the brain" : ""}`,
    );
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

// ── live data for the prompt ────────────────────────────

let slotsCache: { at: number; text: string } | null = null;

/** The free call slots, as text for {SLOTS}. Cached a minute; never throws. */
export async function brainSlotsText(): Promise<string> {
  if (slotsCache && Date.now() - slotsCache.at < 60_000) return slotsCache.text;
  try {
    const r = await fetch(`${base()}/v1/slots`, { headers: auth(), signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`slots ${r.status}`);
    const j = (await r.json()) as { promptText?: string };
    slotsCache = { at: Date.now(), text: j.promptText || "" };
    return slotsCache.text;
  } catch (err) {
    console.warn(`[brain] could not load call slots: ${(err as Error).message}`);
    return "(Live slots are unavailable right now. Ask for their preferred day and a time between 10:00 and 19:00 IST; the booking system will confirm or offer the nearest free time.)";
  }
}

/** Member or lead, from the Svastha app via the brain. Null when unknown. */
export async function brainCustomer(phone: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${base()}/v1/customer?phone=${encodeURIComponent(phone)}`, {
      headers: auth(),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { found?: boolean; data?: Record<string, unknown> };
    return j.found && j.data ? j.data : null;
  } catch {
    return null;
  }
}

/**
 * Ask the brain to perform an action. Never throws: if the brain cannot be reached the
 * model is told plainly that nothing was booked, so it never claims otherwise.
 */
export async function callBrainAction(
  name: string,
  body: {
    args: Record<string, unknown>;
    contact: { phone: string; name?: string };
    conversation: { summary: string; lastMessage: string };
    personType?: string;
  },
): Promise<BrainActionResult> {
  try {
    const r = await fetch(`${base()}/v1/actions/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, channel: env.brain.channel }),
      signal: AbortSignal.timeout(45000),
    });
    const j = (await r.json().catch(() => null)) as BrainActionResult | null;
    if (!j || typeof j.messageForModel !== "string") throw new Error(`brain answered ${r.status}`);
    return j;
  } catch (err) {
    console.error(`[brain] action ${name} failed to reach the brain: ${(err as Error).message}`);
    return {
      ok: false,
      error: "unavailable",
      messageForModel:
        "NOT BOOKED — the booking system did not answer. Apologise briefly and ask them to send their request again in a few minutes. Do not say anything is booked or raised.",
    };
  }
}

/**
 * Fill in the placeholders the brain leaves for the runtime.
 *
 * Function replacement, not string replacement — the knowledge base is owner-edited text
 * and a stray $& or $1 in it would otherwise be read as a substitution pattern.
 */
export function renderBrainPrompt(
  b: BrainBundle,
  live: { slots?: string; customerData?: string } = {},
): string {
  const tz = "Asia/Kolkata";
  const now = new Date();
  const values: Record<string, string> = {
    KB: b.knowledgeBase,
    CUSTOMER_DATA:
      live.customerData ??
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
    SLOTS: live.slots ?? "",
  };
  return b.compiledPrompt.replace(
    /\{(KB|CUSTOMER_DATA|TODAY|NOW_TIME|BUSINESS_FROM|BUSINESS_TO|SLOTS)\}/g,
    (_m, key: string) => values[key] ?? "",
  );
}

/** Does this message contain one of the brain's always-escalate words? */
export function matchEscalationKeyword(text: string): string | null {
  const kws = bundle?.escalationKeywords || [];
  const lower = text.toLowerCase();
  for (const k of kws) {
    const kw = String(k || "").toLowerCase().trim();
    if (!kw) continue;
    const re = new RegExp(`(^|[^a-z])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);
    if (re.test(lower)) return kw;
  }
  return null;
}
