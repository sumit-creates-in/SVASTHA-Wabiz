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
  if (buttonUrlParam)
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: buttonUrlParam }],
    });
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

/** Refresh stored health for one number. */
export async function syncNumberHealth(num: IWabaNumber): Promise<IWabaNumber> {
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
    num.lastSyncAt = new Date();
    num.lastSyncError = undefined;
  } catch (err: any) {
    num.lastSyncError = err?.response?.data?.error?.message || err.message;
    num.lastSyncAt = new Date();
  }
  await num.save();
  return num;
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
