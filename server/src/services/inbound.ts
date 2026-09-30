import {
  Contact,
  Conversation,
  Message,
  WabaNumber,
  IWabaNumber,
  getSettings,
} from "../models";
import * as wa from "./whatsapp";
import { decide } from "./ai";
import type { BrainAction } from "./brain";
import { scheduleFollowUps, cancelFollowUps } from "./followups";
import { applyRecipientStatus, recordBroadcastReply } from "./broadcast";
import { emit } from "../realtime";
import {
  canSendFreeform,
  consumeAiQuota,
  isDuplicateOfLast,
  isOptIn,
  isOptOut,
  aiTemporarilyPaused,
  recordNumberSend,
  reviewReply,
  detectFrustration,
  explainErrorCode,
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

  console.log(
    `[ai-debug] 📨 inbound from ${waId} on ${number.displayPhoneNumber} (enabled=${number.enabled}, aiEnabled=${number.aiEnabled})`,
  );

  if (msg.id && (await Message.exists({ waMessageId: msg.id }))) {
    console.log(`[ai-debug] duplicate msg ${msg.id} — skipping`);
    return; // Meta retries
  }

  // Click-to-WhatsApp ads attach the ad they tapped to their first message.
  // Capture it so the AI can open with context and so you can see which
  // creative actually produces bookings.
  const ref = msg.referral;
  const referralUpdate = ref?.source_id
    ? {
        referral: {
          sourceId: ref.source_id,
          sourceType: ref.source_type,
          sourceUrl: ref.source_url,
          headline: ref.headline,
          body: ref.body,
          mediaType: ref.media_type,
          ctwaClid: ref.ctwa_clid,
          capturedAt: new Date(),
        },
      }
    : {};
  if (ref?.source_id) {
    console.log(
      `[ads] ${waId} came from ad ${ref.source_id}${ref.headline ? ` — "${ref.headline}"` : ""}`,
    );
  }

  const contact = await Contact.findOneAndUpdate(
    { waId },
    {
      $set: {
        lastSeenAt: new Date(),
        ...(profileName ? { name: profileName } : {}),
        ...referralUpdate,
      },
      ...(ref?.source_id
        ? { $addToSet: { tags: { $each: ["from-ad"] } } }
        : {}),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const conversation = await Conversation.findOneAndUpdate(
    { contact: contact._id, number: number._id },
    {
      $setOnInsert: { aiEnabled: number.aiEnabled },
      $set: { status: "open" },
      ...(ref?.source_id
        ? { $addToSet: { labels: { $each: ["From-Ad"] } } }
        : {}),
    },
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

  // They came back — stop any nudges we had queued for them.
  await cancelFollowUps(conversation._id).catch(() => {});
  // A message soon after a broadcast counts as a reply to that campaign.
  await recordBroadcastReply(contact._id).catch(() => {});
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
  if (!settings.aiGlobalEnabled) {
    console.log(`[ai-debug] ❌ blocked: aiGlobalEnabled is OFF in Settings`);
    return;
  }
  if (!number.aiEnabled) {
    console.log(
      `[ai-debug] ❌ blocked: aiEnabled is OFF for number ${number.displayPhoneNumber}`,
    );
    return;
  }
  if (!conversation.aiEnabled) {
    console.log(
      `[ai-debug] ⚠️ conversation aiEnabled is OFF for ${conversation._id} — but AI replies are always-on, continuing`,
    );
    // NOTE: We do NOT block here. AI always replies regardless of conversation-level flag.
    // The flag is still respected for botPaused (opt-out) flows above.
  }
  if (aiTemporarilyPaused(conversation)) {
    console.log(
      `[ai-debug] ⚠️ AI temporarily paused until ${conversation.aiPausedUntil} for ${waId} — but AI replies are always-on, continuing`,
    );
    // NOTE: We do NOT block here either.
  }
  if (!["text", "button", "interactive"].includes(type)) {
    console.log(
      `[ai-debug] ❌ blocked: message type "${type}" is not handled by AI`,
    );
    return;
  }
  console.log(
    `[ai-debug] ✅ AI eligible for ${waId} on ${number.displayPhoneNumber}`,
  );

  // ── 3. A frustrated customer gets an "at-risk" label ───
  // Only a label for whoever looks at the inbox. Whether a support call is raised is decided
  // by One Mind (it has its own always-urgent words), never by this app.
  if (settings.frustrationAutoHandoff && detectFrustration(text)) {
    conversation.labels = Array.from(new Set([...conversation.labels, "at-risk"]));
    await conversation.save();
    emit("conversation:update", conversation.toObject());
  }

  // ── 4. Policy gate: 24h window, opt-out, quality ──────
  const gate = canSendFreeform(conversation, contact, number, settings);
  if (!gate.allowed) {
    console.log(
      `[ai-debug] ❌ blocked by compliance gate for ${waId}: ${gate.reason}`,
    );
    console.log(
      `[ai-debug]   lastInboundAt=${conversation.lastInboundAt}, optedOut=${contact.optedOut}, numberQuality=${number.qualityRating}`,
    );
    return;
  }
  console.log(`[ai-debug] ✅ compliance gate passed for ${waId}`);

  // ── 5. Rate limit ─────────────────────────────────────
  const quota = await consumeAiQuota(conversation, settings);
  if (!quota.allowed) {
    console.log(`[ai-debug] ❌ blocked: ${quota.reason} for ${waId}`);
    return;
  }
  console.log(`[ai-debug] ✅ quota OK for ${waId}`);

  // ── 6. Ask One Mind ───────────────────────────────────
  // Member or lead, what to say, whether to book a call or raise a support call-back, and
  // the always-urgent words — all decided by One Mind. This app only passes the chat on.
  console.log(`[ai-debug] 🤖 asking One Mind for ${waId}`);
  const decision = await decide(conversation._id as any, number, contact);
  for (const p of decision.performed || []) {
    await noteBrainAction(conversation, contact, number, p);
  }
  if (decision.personType && (decision.personType === "customer") !== Boolean(contact.isCustomer)) {
    contact.isCustomer = decision.personType === "customer";
    await contact.save().catch(() => {});
  }
  console.log(
    `[ai-debug] 🤖 One Mind for ${waId}: ${decision.offline ? "UNREACHABLE — offline line sent" : decision.kind}${decision.text ? ` text="${decision.text.slice(0, 80)}..."` : ""}${(decision.performed || []).map((p) => ` action=${p.name}:${p.ok ? p.status : p.error}`).join("")}`,
  );
  if (decision.offline) {
    await Message.create({
      conversation: conversation._id,
      contact: contact._id,
      number: number._id,
      direction: "out",
      author: "system",
      type: "text",
      text: `⚠️ One Mind could not be reached (${decision.error || "no answer"}). The customer was asked to message again in a few minutes.`,
      status: "sent",
    });
  }
  if (decision.kind === "none") return;

  // ── 7b. Ordinary text reply ───────────────────────────
  const draft = decision.text || "";
  if (!draft) return;

  const review = reviewReply(draft, text, settings, number.qualityRating);

  if (review.action === "block") {
    console.log(`[compliance] AI reply blocked: ${review.reason}`);
    conversation.status = "pending";
    conversation.labels = Array.from(
      new Set([...conversation.labels, "needs-human"]),
    );
    await conversation.save();
    await Message.create({
      conversation: conversation._id,
      contact: contact._id,
      number: number._id,
      direction: "out",
      author: "system",
      type: "text",
      text: `AI reply withheld — ${review.reason}. Draft: "${draft.slice(0, 200)}"`,
      status: "sent",
    });
    emit("conversation:update", conversation.toObject());
    return;
  }

  if (review.action === "escalate") {
    // Flag for human team but keep AI running.
    conversation.status = "pending";
    conversation.labels = Array.from(
      new Set([...conversation.labels, "needs-human"]),
    );
    await conversation.save();
    const holding = settings.escalationMessage;
    if (holding && !(await isDuplicateOfLast(conversation._id, holding))) {
      const r = await wa.sendText(number, waId, holding);
      await Message.create({
        conversation: conversation._id,
        contact: contact._id,
        number: number._id,
        direction: "out",
        author: "system",
        type: "text",
        text: holding,
        waMessageId: r.waMessageId,
        status: r.error ? "failed" : "sent",
      });
    }
    await Message.create({
      conversation: conversation._id,
      contact: contact._id,
      number: number._id,
      direction: "out",
      author: "system",
      type: "text",
      text: "AI escalated — it wasn't confident enough to answer. Needs a human reply.",
      status: "sent",
    });
    emit("conversation:update", conversation.toObject());
    return;
  }

  const replyText = review.text;
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

  // The ball is in their court now — queue the nudges in case it stays there.
  await scheduleFollowUps(conversation).catch(() => {});
}

/** Handle delivery status callbacks and fan them out to broadcasts/workflows. */
export async function handleStatusUpdate(status: any): Promise<void> {
  const waMessageId = status.id;
  const newStatus = status.status;
  if (!waMessageId || !newStatus) return;

  const err = status.errors?.[0];
  const errCode: number | undefined = err?.code;
  const errTitle = err
    ? explainErrorCode(errCode) || err.title || err.message
    : undefined;

  const msg = await Message.findOneAndUpdate(
    { waMessageId },
    {
      $set: {
        status: newStatus,
        ...(errTitle ? { error: errTitle } : {}),
        ...(errCode ? { errorCode: errCode } : {}),
      },
    },
    { new: true },
  );
  if (msg)
    emit("message:status", {
      messageId: msg._id,
      waMessageId,
      status: newStatus,
    });

  // 131049 means Meta is throttling your marketing to protect users — a direct
  // warning shot before a quality downgrade. Raise it rather than bury it.
  if (errCode === 131049 || errCode === 130472) {
    const { Alert } = await import("../models");
    const recent = await Alert.findOne({
      title: "Marketing messages being withheld by Meta",
      createdAt: { $gte: new Date(Date.now() - 6 * 3600 * 1000) },
    });
    if (!recent) {
      await Alert.create({
        level: "warning",
        title: "Marketing messages being withheld by Meta",
        detail:
          "Meta declined to deliver one or more marketing messages to protect the user experience. This usually means contacts are being messaged too often. Reduce broadcast frequency before your quality rating drops.",
        number: msg?.number,
      });
      emit("alert:new", {});
    }
  }

  const { WorkflowEvent, Workflow } = await import("../models");

  // Broadcast receipts: recipient rows are the source of truth, and the
  // campaign's stats are recounted from them.
  await applyRecipientStatus(waMessageId, newStatus, {
    title: errTitle,
    code: errCode,
  });

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

/**
 * Leave a visible trace in the Wabiz inbox of what One Mind booked, and label the
 * conversation so follow-up nudges stop once a call is booked.
 */
async function noteBrainAction(
  conversation: any,
  contact: any,
  number: any,
  result: BrainAction,
): Promise<void> {
  const name = result.name;
  try {
    const isSales = /sales/.test(name);
    let text: string;
    if (result.ok && (result.status === "booked" || result.status === "raised")) {
      text = isSales
        ? `📞 Sales call booked for ${result.slot?.label ?? "the chosen time"} IST (booking #${result.bookingId}) — in the CRM, by One Mind.`
        : `🆘 Support call-back raised by One Mind (booking #${result.bookingId}) — in the CRM.`;
      conversation.labels = Array.from(
        new Set([...(conversation.labels || []), isSales ? "Call-Booked" : "support-call-raised"]),
      );
      await conversation.save();
    } else if (result.ok) {
      text = `ℹ️ ${name}: ${result.status} (booking #${result.bookingId}) — nothing new booked.`;
    } else {
      text = `⚠️ ${name} not done: ${result.error} — the customer was asked for what was missing.`;
    }
    await Message.create({
      conversation: conversation._id,
      contact: contact._id,
      number: number._id,
      direction: "out",
      author: "system",
      type: "text",
      text,
      status: "sent",
    });
    emit("conversation:update", conversation.toObject());
  } catch (err) {
    console.error("[ai] could not note brain action:", (err as Error).message);
  }
}
