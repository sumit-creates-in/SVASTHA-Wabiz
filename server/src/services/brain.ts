/**
 * One Mind.
 *
 * Wabiz has no AI of its own any more: no prompt, no knowledge base, no model, no API key, no
 * actions. It is a phone. It hands the conversation to One Mind (the svastha-brain service)
 * and sends back whatever One Mind answers. What the bot knows, how it speaks, which model it
 * runs, when it books a call or raises a support call-back — all of that is decided there,
 * and edited only in the CRM's Brain screen by the super admin.
 *
 * Needs BRAIN_URL and BRAIN_API_KEY. Without them the bot does not reply at all (it never
 * improvises), and /api/health says so.
 */
import { env } from "../config/env";

export interface BrainAction {
  name: string;
  ok: boolean;
  status?: string;
  error?: string;
  bookingId?: number;
  /** report_business_opportunity: the brand/agency proposal emailed to the owner */
  opportunityId?: number;
  slot?: { start: string; label: string };
  dueAt?: string;
}

export interface BrainReply {
  ok: boolean;
  reply: string;
  skip?: boolean;
  actions: BrainAction[];
  personType?: string;
  version?: string;
  error?: string;
  /** True when One Mind could not be reached at all and `reply` is the saved offline line. */
  offline?: boolean;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const DEFAULT_OFFLINE =
  "Sorry — we're having a small technical issue on our side. Please send your message again in a few minutes 🙏";

let offlineReply = DEFAULT_OFFLINE;
let version: string | null = null;
let lastError: string | null = null;
let lastOkAt: Date | null = null;

export const brainConfigured = (): boolean => Boolean(env.brain.url && env.brain.apiKey);

export const brainStatus = () => ({
  configured: brainConfigured(),
  version,
  channel: env.brain.channel,
  repliesFrom: "One Mind",
  lastOkAt,
  lastError,
});

const base = () => env.brain.url.replace(/\/$/, "");

/** Version shown on /api/health and in Settings, refreshed every few minutes. */
export async function startBrain(): Promise<void> {
  if (!brainConfigured()) {
    console.error("[brain] BRAIN_URL / BRAIN_API_KEY are not set — the bot cannot reply. Set them on this service.");
    return;
  }
  const ping = async () => {
    try {
      const r = await fetch(`${base()}/v1/health`, { signal: AbortSignal.timeout(10000) });
      const j = (await r.json()) as { publishedVersion?: string };
      if (j.publishedVersion && j.publishedVersion !== version) {
        version = j.publishedVersion;
        console.log(`[brain] One Mind is on version ${version}`);
      }
      lastError = null;
    } catch (err) {
      lastError = (err as Error).message;
    }
  };
  await ping();
  const timer = setInterval(ping, 5 * 60 * 1000);
  timer.unref?.();
}

/**
 * Ask One Mind for the reply. Tries three times; if it still cannot be reached, returns the
 * offline line One Mind gave us earlier — the only fixed text this app ever sends.
 */
export async function askBrain(body: {
  contact: { phone: string; name?: string; platform?: string };
  messages: ChatTurn[];
  context?: { referral?: { headline?: string; body?: string } };
  task?: "reply" | "followup";
}): Promise<BrainReply> {
  if (!brainConfigured()) {
    return { ok: false, reply: "", actions: [], error: "One Mind is not connected", offline: true };
  }
  let err = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`${base()}/v1/reply`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.brain.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, channel: env.brain.channel }),
        signal: AbortSignal.timeout(75000),
      });
      if (r.status === 401 || r.status === 403) throw new Error(`One Mind rejected this app's key (${r.status})`);
      const j = (await r.json()) as BrainReply & { offlineReply?: string };
      if (typeof j.reply !== "string") throw new Error(`unexpected answer (${r.status})`);
      if (j.offlineReply) offlineReply = j.offlineReply;
      if (j.version) version = j.version;
      lastOkAt = new Date();
      lastError = j.ok ? null : j.error || "One Mind reported a problem";
      return { ...j, actions: j.actions || [] };
    } catch (e) {
      err = (e as Error).message;
      if (attempt < 3) await new Promise((res) => setTimeout(res, 1500 * attempt));
    }
  }
  lastError = err;
  console.error(`[brain] One Mind unreachable after 3 tries: ${err}`);
  return {
    ok: false,
    offline: true,
    error: err,
    actions: [],
    skip: body.task === "followup",
    reply: body.task === "followup" ? "" : offlineReply,
  };
}
