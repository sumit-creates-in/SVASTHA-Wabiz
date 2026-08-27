/**
 * Follow-up engine — chase leads who go quiet.
 *
 * Flow:
 *   1. AI replies and is now waiting on the customer → schedule the sequence.
 *   2. Customer replies → every pending job for that chat is cancelled.
 *   3. Nothing arrives → the scheduler fires each step in turn.
 *
 * Every step is re-checked against live state at send time, not at schedule
 * time, because a lot can change in 20 hours: they may have booked, opted out,
 * been taken over by a human, or the 24-hour window may have closed.
 */
import {
  Contact,
  Conversation,
  FollowUpJob,
  FollowUpSequence,
  IConversation,
  IFollowUpSequence,
  Message,
  WabaNumber,
  getSettings,
} from "../models";
import * as wa from "./whatsapp";
import { generateFollowUp, FOLLOWUP_SKIP } from "./ai";
import {
  canSendFreeform,
  canSendTemplate,
  insideWindow,
  recordMarketingSend,
  recordNumberSend,
  aiTemporarilyPaused,
} from "./compliance";
import { emit } from "../realtime";

/** Is the clock inside the sequence's quiet hours? */
function inQuietHours(seq: IFollowUpSequence): boolean {
  try {
    const now = new Date().toLocaleTimeString("en-GB", {
      hour12: false,
      timeZone: seq.timezone,
      hour: "2-digit",
      minute: "2-digit",
    });
    const { quietHoursStart: start, quietHoursEnd: end } = seq;
    if (!start || !end || start === end) return false;
    // Quiet hours normally wrap past midnight (21:00 → 09:00).
    return start > end ? now >= start || now < end : now >= start && now < end;
  } catch {
    return false;
  }
}

/** Next moment outside quiet hours, so a nudge lands at a civil time. */
function nextAllowedTime(seq: IFollowUpSequence, from: Date): Date {
  const candidate = new Date(from);
  for (let i = 0; i < 48; i++) {
    const t = candidate.toLocaleTimeString("en-GB", {
      hour12: false,
      timeZone: seq.timezone,
      hour: "2-digit",
      minute: "2-digit",
    });
    const { quietHoursStart: s, quietHoursEnd: e } = seq;
    const quiet = s > e ? t >= s || t < e : t >= s && t < e;
    if (!quiet) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 30);
  }
  return candidate;
}

/** Which sequences apply to this conversation? */
async function sequencesFor(conv: IConversation): Promise<IFollowUpSequence[]> {
  const all = await FollowUpSequence.find({ enabled: true });
  const contact = await Contact.findById(conv.contact).lean();
  return all.filter((s) => {
    if (s.numbers.length && !s.numbers.some((n) => String(n) === String(conv.number)))
      return false;
    if (s.audience === "customer" && !contact?.isCustomer) return false;
    if (s.audience === "lead" && contact?.isCustomer) return false;
    return true;
  });
}

/**
 * Queue the whole sequence for a conversation that's now awaiting a reply.
 * Called after the AI (or an agent) sends a message.
 */
export async function scheduleFollowUps(conv: IConversation): Promise<void> {
  const sequences = await sequencesFor(conv);
  if (!sequences.length) return;

  const anchor = conv.lastInboundAt ? new Date(conv.lastInboundAt) : new Date();

  for (const seq of sequences) {
    if (seq.stopLabels.some((l) => conv.labels.includes(l))) continue;

    for (let i = 0; i < seq.steps.length; i++) {
      const step = seq.steps[i];
      let runAt = new Date(anchor.getTime() + step.afterMinutes * 60000);
      if (runAt.getTime() < Date.now()) runAt = new Date(Date.now() + 60000);
      runAt = nextAllowedTime(seq, runAt);

      try {
        await FollowUpJob.create({
          sequence: seq._id,
          conversation: conv._id,
          contact: conv.contact,
          number: conv.number,
          stepIndex: i,
          runAt,
          status: "pending",
        });
        await FollowUpSequence.updateOne(
          { _id: seq._id },
          { $inc: { "stats.scheduled": 1 } },
        );
      } catch {
        // Duplicate key — this step is already queued for this chat.
      }
    }
  }
}

/** The customer replied — stop chasing them. */
export async function cancelFollowUps(
  conversationId: unknown,
  reason = "Customer replied",
): Promise<void> {
  const pending = await FollowUpJob.find({
    conversation: conversationId,
    status: "pending",
  }).lean();
  if (!pending.length) return;

  await FollowUpJob.updateMany(
    { conversation: conversationId, status: "pending" },
    { $set: { status: "cancelled", reason } },
  );

  // Count a reply against the sequence that was chasing them, but only if we
  // had actually sent at least one nudge — otherwise it isn't a recovery.
  const sentAny = await FollowUpJob.findOne({
    conversation: conversationId,
    status: "sent",
  }).lean();
  if (sentAny && reason === "Customer replied") {
    await FollowUpSequence.updateOne(
      { _id: sentAny.sequence },
      { $inc: { "stats.replied": 1 } },
    );
  }
}

/** Run one due job. Every stop condition is re-checked here, live. */
async function runJob(jobId: unknown): Promise<void> {
  const job = await FollowUpJob.findById(jobId);
  if (!job || job.status !== "pending") return;

  const finish = async (status: "sent" | "skipped" | "failed", reason?: string, text?: string) => {
    job.status = status;
    job.reason = reason;
    if (text) job.sentText = text;
    await job.save();
    const key =
      status === "sent" ? "stats.sent" : status === "skipped" ? "stats.skipped" : "stats.skipped";
    await FollowUpSequence.updateOne({ _id: job.sequence }, { $inc: { [key]: 1 } });
  };

  const seq = await FollowUpSequence.findById(job.sequence);
  const conv = await Conversation.findById(job.conversation);
  const contact = await Contact.findById(job.contact);
  const number = await WabaNumber.findById(job.number);
  if (!seq || !conv || !contact || !number) return finish("skipped", "Context missing");

  if (!seq.enabled) return finish("skipped", "Sequence disabled");
  if (!number.enabled) return finish("skipped", "Number disabled");
  if (contact.optedOut) return finish("skipped", "Contact opted out");
  if (conv.status === "closed") return finish("skipped", "Conversation closed");
  if (seq.stopLabels.some((l) => conv.labels.includes(l)))
    return finish("skipped", `Chat labelled ${conv.labels.join(", ")}`);
  if (seq.skipWhenAiOff && (!conv.aiEnabled || aiTemporarilyPaused(conv)))
    return finish("skipped", "AI is off or a human has taken over");

  // Did they reply after this job was queued? Belt and braces alongside cancel.
  if (conv.lastInboundAt && new Date(conv.lastInboundAt).getTime() > job.createdAt!.getTime())
    return finish("skipped", "Customer replied");

  if (inQuietHours(seq)) {
    job.runAt = nextAllowedTime(seq, new Date(Date.now() + 30 * 60000));
    await job.save();
    return;
  }

  const step = seq.steps[job.stepIndex];
  if (!step) return finish("skipped", "Step no longer exists");

  const settings = await getSettings();
  const hoursQuiet = conv.lastInboundAt
    ? (Date.now() - new Date(conv.lastInboundAt).getTime()) / 3600000
    : 0;

  // ── Outside the 24h window only a template is allowed ──
  const windowOpen = insideWindow(conv);
  const effectiveMode = windowOpen ? step.mode : "template";

  if (effectiveMode === "template") {
    if (!step.templateName)
      return finish(
        "skipped",
        windowOpen
          ? "Step has no template configured"
          : "24-hour window closed and no template configured for this step",
      );
    const gate = canSendTemplate(contact, number, settings, "marketing");
    if (!gate.allowed) return finish("skipped", gate.reason);

    const params = (step.templateParams || []).map((p) =>
      p.replace(/\{\{\s*name\s*\}\}/gi, contact.name || "there"),
    );
    const result = await wa.sendTemplate(
      number,
      contact.waId,
      step.templateName,
      step.templateLanguage || "en",
      params,
    );
    if (result.error) return finish("failed", result.error);

    await recordNumberSend(number);
    await recordMarketingSend(contact);
    await logOutbound(conv, contact, number, `[template] ${step.templateName}`, result.waMessageId);
    return finish("sent", "Template sent (outside window)", step.templateName);
  }

  // ── Inside the window: free-form ──
  const gate = canSendFreeform(conv, contact, number, settings);
  if (!gate.allowed) return finish("skipped", gate.reason);

  let text = "";
  if (step.mode === "text") {
    text = (step.text || "").replace(/\{\{\s*name\s*\}\}/gi, contact.name || "there");
  } else {
    const priorNudges = await FollowUpJob.find({
      conversation: conv._id,
      status: "sent",
      sentText: { $exists: true, $ne: "" },
    })
      .select("sentText")
      .lean();
    const generated = await generateFollowUp(conv._id as any, number, contact, {
      attempt: job.stepIndex + 1,
      hoursQuiet,
      lastNudges: priorNudges.map((p) => p.sentText || "").filter(Boolean),
    });
    if (generated === FOLLOWUP_SKIP) {
      // The model judged that chasing would be unwelcome. Drop the rest too.
      await FollowUpJob.updateMany(
        { conversation: conv._id, status: "pending", _id: { $ne: job._id } },
        { $set: { status: "cancelled", reason: "AI judged further follow-up inappropriate" } },
      );
      return finish("skipped", "AI judged follow-up inappropriate (declined or already handled)");
    }
    text = generated;
  }

  if (!text.trim()) return finish("skipped", "Nothing to send");

  const result = await wa.sendText(number, contact.waId, text);
  if (result.error) return finish("failed", result.error);

  await recordNumberSend(number);
  await logOutbound(conv, contact, number, text, result.waMessageId);
  return finish("sent", undefined, text);
}

async function logOutbound(
  conv: IConversation,
  contact: any,
  number: any,
  text: string,
  waMessageId?: string,
): Promise<void> {
  const msg = await Message.create({
    conversation: conv._id,
    contact: contact._id,
    number: number._id,
    direction: "out",
    author: "ai",
    type: "text",
    text,
    waMessageId,
    status: "sent",
  });
  conv.lastMessageAt = new Date();
  conv.lastMessagePreview = text.slice(0, 120);
  conv.labels = Array.from(new Set([...conv.labels, "Followed-Up"]));
  await conv.save();
  emit("message:new", { message: msg.toObject(), conversation: conv.toObject() });
}

/** Poll for due jobs. Runs every minute. */
export function startFollowUpScheduler(): void {
  setInterval(async () => {
    try {
      const due = await FollowUpJob.find({ status: "pending", runAt: { $lte: new Date() } })
        .sort({ runAt: 1 })
        .limit(25)
        .select("_id")
        .lean();
      for (const j of due) {
        await runJob(j._id).catch((e) =>
          console.error("[followup] job failed:", e.message),
        );
      }
    } catch (e: any) {
      console.error("[followup] scheduler error:", e.message);
    }
  }, 60000);
}
