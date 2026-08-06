import { Contact, Conversation, Message, getSettings } from "../models";
import * as wa from "./whatsapp";
import { generateReply } from "./ai";
import { emit } from "../realtime";

function withinBusinessHours(s: { start: string; end: string; timezone: string; enabled: boolean }): boolean {
  if (!s.enabled) return true;
  try {
    const now = new Date().toLocaleTimeString("en-GB", {
      hour12: false,
      timeZone: s.timezone,
      hour: "2-digit",
      minute: "2-digit"
    });
    return now >= s.start && now <= s.end;
  } catch {
    return true;
  }
}

/** Handle one inbound WhatsApp message object from the webhook. */
export async function handleInboundMessage(msg: any, contactProfile?: any): Promise<void> {
  const waId: string = msg.from;
  const profileName: string = contactProfile?.profile?.name || "";

  // upsert contact
  const contact = await Contact.findOneAndUpdate(
    { waId },
    { $set: { lastSeenAt: new Date(), ...(profileName ? { name: profileName } : {}) } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // upsert conversation
  const conversation = await Conversation.findOneAndUpdate(
    { contact: contact._id },
    { $setOnInsert: { aiEnabled: true }, $set: { status: "open" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // extract text / type
  const type: string = msg.type || "text";
  let text = "";
  let mediaId: string | undefined;
  if (type === "text") text = msg.text?.body || "";
  else if (type === "button") text = msg.button?.text || "";
  else if (type === "interactive")
    text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
  else if (["image", "video", "audio", "document", "sticker"].includes(type)) {
    mediaId = msg[type]?.id;
    text = msg[type]?.caption || `[${type}]`;
  } else if (type === "location") {
    text = `[location] ${msg.location?.latitude},${msg.location?.longitude}`;
  } else text = `[${type}]`;

  // dedupe (Meta retries webhooks)
  if (msg.id && (await Message.exists({ waMessageId: msg.id }))) return;

  const saved = await Message.create({
    conversation: conversation._id,
    contact: contact._id,
    direction: "in",
    author: "contact",
    type,
    text,
    mediaId,
    waMessageId: msg.id,
    status: "received"
  });

  conversation.unreadCount += 1;
  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = text.slice(0, 120);
  await conversation.save();

  emit("message:new", { message: saved.toObject(), contact: contact.toObject(), conversation: conversation.toObject() });
  if (msg.id) wa.markRead(msg.id).catch(() => {});

  // ── AI auto-reply pipeline ────────────────────────────
  const settings = await getSettings();
  if (!settings.aiGlobalEnabled || !conversation.aiEnabled) return;
  if (type !== "text" && type !== "button" && type !== "interactive") return;

  // handoff keywords → pause AI, flag for human
  const lower = text.toLowerCase();
  if (settings.handoffKeywords.some((k) => k && lower.includes(k.toLowerCase()))) {
    conversation.aiEnabled = false;
    await conversation.save();
    const note = await Message.create({
      conversation: conversation._id,
      contact: contact._id,
      direction: "out",
      author: "system",
      type: "text",
      text: "AI paused — customer asked for a human.",
      status: "sent"
    });
    emit("conversation:update", conversation.toObject());
    emit("message:new", { message: note.toObject(), conversation: conversation.toObject() });
    if (settings.outsideHoursMessage) {
      // notify customer someone will follow up
      const r = await wa.sendText(waId, "Sure — a member of our team will reply to you here shortly.");
      if (r.waMessageId)
        await Message.create({
          conversation: conversation._id,
          contact: contact._id,
          direction: "out",
          author: "system",
          type: "text",
          text: "Sure — a member of our team will reply to you here shortly.",
          waMessageId: r.waMessageId,
          status: "sent"
        });
    }
    return;
  }

  // outside business hours → optional off-hours auto message, still AI replies if enabled
  if (!withinBusinessHours(settings.businessHours) && settings.outsideHoursMessage) {
    await wa.sendText(waId, settings.outsideHoursMessage);
  }

  const replyText = await generateReply(conversation._id as any);
  if (!replyText) return;

  const result = await wa.sendText(waId, replyText);
  const outMsg = await Message.create({
    conversation: conversation._id,
    contact: contact._id,
    direction: "out",
    author: "ai",
    type: "text",
    text: replyText,
    waMessageId: result.waMessageId,
    status: result.error ? "failed" : "sent",
    error: result.error
  });
  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = replyText.slice(0, 120);
  await conversation.save();
  emit("message:new", { message: outMsg.toObject(), conversation: conversation.toObject() });
}

/** Handle status updates (sent/delivered/read/failed) for outbound messages. */
export async function handleStatusUpdate(status: any): Promise<void> {
  const waMessageId = status.id;
  const newStatus = status.status; // sent | delivered | read | failed
  if (!waMessageId || !newStatus) return;
  const msg = await Message.findOneAndUpdate(
    { waMessageId },
    { $set: { status: newStatus, ...(status.errors?.[0]?.title ? { error: status.errors[0].title } : {}) } },
    { new: true }
  );
  if (msg) emit("message:status", { messageId: msg._id, waMessageId, status: newStatus });

  // update broadcast recipient stats too
  const { BroadcastRecipient, Broadcast } = await import("../models");
  const rec = await BroadcastRecipient.findOneAndUpdate(
    { waMessageId },
    { $set: { status: newStatus } },
    { new: false }
  );
  if (rec && rec.status !== newStatus) {
    const inc: Record<string, number> = {};
    if (newStatus === "delivered") inc["stats.delivered"] = 1;
    if (newStatus === "read") inc["stats.read"] = 1;
    if (newStatus === "failed") inc["stats.failed"] = 1;
    if (Object.keys(inc).length) await Broadcast.updateOne({ _id: rec.broadcast }, { $inc: inc });
  }
}
