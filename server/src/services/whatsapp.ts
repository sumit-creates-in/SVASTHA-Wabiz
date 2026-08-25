import axios from "axios";
import { env } from "../config/env";
import { IWabaNumber, WabaNumber } from "../models";

const GRAPH = "https://graph.facebook.com/v21.0";

export interface NumberLike {
  phoneNumberId: string;
  businessAccountId: string;
  tokenOverride?: string;
}

function api(token?: string) {
  return axios.create({
    baseURL: GRAPH,
    headers: { Authorization: `Bearer ${token || env.whatsapp.token}` },
    timeout: 30000,
  });
}

export interface SendResult {
  waMessageId?: string;
  error?: string;
}

async function send(
  num: NumberLike,
  payload: Record<string, unknown>,
): Promise<SendResult> {
  try {
    const { data } = await api(num.tokenOverride).post(
      `/${num.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...payload,
      },
    );
    return { waMessageId: data?.messages?.[0]?.id };
  } catch (err: any) {
    const e = err?.response?.data?.error;
    const msg = e
      ? `${e.message}${e.error_data?.details ? ` — ${e.error_data.details}` : ""}`
      : err.message;
    console.error("[whatsapp] send error:", msg);
    return { error: msg || "send failed" };
  }
}

export function sendText(
  num: NumberLike,
  to: string,
  body: string,
): Promise<SendResult> {
  return send(num, { to, type: "text", text: { body, preview_url: true } });
}

export function sendTemplate(
  num: NumberLike,
  to: string,
  name: string,
  language: string,
  bodyParams: string[] = [],
  headerParams: string[] = [],
  buttonUrlParam?: string,
  category?: string,
): Promise<SendResult> {
  const components: Record<string, unknown>[] = [];
  if (headerParams.length)
    components.push({
      type: "header",
      parameters: headerParams.map((t) => ({ type: "text", text: t })),
    });
  if (bodyParams.length)
    components.push({
      type: "body",
      parameters: bodyParams.map((t) => ({ type: "text", text: t })),
    });

  // AUTHENTICATION templates (copy-code / OTP button) require the OTP code to
  // appear in BOTH the body component AND a button component (sub_type "url",
  // index 0). Sending only the body causes Meta error #132001.
  // Guard: only add the button if the OTP value is non-empty —
  // an empty text parameter causes Meta error #100.
  const otpCode = bodyParams[0] ?? "";
  if ((category || "").toUpperCase() === "AUTHENTICATION" && otpCode) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: otpCode }],
    });
  } else if (buttonUrlParam) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: buttonUrlParam }],
    });
  }

  return send(num, {
    to,
    type: "template",
    template: { name, language: { code: language }, components },
  });
}

export async function markRead(
  num: NumberLike,
  waMessageId: string,
): Promise<void> {
  try {
    await api(num.tokenOverride).post(`/${num.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: waMessageId,
    });
  } catch {
    /* non-fatal */
  }
}

export async function getMediaUrl(
  num: NumberLike,
  mediaId: string,
): Promise<string | undefined> {
  try {
    const { data } = await api(num.tokenOverride).get(`/${mediaId}`);
    return data?.url;
  } catch {
    return undefined;
  }
}

// ── Webhook subscriptions ───────────────────────────────
// A callback URL only says WHERE events go. An app must also be SUBSCRIBED to a
// WABA before Meta routes that WABA's events to it at all. Missing this step is
// the usual reason a verified webhook still receives nothing.

const appIdCache = new Map<string, string>();

/** Work out which Meta app a token belongs to (cached). */
export async function getAppId(token?: string): Promise<string | null> {
  const t = token || env.whatsapp.token;
  if (!t) return null;
  if (appIdCache.has(t)) return appIdCache.get(t)!;
  try {
    const { data } = await api(t).get("/debug_token", {
      params: { input_token: t },
    });
    const id = data?.data?.app_id ? String(data.data.app_id) : null;
    if (id) appIdCache.set(t, id);
    return id;
  } catch {
    return null;
  }
}

export interface SubscribedApp {
  id: string;
  name: string;
  link?: string;
}

/** Which apps currently receive this WABA's webhooks? */
export async function getSubscribedApps(
  businessAccountId: string,
  token?: string,
): Promise<SubscribedApp[]> {
  const { data } = await api(token).get(
    `/${businessAccountId}/subscribed_apps`,
  );
  return (data?.data || []).map((d: any) => ({
    id: String(d?.whatsapp_business_api_data?.id ?? ""),
    name: d?.whatsapp_business_api_data?.name ?? "Unknown app",
    link: d?.whatsapp_business_api_data?.link,
  }));
}

/** Subscribe the token's app to this WABA so webhooks start flowing. */
export async function subscribeApp(
  businessAccountId: string,
  token?: string,
): Promise<boolean> {
  const { data } = await api(token).post(
    `/${businessAccountId}/subscribed_apps`,
  );
  return !!data?.success;
}

/** Unsubscribe the token's own app from this WABA. */
export async function unsubscribeApp(
  businessAccountId: string,
  token?: string,
): Promise<boolean> {
  const { data } = await api(token).delete(
    `/${businessAccountId}/subscribed_apps`,
  );
  return !!data?.success;
}

/** Fetch approved message templates for a WABA. */
export async function fetchTemplates(
  businessAccountId: string,
  token?: string,
): Promise<any[]> {
  const { data } = await api(token).get(
    `/${businessAccountId}/message_templates`,
    {
      params: { limit: 200 },
    },
  );
  return data?.data || [];
}

export async function createTemplate(
  businessAccountId: string,
  t: { name: string; language: string; category: string; bodyText: string },
  token?: string,
): Promise<any> {
  const { data } = await api(token).post(
    `/${businessAccountId}/message_templates`,
    {
      name: t.name,
      language: t.language,
      category: t.category,
      components: [{ type: "BODY", text: t.bodyText }],
    },
  );
  return data;
}

/** Fetch all phone numbers registered under a WABA, with health fields. */
export async function fetchPhoneNumbers(
  businessAccountId: string,
  token?: string,
): Promise<any[]> {
  const { data } = await api(token).get(`/${businessAccountId}/phone_numbers`, {
    params: {
      fields:
        "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type,throughput,messaging_limit_tier,status",
      limit: 50,
    },
  });
  return data?.data || [];
}

/** Fetch health for a single phone number id. */
export async function fetchPhoneNumberHealth(
  phoneNumberId: string,
  token?: string,
): Promise<any> {
  const { data } = await api(token).get(`/${phoneNumberId}`, {
    params: {
      fields:
        "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type,throughput,messaging_limit_tier,status",
    },
  });
  return data;
}

/** Refresh stored health for one number, and record the quality trend. */
export async function syncNumberHealth(num: IWabaNumber): Promise<IWabaNumber> {
  const previousQuality = num.qualityRating;
  const previousLimit = num.messagingLimit;

  try {
    const d = await fetchPhoneNumberHealth(
      num.phoneNumberId,
      num.tokenOverride,
    );
    num.displayPhoneNumber = d.display_phone_number || num.displayPhoneNumber;
    num.verifiedName = d.verified_name || num.verifiedName;
    num.qualityRating = d.quality_rating || "UNKNOWN";
    num.messagingLimit = d.messaging_limit_tier || "UNKNOWN";
    num.nameStatus = d.name_status || "UNKNOWN";
    num.status =
      d.status ||
      (d.code_verification_status === "VERIFIED" ? "CONNECTED" : "PENDING");
    num.platformType = d.platform_type || "";
    num.throughputLevel = d.throughput?.level || "";

    // The phone-number node omits messaging_limit_tier unless the token carries
    // whatsapp_business_management. Fall back to the WABA listing, which often has it.
    if (num.messagingLimit === "UNKNOWN") {
      try {
        const list = await fetchPhoneNumbers(
          num.businessAccountId,
          num.tokenOverride,
        );
        const match = list.find((p: any) => String(p.id) === num.phoneNumberId);
        if (match?.messaging_limit_tier)
          num.messagingLimit = match.messaging_limit_tier;
        if (match?.quality_rating && num.qualityRating === "UNKNOWN")
          num.qualityRating = match.quality_rating;
      } catch {
        /* fallback is best-effort */
      }
    }

    num.lastSyncAt = new Date();
    num.lastSyncError =
      num.messagingLimit === "UNKNOWN"
        ? "Messaging limit unavailable — the access token likely lacks whatsapp_business_management"
        : undefined;
  } catch (err: any) {
    num.lastSyncError = err?.response?.data?.error?.message || err.message;
    num.lastSyncAt = new Date();
  }
  await num.save();

  await recordQuality(num, previousQuality, previousLimit);
  return num;
}

/** Store a quality snapshot and raise an alert when it degrades. */
async function recordQuality(
  num: IWabaNumber,
  previousQuality: string,
  previousLimit: string,
): Promise<void> {
  const { QualitySnapshot, Alert, getSettings } = await import("../models");
  const rank: Record<string, number> = {
    GREEN: 3,
    YELLOW: 2,
    RED: 1,
    UNKNOWN: 0,
  };
  const changed =
    previousQuality !== num.qualityRating ||
    previousLimit !== num.messagingLimit;

  try {
    await QualitySnapshot.create({
      number: num._id,
      qualityRating: num.qualityRating,
      messagingLimit: num.messagingLimit,
      status: num.status,
      changed,
    });
  } catch {
    /* non-fatal */
  }

  if (
    !changed ||
    previousQuality === "UNKNOWN" ||
    num.qualityRating === "UNKNOWN"
  )
    return;

  const degraded =
    (rank[num.qualityRating] ?? 0) < (rank[previousQuality] ?? 0);
  if (!degraded) {
    if ((rank[num.qualityRating] ?? 0) > (rank[previousQuality] ?? 0)) {
      await Alert.create({
        level: "info",
        title: `Quality recovered on ${num.displayPhoneNumber || num.label}`,
        detail: `Quality rating went from ${previousQuality} to ${num.qualityRating}.`,
        number: num._id,
      });
    }
    return;
  }

  const settings = await getSettings();
  const critical = num.qualityRating === "RED";

  await Alert.create({
    level: critical ? "critical" : "warning",
    title: `Quality dropped to ${num.qualityRating} on ${num.displayPhoneNumber || num.label}`,
    detail:
      `Rating fell from ${previousQuality} to ${num.qualityRating}. This is driven by customers blocking or ` +
      `reporting the number. Review what was sent in the last 24-48 hours — usually a broadcast that went to ` +
      `people who didn't expect it.` +
      (settings.autoPauseMarketingOnDegrade
        ? " Marketing sends have been paused automatically."
        : ""),
    number: num._id,
  });

  // Circuit breaker: stop non-essential outbound before Meta cuts the tier.
  if (settings.autoPauseMarketingOnDegrade && critical) {
    const { Broadcast } = await import("../models");
    await Broadcast.updateMany(
      { status: { $in: ["running", "scheduled"] } },
      { $set: { status: "cancelled" } },
    );
    console.warn(
      `[quality] ${num.displayPhoneNumber} went RED — running broadcasts cancelled`,
    );
  }
}

/** Sync every enabled number. Runs on boot and every 30 minutes. */
export async function syncAllNumbers(): Promise<void> {
  const numbers = await WabaNumber.find();
  for (const n of numbers) await syncNumberHealth(n);
}

export function startHealthSync(): void {
  setTimeout(() => syncAllNumbers().catch(() => {}), 10000);
  setInterval(() => syncAllNumbers().catch(() => {}), 30 * 60 * 1000);
}
