import {
  Contact,
  Conversation,
  Message,
  WabaNumber,
  IWabaNumber,
  getSettings,
} from "../models";
import * as wa from "./whatsapp";
import { generateReply } from "./ai";
import { emit } from "../realtime";
import {
  canSendFreeform,
  consumeAiQuota,
  isDuplicateOfLast,
  isOptIn,
  isOptOut,
  aiTemporarilyPaused,
  recordNumberSend,
} from "./compliance";

function withinBusinessHours(s: {
  start: string;
  end: string;
  timezone: string;
  enabled: boolean;
}): boolean {
  if (!s.enabled) return true;
  try {
    const now = new Date().toLocaleTimeString("en-GB", {
      hour12: false,
      timeZone: s.timezone,
      hour: "2-digit",
      minute: "2-digit",
    });
    return now >= s.start && now <= s.end;
  } catch {
    return true;
  }
}

function extract(msg: any): { type: string; text: string; mediaId?: string } {
  const type: string = msg.type || "text";
  if (type === "text") return { type, text: msg.text?.body || "" };
  if (type === "button") return { type, text: msg.button?.text || "" };
  if (type === "interactive")
    return {
      type,
      text:
        msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title ||
        "",
    };
  if (["image", "video", "audio", "document", "sticker"].includes(type))
    return {
      type,
      text: msg[type]?.caption || `[${type}]`,
      mediaId: msg[type]?.id,
    };
  if (type === "location")
    return {
      type,
      text: `[location] ${msg.location?.latitude},${msg.location?.longitude}`,
    };
  return { type, text: `[${type}]` };
}

/** Handle one inbound WhatsApp message, routed to the number that received it. */
export async function handleInboundMessage(
  msg: any,
  number: IWabaNumber,
  contactProfile?: any,
): Promise<void> {
  const waId: string = msg.from;
  const profileName: string = contactProfile?.profile?.name || "";

  if (msg.id && (await Message.exists({ waMessageId: msg.id }))) return; // Meta retries

  const contact = await Contact.findOneAndUpdate(
    { waId },
    {
      $set: {
        lastSeenAt: new Date(),
        ...(profileName ? { name: profileName } : {}),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const conversation = await Conversation.findOneAndUpdate(
    { contact: contact._id, number: number._id },
    { $setOnInsert: { aiEnabled: number.aiEnabled }, $set: { status: "open" } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const { type, text, mediaId } = extract(msg);

  const saved = await Message.create({
    conversation: conversation._id,
    contact: contact._id,
    number: number._id,
    direction: "in",
    author: "contact",
    type,
    text,
    mediaId,
    waMessageId: msg.id,
    status: "received",
  });

  conversation.unreadCount += 1;
  conversation.lastMessageAt = new Date();
  conversation.lastInboundAt = new Date(); // opens/refreshes the 24-hour window
  conversation.lastMessagePreview = text.slice(0, 120);
  await conversation.save();

  emit("message:new", {
    message: saved.toObject(),
    contact: contact.toObject(),
    conversation: conversation.toObject(),
  });
  if (msg.id) wa.markRead(number, msg.id).catch(() => {});

  const settings = await getSettings();

  // ── 1. Opt-out / opt-in is absolute and comes first ───
  if (type === "text" && isOptOut(text, settings)) {
    contact.optedOut = true;
    contact.optedOutAt = new Date();
    await contact.save();
    conversation.aiEnabled = false;
    conversation.botPaused = true;
    conversation.labels = Array.from(
      new Set([...conversation.labels, "opted-out"]),
    );
    await conversation.save();
    if (settings.optOutReply) {
      const r = await wa.sendText(number, waId, settings.optOutReply);
      await Message.create({
        conversation: conversation._id,
        contact: contact._id,
        number: number._id,
        direction: "out",
        author: "system",
        type: "text",
        text: settings.optOutReply,
        waMessageId: r.waMessageId,
        status: r.error ? "failed" : "sent",
        error: r.error,
      });
    }
    emit("conversation:update", conversation.toObject());
    return;
  }
  if (type === "text" && contact.optedOut && isOptIn(text)) {
    contact.optedOut = false;
    contact.optedOutAt = undefined;
    await contact.save();
    conversation.aiEnabled = true;
    conversation.botPaused = false;
    conversation.labels = conversation.labels.filter((l) => l !== "opted-out");
    await conversation.save();
    emit("conversation:update", conversation.toObject());
  }
  if (contact.optedOut) return;

  // ── 2. AI eligibility ─────────────────────────────────
  if (!settings.aiGlobalEnabled || !number.aiEnabled || !conversation.aiEnabled)
    return;
  if (aiTemporarilyPaused(conversation)) return;
  if (!["text", "button", "interactive"].includes(type)) return;

  // ── 3. Human handoff keywords ─────────────────────────
  const lower = text.toLowerCase();
  if (
    settings.handoffKeywords.some((k) => k && lower.includes(k.toLowerCase()))
  ) {
    conversation.aiEnabled = false;
    conversation.status = "pending";
    conversation.labels = Array.from(
      new Set([...conversation.labels, "needs-human"]),
    );
    await conversation.save();
    const ack = "Sure — a member of our team will reply to you here shortly.";
    const r = await wa.sendText(number, waId, ack);
    await Message.create({
      conversation: conversation._id,
      contact: contact._id,
      number: number._id,
      direction: "out",
      author: "system",
      type: "text",
      text: ack,
      waMessageId: r.waMessageId,
      status: r.error ? "failed" : "sent",
      error: r.error,
    });
    emit("conversation:update", conversation.toObject());
    emit("message:new", {
      message: { text: ack },
      conversation: conversation.toObject(),
    });
    return;
  }

  // ── 4. Policy gate: 24h window, opt-out, quality ──────
  const gate = canSendFreeform(conversation, contact, number, settings);
  if (!gate.allowed) {
    console.log(`[compliance] AI reply blocked: ${gate.reason}`);
    return;
  }

  // ── 5. Rate limit ─────────────────────────────────────
  const quota = await consumeAiQuota(conversation, settings);
  if (!quota.allowed) {
    console.log(`[compliance] ${quota.reason}`);
    return;
  }

  // ── 6. Off-hours notice (once, alongside the AI reply) ─
  if (
    !withinBusinessHours(settings.businessHours) &&
    settings.outsideHoursMessage
  ) {
    const dup = await isDuplicateOfLast(
      conversation._id,
      settings.outsideHoursMessage,
    );
    if (!dup) {
      const r = await wa.sendText(number, waId, settings.outsideHoursMessage);
      await Message.create({
        conversation: conversation._id,
        contact: contact._id,
        number: number._id,
        direction: "out",
        author: "system",
        type: "text",
        text: settings.outsideHoursMessage,
        waMessageId: r.waMessageId,
        status: r.error ? "failed" : "sent",
      });
    }
  }

  // ── 7. Generate and send ──────────────────────────────
  const replyText = await generateReply(conversation._id as any, number);
  if (!replyText) return;
  if (await isDuplicateOfLast(conversation._id, replyText)) {
    console.log("[compliance] suppressed duplicate AI reply");
    return;
  }

  const result = await wa.sendText(number, waId, replyText);
  const outMsg = await Message.create({
    conversation: conversation._id,
    contact: contact._id,
    number: number._id,
    direction: "out",
    author: "ai",
    type: "text",
    text: replyText,
    waMessageId: result.waMessageId,
    status: result.error ? "failed" : "sent",
    error: result.error,
  });
  if (!result.error) await recordNumberSend(number);
  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = replyText.slice(0, 120);
  await conversation.save();
  emit("message:new", {
    message: outMsg.toObject(),
    conversation: conversation.toObject(),
  });
}

/** Handle delivery status callbacks and fan them out to broadcasts/workflows. */
export async function handleStatusUpdate(status: any): Promise<void> {
  const waMessageId = status.id;
  const newStatus = status.status;
  if (!waMessageId || !newStatus) return;

  const errTitle = status.errors?.[0]?.title;
  const msg = await Message.findOneAndUpdate(
    { waMessageId },
    { $set: { status: newStatus, ...(errTitle ? { error: errTitle } : {}) } },
    { new: true },
  );
  if (msg)
    emit("message:status", {
      messageId: msg._id,
      waMessageId,
      status: newStatus,
    });

  const { BroadcastRecipient, Broadcast, WorkflowEvent, Workflow } =
    await import("../models");

  const rec = await BroadcastRecipient.findOne({ waMessageId });
  if (rec && rec.status !== newStatus) {
    const inc: Record<string, number> = {};
    if (newStatus === "delivered") inc["stats.delivered"] = 1;
    if (newStatus === "read") inc["stats.read"] = 1;
    if (newStatus === "failed") inc["stats.failed"] = 1;
    if (Object.keys(inc).length) {
      await Broadcast.updateOne({ _id: rec.broadcast }, { $inc: inc });
      await BroadcastRecipient.updateOne(
        { _id: rec._id },
        { $set: { status: newStatus } },
      );
    }
  }

  const evt = await WorkflowEvent.findOne({ waMessageId });
  if (evt && evt.status !== newStatus) {
    const inc: Record<string, number> = {};
    if (newStatus === "delivered") inc["stats.delivered"] = 1;
    if (newStatus === "read") inc["stats.read"] = 1;
    if (newStatus === "failed") inc["stats.failed"] = 1;
    if (Object.keys(inc).length) {
      await Workflow.updateOne({ _id: evt.workflow }, { $inc: inc });
      await WorkflowEvent.updateOne(
        { _id: evt._id },
        { $set: { status: newStatus } },
      );
      emit("workflow:update", { workflowId: evt.workflow });
    }
  }
}

/** Resolve which stored number a webhook payload belongs to. */
export async function resolveNumber(
  phoneNumberId: string,
): Promise<IWabaNumber | null> {
  return WabaNumber.findOne({ phoneNumberId });
}
