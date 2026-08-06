import axios from "axios";
import { env } from "../config/env";

const GRAPH = "https://graph.facebook.com/v21.0";

function api() {
  return axios.create({
    baseURL: GRAPH,
    headers: { Authorization: `Bearer ${env.whatsapp.token}` }
  });
}

export interface SendResult {
  waMessageId?: string;
  error?: string;
}

async function send(payload: Record<string, unknown>): Promise<SendResult> {
  try {
    const { data } = await api().post(`/${env.whatsapp.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...payload
    });
    return { waMessageId: data?.messages?.[0]?.id };
  } catch (err: any) {
    const msg = err?.response?.data?.error?.message || err.message || "send failed";
    console.error("[whatsapp] send error:", msg);
    return { error: msg };
  }
}

export function sendText(to: string, body: string): Promise<SendResult> {
  return send({ to, type: "text", text: { body, preview_url: true } });
}

export function sendTemplate(
  to: string,
  name: string,
  language: string,
  bodyParams: string[] = []
): Promise<SendResult> {
  const components =
    bodyParams.length > 0
      ? [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) }]
      : [];
  return send({ to, type: "template", template: { name, language: { code: language }, components } });
}

export async function markRead(waMessageId: string): Promise<void> {
  try {
    await api().post(`/${env.whatsapp.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: waMessageId
    });
  } catch {
    /* non-fatal */
  }
}

export async function getMediaUrl(mediaId: string): Promise<string | undefined> {
  try {
    const { data } = await api().get(`/${mediaId}`);
    return data?.url;
  } catch {
    return undefined;
  }
}

/** Fetch approved message templates from Meta (WABA). */
export async function fetchTemplates(): Promise<any[]> {
  const { data } = await api().get(`/${env.whatsapp.businessAccountId}/message_templates`, {
    params: { limit: 100 }
  });
  return data?.data || [];
}

/** Create a new template on Meta for approval. */
export async function createTemplate(t: {
  name: string;
  language: string;
  category: string;
  bodyText: string;
}): Promise<any> {
  const { data } = await api().post(`/${env.whatsapp.businessAccountId}/message_templates`, {
    name: t.name,
    language: t.language,
    category: t.category,
    components: [{ type: "BODY", text: t.bodyText }]
  });
  return data;
}
