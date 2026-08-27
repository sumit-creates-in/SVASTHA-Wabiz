/**
 * AI Actions — the bridge between a conversation and your systems.
 *
 * Each enabled action is exposed to the model as a callable tool. The model
 * decides when it applies, asks the customer for anything missing, then calls
 * it. We validate the arguments, POST them to your webhook, optionally create a
 * lead or ticket, and send the customer a confirmation.
 *
 * The model never sends the confirmation itself — we render it from a template
 * so the customer can't be told something happened when the webhook failed.
 */
import axios from "axios";
import crypto from "crypto";
import {
  ActionRun,
  AiAction,
  Contact,
  Conversation,
  IAiAction,
  IContact,
  IConversation,
  IWabaNumber,
  Lead,
  Ticket,
} from "../models";
import { emit } from "../realtime";

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

/** Actions available for this conversation, filtered by number and audience. */
export async function actionsFor(
  number: IWabaNumber,
  contact: IContact,
): Promise<IAiAction[]> {
  const all = await AiAction.find({ enabled: true });
  return all.filter((a) => {
    if (
      a.numbers.length &&
      !a.numbers.some((n) => String(n) === String(number._id))
    )
      return false;
    if (a.audience === "customer" && !contact.isCustomer) return false;
    if (a.audience === "lead" && contact.isCustomer) return false;
    return true;
  });
}

/** Convert an action into a tool definition the model can call. */
export function toToolSchema(action: IAiAction): ToolSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const f of action.fields) {
    const prop: Record<string, unknown> = {
      type:
        f.type === "number"
          ? "number"
          : f.type === "boolean"
            ? "boolean"
            : "string",
      description: f.description || f.label || f.key,
    };
    if (f.type === "enum" && f.options?.length) prop.enum = f.options;
    if (f.type === "date")
      prop.description = `${prop.description} (natural language is fine, e.g. "tomorrow 4pm")`;
    properties[f.key] = prop;
    if (f.required) required.push(f.key);
  }

  let description = action.description;
  if (action.triggerExamples.length) {
    description += `\n\nUse this when the customer says things like:\n${action.triggerExamples
      .map((e) => `- "${e}"`)
      .join("\n")}`;
  }
  description +=
    "\n\nAsk the customer for any required information you don't already have, one or two questions at a time. Only call this once you have everything.";

  return {
    name: action.name,
    description,
    input_schema: { type: "object", properties, required },
  };
}

/** OpenAI uses a slightly different envelope for the same thing. */
export function toOpenAiTool(action: IAiAction) {
  const s = toToolSchema(action);
  return {
    type: "function" as const,
    function: {
      name: s.name,
      description: s.description,
      parameters: {
        type: "object",
        properties: s.input_schema.properties,
        required: s.input_schema.required,
      },
    },
  };
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => vars[key] ?? "");
}

/**
 * Normalize date/time fields before sending to webhook.
 *
 * User can say anything — "kal 4 baje", "tomorrow 4pm", "Monday evening",
 * "27 Aug", "16:00" etc. We parse it into two clean, consistent strings
 * that Google Sheets (or any webhook receiver) can read directly:
 *
 *   preferred_day  → "27 August 2026"   (full unambiguous date)
 *   preferred_time → "4:00 PM"          (12-hour AM/PM, single string)
 *
 * Uses JS Date + locale formatting — no extra dependencies needed.
 * Falls back to the original value if we can't parse it cleanly.
 */
function normalizeDateTimeFields(
  input: Record<string, string>,
): Record<string, string> {
  const out = { ...input };
  const IST = "Asia/Kolkata";

  // ── preferred_day ──────────────────────────────────────────────────────
  if (out.preferred_day) {
    const raw = out.preferred_day.trim();
    const parsed = tryParseDate(raw);
    if (parsed) {
      // "27 August 2026"
      out.preferred_day = parsed.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: IST,
      });
    }
    // else keep original — better than sending garbage
  }

  // ── preferred_time ─────────────────────────────────────────────────────
  if (out.preferred_time) {
    const raw = out.preferred_time.trim();
    const parsed = tryParseTime(raw);
    if (parsed !== null) {
      // Build AM/PM string directly from h/m — no Date object, no timezone shift.
      const period = parsed.h >= 12 ? "PM" : "AM";
      const hour12 = parsed.h % 12 === 0 ? 12 : parsed.h % 12;
      const mins = parsed.m.toString().padStart(2, "0");
      out.preferred_time = `${hour12}:${mins} ${period}`;
    }
  }

  return out;
}

/** Try to extract a Date from a free-form date string. */
function tryParseDate(raw: string): Date | null {
  // 1. Direct parse (handles "2026-08-27", "Aug 27 2026", "27 Aug 2026" etc.)
  const direct = new Date(raw);
  if (!isNaN(direct.getTime())) return direct;

  const lower = raw.toLowerCase();
  const IST_OFFSET = 5.5 * 60; // minutes ahead of UTC
  const nowUTC = Date.now();
  const nowIST = new Date(nowUTC + IST_OFFSET * 60 * 1000);

  // 2. Relative words
  if (/\btoday\b|aaj/.test(lower)) return nowIST;
  if (/\btomorrow\b|kal\b|kal$/.test(lower)) {
    const t = new Date(nowIST);
    t.setDate(t.getDate() + 1);
    return t;
  }
  if (/\bday after tomorrow\b|parso/.test(lower)) {
    const t = new Date(nowIST);
    t.setDate(t.getDate() + 2);
    return t;
  }

  // 3. Weekday names → next occurrence
  const days = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  for (let i = 0; i < days.length; i++) {
    if (lower.includes(days[i])) {
      const t = new Date(nowIST);
      const diff = (i - t.getDay() + 7) % 7 || 7; // always future
      t.setDate(t.getDate() + diff);
      return t;
    }
  }

  // 4. Hindi day names
  const hindiDays: Record<string, number> = {
    somwar: 1,
    mangalwar: 2,
    budhwar: 3,
    guruwar: 4,
    shukrawar: 5,
    shaniwar: 6,
    raviwar: 0,
  };
  for (const [name, idx] of Object.entries(hindiDays)) {
    if (lower.includes(name)) {
      const t = new Date(nowIST);
      const diff = (idx - t.getDay() + 7) % 7 || 7;
      t.setDate(t.getDate() + diff);
      return t;
    }
  }

  return null;
}

/** Try to extract hours + minutes from a free-form time string. Returns null if unparseable. */
function tryParseTime(raw: string): { h: number; m: number } | null {
  const lower = raw.toLowerCase().replace(/\s+/g, " ").trim();

  // Named periods (English + Hindi)
  if (/\bmorning\b|subah|savere/.test(lower)) return { h: 10, m: 0 };
  if (/\bnoon\b|dopahar/.test(lower)) return { h: 12, m: 0 };
  if (/\bafternoon\b/.test(lower)) return { h: 14, m: 0 };
  if (/\bevening\b|sham|shaam/.test(lower)) return { h: 18, m: 0 };
  if (/\bnight\b|raat/.test(lower)) return { h: 20, m: 0 };

  // "4:30 pm", "4:30pm", "16:30", "4 pm", "4pm"
  const match = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return null;

  let h = parseInt(match[1], 10);
  const m = parseInt(match[2] || "0", 10);
  const period = match[3];

  if (period === "pm" && h < 12) h += 12;
  if (period === "am" && h === 12) h = 0;

  // Ambiguous bare numbers like "4" — assume PM if 1-6, AM if 7-11
  if (!period && h >= 1 && h <= 6) h += 12;

  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function ticketReference(): string {
  return `SVT-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

export interface ActionResult {
  ok: boolean;
  confirmation?: string;
  error?: string;
  ticketReference?: string;
}

/**
 * Execute an action the model asked for.
 * Returns the confirmation text to send, or an error the caller can escalate on.
 */
export async function runAction(
  action: IAiAction,
  args: Record<string, unknown>,
  ctx: { contact: IContact; conversation: IConversation; number: IWabaNumber },
): Promise<ActionResult> {
  const { contact, conversation, number } = ctx;

  await AiAction.updateOne(
    { _id: action._id },
    { $inc: { "stats.triggered": 1 } },
  );

  // Validate required fields — never fire a half-filled webhook.
  const input: Record<string, string> = {};
  for (const f of action.fields) {
    const raw = args[f.key];
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      if (f.required) {
        await AiAction.updateOne(
          { _id: action._id },
          { $inc: { "stats.failed": 1 } },
        );
        return {
          ok: false,
          error: `Missing required field: ${f.label || f.key}`,
        };
      }
      continue;
    }
    input[f.key] = String(raw).trim();
  }

  const ticketRef = action.createsTicket ? ticketReference() : undefined;

  // ── Normalize date/time fields before building the payload ──
  const normalizedInput = normalizeDateTimeFields(input);

  // Standard envelope — predictable shape for whatever receives it.
  const envelope = {
    event: action.name,
    action: action.displayName,
    firedAt: new Date().toISOString(),
    contact: {
      name: contact.name,
      phone: contact.waId,
      email: contact.email || null,
      isCustomer: contact.isCustomer,
      externalId: contact.externalId || null,
      tags: contact.tags,
    },
    channel: {
      number: number.displayPhoneNumber,
      numberLabel: number.label,
      conversationId: String(conversation._id),
    },
    data: normalizedInput,
    ...(ticketRef ? { ticketReference: ticketRef } : {}),
  };

  let payload: unknown = envelope;
  if (action.payloadTemplate?.trim()) {
    const vars: Record<string, string> = {
      ...normalizedInput,
      name: contact.name,
      phone: contact.waId,
      email: contact.email || "",
      externalId: contact.externalId || "",
      numberLabel: number.label,
      ticketReference: ticketRef || "",
    };
    try {
      payload = JSON.parse(renderTemplate(action.payloadTemplate, vars));
    } catch {
      payload = envelope; // bad template shouldn't lose the event
    }
  }

  const run = await ActionRun.create({
    action: action._id,
    actionName: action.name,
    contact: contact._id,
    conversation: conversation._id,
    number: number._id,
    input,
    payload,
    status: "pending",
  });

  // ── Fire the webhook, with one retry on transient failure ──
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  action.webhookHeaders?.forEach?.((v: string, k: string) => (headers[k] = v));
  if (action.webhookSecret) headers["x-svastha-secret"] = action.webhookSecret;

  let lastError = "";
  let responseStatus: number | undefined;
  let responseBody = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await axios.request({
        url: action.webhookUrl,
        method: action.webhookMethod || "POST",
        headers,
        data: payload,
        timeout: 15000,
        validateStatus: () => true,
      });
      responseStatus = res.status;
      responseBody =
        typeof res.data === "string"
          ? res.data.slice(0, 2000)
          : JSON.stringify(res.data).slice(0, 2000);
      if (res.status >= 200 && res.status < 300) {
        lastError = "";
        break;
      }
      lastError = `Webhook returned HTTP ${res.status}`;
    } catch (err: any) {
      lastError = err.message || "Webhook request failed";
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
  }

  await ActionRun.updateOne(
    { _id: run._id },
    {
      $set: {
        status: lastError ? "failed" : "succeeded",
        error: lastError || undefined,
        responseStatus,
        responseBody,
        attempts: lastError ? 2 : 1,
      },
    },
  );

  if (lastError) {
    await AiAction.updateOne(
      { _id: action._id },
      { $inc: { "stats.failed": 1 } },
    );
    console.error(`[actions] ${action.name} failed: ${lastError}`);
    return { ok: false, error: lastError };
  }

  await AiAction.updateOne(
    { _id: action._id },
    { $inc: { "stats.succeeded": 1 } },
  );

  // ── Side effects ──
  if (action.addTags.length) {
    await Contact.updateOne(
      { _id: contact._id },
      { $addToSet: { tags: { $each: action.addTags } } },
    );
  }
  if (action.addLabels.length) {
    conversation.labels = Array.from(
      new Set([...conversation.labels, ...action.addLabels]),
    );
  }

  if (action.createsLead) {
    // Dedup: same contact ke liye same action source pe pehle se lead hai to dobara mat banao
    const existingLead = await Lead.findOne({
      contact: contact._id,
      source: `ai:${action.name}`,
    });
    if (!existingLead) {
      await Lead.create({
        contact: contact._id,
        conversation: conversation._id,
        number: number._id,
        interest:
          normalizedInput.interest ||
          normalizedInput.programme ||
          normalizedInput.program ||
          action.displayName,
        source: `ai:${action.name}`,
        qualification: new Map(Object.entries(normalizedInput)),
        score: scoreLead(normalizedInput),
        status:
          normalizedInput.preferred_time || normalizedInput.preferred_day
            ? "call_booked"
            : "qualified",
      });
      emit("lead:new", { contact: String(contact._id) });
    } else {
      console.log(
        `[actions] ⚠️ lead already exists for contact ${contact._id} action "${action.name}" — skipping duplicate`,
      );
    }
  }

  if (action.createsTicket && ticketRef) {
    await Ticket.create({
      contact: contact._id,
      conversation: conversation._id,
      reference: ticketRef,
      subject: input.subject || input.issue || action.displayName,
      detail: input.detail || input.description || "",
      category: input.category || "general",
      priority: (["low", "normal", "high", "urgent"].includes(
        String(input.priority),
      )
        ? input.priority
        : "normal") as any,
      externalId: extractExternalId(responseBody),
    });
    emit("ticket:new", { contact: String(contact._id) });
  }

  if (action.handoffAfter) {
    // Do NOT disable AI — AI always keeps replying.
    // Just flag for the human team to follow up.
    conversation.status = "pending";
    conversation.labels = Array.from(
      new Set([...conversation.labels, "needs-human"]),
    );
  }
  await conversation.save();

  // Confirmation is rendered from your template, never invented by the model.
  const confirmation = renderTemplate(action.confirmationMessage, {
    ...input,
    name: contact.name || "there",
    ticketReference: ticketRef || "",
    reference: ticketRef || "",
  });

  return { ok: true, confirmation, ticketReference: ticketRef };
}

/** Crude but useful lead scoring — completeness plus buying signals. */
function scoreLead(input: Record<string, string>): number {
  let score = 30;
  const filled = Object.values(input).filter((v) => v && v.trim()).length;
  score += Math.min(30, filled * 8);
  const text = Object.values(input).join(" ").toLowerCase();
  if (/\b(today|tomorrow|asap|urgent|this week)\b/.test(text)) score += 20;
  if (input.budget || input.preferred_time || input.preferred_day) score += 20;
  return Math.min(100, score);
}

function extractExternalId(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body);
    return (
      parsed?.id ||
      parsed?.ticket_id ||
      parsed?.ticketId ||
      parsed?.reference ||
      undefined
    );
  } catch {
    return undefined;
  }
}

/** Re-run a failed action from the dashboard. */
export async function retryRun(runId: string): Promise<ActionResult> {
  const run = await ActionRun.findById(runId);
  if (!run) return { ok: false, error: "Run not found" };
  const action = await AiAction.findById(run.action);
  const contact = await Contact.findById(run.contact);
  const conversation = await Conversation.findById(run.conversation);
  const { WabaNumber } = await import("../models");
  const number = run.number ? await WabaNumber.findById(run.number) : null;
  if (!action || !contact || !conversation || !number) {
    return { ok: false, error: "Original context is no longer available" };
  }
  const args: Record<string, unknown> = {};
  run.input.forEach((v, k) => (args[k] = v));
  return runAction(action, args, { contact, conversation, number });
}
