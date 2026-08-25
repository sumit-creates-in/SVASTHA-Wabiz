/**
 * Webhook workflows: an external system (course signup, payment, booking) POSTs an
 * event to /api/hooks/:key and we send an approved WhatsApp template to that customer.
 */
import crypto from "crypto";
import {
  Contact,
  Conversation,
  IWorkflow,
  Message,
  Template,
  WabaNumber,
  Workflow,
  WorkflowEvent,
  getSettings
} from "../models";
import * as wa from "./whatsapp";
import { canSendTemplate, recordMarketingSend, recordNumberSend } from "./compliance";
import { emit } from "../realtime";

export function newKey(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${slug || "hook"}-${crypto.randomBytes(3).toString("hex")}`;
}
export function newSecret(): string {
  return crypto.randomBytes(24).toString("hex");
}

/** Read a dot-path from an object: "customer.phone" → payload.customer.phone */
function readPath(obj: any, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

/** Resolve "Hi {{name}}, {{course.title}}" against the payload. */
function renderParam(tpl: string, payload: any): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path) => {
    const v = readPath(payload, path);
    return v === undefined || v === null ? "" : String(v);
  });
}

function normalizePhone(raw: unknown): string {
  return String(raw ?? "").replace(/[^0-9]/g, "");
}

export interface FireResult {
  ok: boolean;
  status: "sent" | "failed" | "skipped";
  reason?: string;
  waMessageId?: string;
}

/** Process one incoming workflow event. */
export async function fireWorkflow(workflow: IWorkflow, payload: any): Promise<FireResult> {
  await Workflow.updateOne({ _id: workflow._id }, { $inc: { "stats.targeted": 1 } });

  const waId = normalizePhone(readPath(payload, workflow.phoneField));
  const name = String(readPath(payload, workflow.nameField) ?? "");

  const event = await WorkflowEvent.create({
    workflow: workflow._id,
    waId,
    payload,
    status: "received"
  });

  const finish = async (status: FireResult["status"], reason?: string, waMessageId?: string) => {
    await WorkflowEvent.updateOne(
      { _id: event._id },
      { $set: { status, error: reason, waMessageId } }
    );
    const incKey = status === "sent" ? "stats.sent" : status === "failed" ? "stats.failed" : "stats.skipped";
    await Workflow.updateOne(
      { _id: workflow._id },
      { $inc: { "stats.processed": 1, [incKey]: 1 }, $set: { lastFiredAt: new Date(), lastError: reason } }
    );
    emit("workflow:update", { workflowId: workflow._id });
    return { ok: status === "sent", status, reason, waMessageId };
  };

  if (!workflow.enabled) return finish("skipped", "Workflow disabled");
  if (!waId || waId.length < 8) return finish("failed", `No valid phone at field "${workflow.phoneField}"`);

  const number = await WabaNumber.findById(workflow.number);
  if (!number) return finish("failed", "Sending number not found");

  const contact = await Contact.findOneAndUpdate(
    { waId },
    {
      $set: { ...(name ? { name } : {}), optInSource: contactSource(workflow) },
      $addToSet: { tags: { $each: workflow.addTags } }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // dedupe
  if (workflow.dedupe !== "none") {
    const since =
      workflow.dedupe === "once_per_day" ? new Date(Date.now() - 24 * 3600 * 1000) : new Date(0);
    const prior = await WorkflowEvent.findOne({
      workflow: workflow._id,
      waId,
      status: { $in: ["sent", "delivered", "read"] },
      createdAt: { $gte: since },
      _id: { $ne: event._id }
    }).lean();
    if (prior) return finish("skipped", "Already sent to this contact (dedupe)");
  }

  // policy gate
  const settings = await getSettings();
  const tpl = await Template.findOne({ name: workflow.templateName }).lean();
  const category = (tpl?.category || "").toUpperCase() === "MARKETING" ? "marketing" : "utility";
  const gate = canSendTemplate(contact, number, settings, category as "marketing" | "utility");
  if (!gate.allowed) return finish("skipped", gate.reason);

  const headerParams = workflow.headerParams.map((p) => renderParam(p, { ...payload, name }));
  const bodyParams = workflow.bodyParams.map((p) => renderParam(p, { ...payload, name }));
  const buttonParam = workflow.buttonUrlParam
    ? renderParam(workflow.buttonUrlParam, payload)
    : undefined;

  const result = await wa.sendTemplate(
    number,
    waId,
    workflow.templateName,
    workflow.templateLanguage,
    bodyParams,
    headerParams,
    buttonParam
  );
  if (result.error) return finish("failed", result.error);

  await recordNumberSend(number);
  if (category === "marketing") await recordMarketingSend(contact);

  // log into the chat thread so agents see it in the inbox
  const conversation = await Conversation.findOneAndUpdate(
    { contact: contact._id, number: number._id },
    {
      $setOnInsert: { aiEnabled: number.aiEnabled },
      $set: { lastMessageAt: new Date(), lastMessagePreview: `[template] ${workflow.templateName}` },
      $addToSet: { labels: { $each: workflow.addLabels } }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await Message.create({
    conversation: conversation._id,
    contact: contact._id,
    number: number._id,
    direction: "out",
    author: "workflow",
    type: "template",
    text: renderTemplatePreview(tpl?.bodyText || workflow.templateName, bodyParams),
    waMessageId: result.waMessageId,
    status: "sent"
  });
  emit("conversation:update", conversation.toObject());

  if (!workflow.verified) await Workflow.updateOne({ _id: workflow._id }, { $set: { verified: true } });

  return finish("sent", undefined, result.waMessageId);
}

function contactSource(w: IWorkflow): string {
  return `workflow:${w.key}`;
}

/** Fill {{1}}, {{2}} in a template body for the inbox preview. */
function renderTemplatePreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, i) => params[Number(i) - 1] ?? `{{${i}}}`);
}

/** Queue an event for later delivery (workflow.delayMinutes > 0). */
export async function queueWorkflow(workflow: IWorkflow, payload: any): Promise<void> {
  await WorkflowEvent.create({
    workflow: workflow._id,
    waId: normalizePhone(readPath(payload, workflow.phoneField)),
    payload,
    status: "received",
    runAt: new Date(Date.now() + workflow.delayMinutes * 60000)
  });
  await Workflow.updateOne({ _id: workflow._id }, { $inc: { "stats.targeted": 1 } });
}

/** Run delayed workflow events whose time has come. */
export function startWorkflowScheduler(): void {
  setInterval(async () => {
    try {
      const due = await WorkflowEvent.find({
        status: "received",
        runAt: { $ne: null, $lte: new Date() }
      }).limit(50);
      for (const e of due) {
        const w = await Workflow.findById(e.workflow);
        if (!w) continue;
        await WorkflowEvent.deleteOne({ _id: e._id });
        await fireWorkflow(w, e.payload);
      }
    } catch (err: any) {
      console.error("[workflows] scheduler error:", err.message);
    }
  }, 30000);
}
