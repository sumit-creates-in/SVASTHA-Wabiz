/**
 * Broadcast engine.
 *
 * A campaign moves through: draft → scheduled → preparing → running ⇄ paused
 * → completed (or cancelled / failed).
 *
 * "Preparing" snapshots the audience into one BroadcastRecipient row per
 * contact. From then on the worker only ever reads pending rows from the
 * database, so a deploy or crash mid-campaign resumes exactly where it stopped
 * instead of leaving the campaign stuck on "running" or sending twice.
 */
import { Types } from "mongoose";
import {
  Broadcast,
  BroadcastRecipient,
  Contact,
  IBroadcast,
  IBroadcastAudience,
  IBroadcastVariable,
  IContact,
  RecipientStatus,
  Template,
  WabaNumber,
  getSettings,
} from "../models";
import * as wa from "./whatsapp";
import { canSendTemplate, recordMarketingSend, recordNumberSend } from "./compliance";
import { INVALID_WAID_QUERY } from "./phone";
import { emit } from "../realtime";

// ── Audience ────────────────────────────────────────────

/** Normalise legacy tag-only campaigns onto the richer audience model. */
export function effectiveAudience(b: Pick<IBroadcast, "audience" | "audienceTags">): IBroadcastAudience {
  const a = (b.audience || {}) as IBroadcastAudience;
  const includeTags = a.includeTags?.length ? a.includeTags : b.audienceTags || [];
  return {
    includeTags,
    tagMatch: a.tagMatch || "any",
    excludeTags: a.excludeTags || [],
    contactType: a.contactType || "",
    activeWithinDays: a.activeWithinDays || 0,
    skipRecentlyBroadcastDays: a.skipRecentlyBroadcastDays || 0,
    contactIds: a.contactIds || [],
    retargetBroadcast: a.retargetBroadcast,
    retargetStatuses: a.retargetStatuses || [],
  };
}

/**
 * Mongo query for everyone the audience describes, before per-contact
 * compliance checks. Opted-out and malformed numbers are always excluded.
 */
export async function audienceQuery(
  a: IBroadcastAudience,
  excludeBroadcastId?: unknown,
): Promise<Record<string, unknown>> {
  const and: Record<string, unknown>[] = [{ optedOut: { $ne: true } }, { $nor: [INVALID_WAID_QUERY] }];

  if (a.contactIds?.length) and.push({ _id: { $in: a.contactIds } });

  if (a.retargetBroadcast) {
    const q: Record<string, unknown> = { broadcast: a.retargetBroadcast };
    if (a.retargetStatuses?.length) q.status = { $in: a.retargetStatuses };
    const ids = await BroadcastRecipient.distinct("contact", q);
    and.push({ _id: { $in: ids } });
  }

  if (a.includeTags?.length) {
    and.push(a.tagMatch === "all" ? { tags: { $all: a.includeTags } } : { tags: { $in: a.includeTags } });
  }
  if (a.excludeTags?.length) and.push({ tags: { $nin: a.excludeTags } });

  if (a.contactType === "lead") and.push({ isCustomer: { $ne: true } });
  if (a.contactType === "customer") and.push({ isCustomer: true });
  if (a.contactType === "fromAd") and.push({ "referral.sourceId": { $exists: true, $ne: null } });

  if (a.activeWithinDays > 0) {
    and.push({ lastSeenAt: { $gte: new Date(Date.now() - a.activeWithinDays * 86400000) } });
  }

  if (a.skipRecentlyBroadcastDays > 0) {
    const since = new Date(Date.now() - a.skipRecentlyBroadcastDays * 86400000);
    const recent = await BroadcastRecipient.distinct("contact", {
      sentAt: { $gte: since },
      ...(excludeBroadcastId ? { broadcast: { $ne: excludeBroadcastId } } : {}),
    });
    if (recent.length) and.push({ _id: { $nin: recent } });
  }

  return { $and: and };
}

export interface AudienceEstimate {
  total: number;
  excludedOptedOut: number;
  excludedInvalid: number;
  excludedRecent: number;
  warnings: string[];
}

/** Live count for the builder, with the reasons people drop out. */
export async function estimateAudience(
  a: IBroadcastAudience,
  numberId?: string,
): Promise<AudienceEstimate> {
  const base = await audienceQuery(a);
  const total = await Contact.countDocuments(base);

  // What would the count be without each exclusion? Tells the user why.
  const relaxed = await audienceQuery({ ...a, skipRecentlyBroadcastDays: 0 });
  const withoutRecent = a.skipRecentlyBroadcastDays > 0 ? await Contact.countDocuments(relaxed) : total;
  const scope = { ...relaxed };
  (scope.$and as Record<string, unknown>[]).splice(0, 2); // drop optedOut + invalid filters
  const [optedOut, invalid] = await Promise.all([
    Contact.countDocuments({ $and: [...(scope.$and as any[]), { optedOut: true }] }),
    Contact.countDocuments({ $and: [...(scope.$and as any[]), { optedOut: { $ne: true } }, INVALID_WAID_QUERY] }),
  ]);

  const warnings: string[] = [];
  const number = numberId
    ? await WabaNumber.findById(numberId).lean()
    : await WabaNumber.findOne({ enabled: true }).lean();
  if (number) {
    const tierCap: Record<string, number> = {
      TIER_250: 250,
      TIER_1K: 1000,
      TIER_10K: 10000,
      TIER_100K: 100000,
    };
    const cap = tierCap[number.messagingLimit];
    if (cap && total > cap) {
      warnings.push(
        `This number can start conversations with ${cap.toLocaleString()} people per 24 hours (${number.messagingLimit}). ` +
          `Meta will reject sends beyond that — split the campaign or send over several days.`,
      );
    }
    if (number.qualityRating === "YELLOW")
      warnings.push("This number's quality rating is Medium. A large marketing send now risks dropping it to Low.");
    if (number.qualityRating === "RED")
      warnings.push("This number's quality rating is Low. Marketing sends are paused to protect it.");
  }
  if (total > 0 && !a.includeTags.length && !a.contactIds.length && !a.retargetBroadcast && !a.contactType && !a.activeWithinDays) {
    warnings.push("This goes to every contact. Sending to people who never asked to hear from you is the fastest way to get blocked.");
  }

  return {
    total,
    excludedOptedOut: optedOut,
    excludedInvalid: invalid,
    excludedRecent: Math.max(0, withoutRecent - total),
    warnings,
  };
}

// ── Variables ───────────────────────────────────────────

export function resolveVariable(v: IBroadcastVariable | undefined, c: Partial<IContact>): string {
  if (!v) return "";
  let value = "";
  switch (v.source) {
    case "static":
      value = v.value || "";
      break;
    case "name":
      value = c.name || "";
      break;
    case "firstName":
      value = (c.name || "").trim().split(/\s+/)[0] || "";
      break;
    case "phone":
      value = c.waId ? `+${c.waId}` : "";
      break;
    case "email":
      value = c.email || "";
      break;
    case "attribute": {
      const attrs: any = c.attributes;
      value = (attrs instanceof Map ? attrs.get(v.value) : attrs?.[v.value]) || "";
      break;
    }
  }
  value = String(value).trim() || v.fallback || "";
  // Meta rejects parameters with newlines/tabs or 4+ consecutive spaces.
  return value.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ");
}

function bodyParamsFor(b: IBroadcast, c: Partial<IContact>): string[] {
  if (b.bodyVariables?.length) return b.bodyVariables.map((v) => resolveVariable(v, c));
  // Legacy: fixed params with {{name}} substitution.
  return (b.bodyParams || []).map((p) => p.replace(/\{\{name\}\}/gi, c.name || "there"));
}

/** Render the template text for a given contact — used for previews and the inbox log. */
export function renderPreview(templateBody: string, params: string[]): string {
  return templateBody.replace(/\{\{(\d+)\}\}/g, (_m, i) => params[Number(i) - 1] ?? `{{${i}}}`);
}

// ── Sending one message ─────────────────────────────────

export async function sendBroadcastMessage(
  b: IBroadcast,
  number: any,
  contact: Partial<IContact> & { waId: string },
) {
  const params = bodyParamsFor(b, contact);
  const header = (b.headerVariables || []).map((v) => resolveVariable(v, contact));
  const button = b.buttonVariable ? resolveVariable(b.buttonVariable, contact) : undefined;

  const missing = params.findIndex((p) => !p);
  if (missing >= 0) {
    return { error: `Variable {{${missing + 1}}} is empty for this contact and has no fallback` };
  }

  return wa.sendTemplate(
    number,
    contact.waId,
    b.templateName,
    b.templateLanguage,
    params,
    header,
    button || undefined,
    b.templateCategory,
    b.headerMedia?.link ? b.headerMedia : undefined,
  );
}

// ── Speed ───────────────────────────────────────────────

const TICK_MS = 5000;

/** Messages per minute: user's choice, capped by what the number's tier can take. */
function ratePerMinute(speed: string, tier: string): number {
  const wanted = speed === "safe" ? 30 : speed === "fast" ? 240 : 90;
  const cap = tier === "TIER_UNLIMITED" || tier === "UNLIMITED" ? 600 : tier === "TIER_100K" ? 400 : tier === "TIER_10K" ? 240 : 60;
  return Math.min(wanted, cap);
}

// ── Lifecycle ───────────────────────────────────────────

/** Snapshot the audience into recipient rows, then hand over to the worker. */
export async function prepareBroadcast(broadcastId: string): Promise<void> {
  const b = await Broadcast.findOneAndUpdate(
    { _id: broadcastId, status: { $in: ["draft", "scheduled"] } },
    { $set: { status: "preparing", lastError: undefined } },
    { new: true },
  );
  if (!b) return; // already started, or cancelled

  try {
    const q = await audienceQuery(effectiveAudience(b), b._id);
    const cursor = Contact.find(q).select("_id waId name").lean().cursor();
    let batch: any[] = [];
    let total = 0;
    for await (const c of cursor) {
      batch.push({
        broadcast: b._id,
        contact: c._id,
        waId: c.waId,
        name: c.name,
        status: "pending",
      });
      if (batch.length === 1000) {
        await BroadcastRecipient.insertMany(batch, { ordered: false });
        total += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await BroadcastRecipient.insertMany(batch, { ordered: false });
      total += batch.length;
    }

    if (!total) {
      await Broadcast.updateOne(
        { _id: b._id },
        { $set: { status: "completed", completedAt: new Date(), lastError: "Nobody matched the audience" } },
      );
    } else {
      await Broadcast.updateOne(
        { _id: b._id, status: "preparing" },
        { $set: { status: "running", startedAt: new Date(), "stats.total": total, "stats.pending": total } },
      );
    }
  } catch (e: any) {
    await Broadcast.updateOne({ _id: b._id }, { $set: { status: "failed", lastError: e.message } });
  }
  await refreshStats(b._id);
}

/** Recount stats from recipient rows — the single source of truth. */
export async function refreshStats(broadcastId: unknown): Promise<IBroadcast | null> {
  const rows = await BroadcastRecipient.aggregate([
    { $match: { broadcast: new Types.ObjectId(String(broadcastId)) } },
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);
  const by: Record<string, number> = {};
  rows.forEach((r) => (by[r._id] = r.n));
  const replied = by.replied || 0;
  const read = (by.read || 0) + replied;
  const delivered = (by.delivered || 0) + read;
  const sent = (by.sent || 0) + delivered;
  const stats = {
    total: Object.values(by).reduce((a, n) => a + n, 0),
    pending: by.pending || 0,
    sent,
    delivered,
    read,
    replied,
    failed: by.failed || 0,
    skipped: by.skipped || 0,
  };
  const b = await Broadcast.findByIdAndUpdate(broadcastId, { $set: { stats } }, { new: true });
  if (b) emit("broadcast:update", { _id: b._id, status: b.status, stats });
  return b;
}

const busy = new Set<string>();

/** Send the next slice of one running campaign. */
async function tick(b: IBroadcast): Promise<void> {
  const id = String(b._id);
  if (busy.has(id)) return;
  busy.add(id);
  try {
    const number = b.number
      ? await WabaNumber.findById(b.number)
      : await WabaNumber.findOne({ enabled: true });
    if (!number) {
      await Broadcast.updateOne({ _id: b._id }, { $set: { status: "failed", lastError: "No sending number available" } });
      return;
    }

    const settings = await getSettings();
    const category = (b.templateCategory || "MARKETING").toUpperCase() === "MARKETING" ? "marketing" : "utility";
    const perTick = Math.max(1, Math.round((ratePerMinute(b.speed, number.messagingLimit) * TICK_MS) / 60000));
    const gap = Math.floor(TICK_MS / perTick / 2);

    const pending = await BroadcastRecipient.find({ broadcast: b._id, status: "pending" })
      .sort({ _id: 1 })
      .limit(perTick);

    if (!pending.length) {
      await Broadcast.updateOne(
        { _id: b._id, status: "running" },
        { $set: { status: "completed", completedAt: new Date() } },
      );
      await refreshStats(b._id);
      return;
    }

    for (const r of pending) {
      // Honour pause/cancel between messages, not just between ticks.
      const live = await Broadcast.findById(b._id).select("status").lean();
      if (live?.status !== "running") break;

      const contact = await Contact.findById(r.contact);
      if (!contact) {
        r.status = "skipped";
        r.error = "Contact was deleted";
        await r.save();
        continue;
      }
      const gate = canSendTemplate(contact, number, settings, category as "marketing" | "utility");
      if (!gate.allowed) {
        r.status = "skipped";
        r.error = gate.reason;
        await r.save();
        continue;
      }

      const result = await sendBroadcastMessage(b, number, contact);
      if (result.error) {
        r.status = "failed";
        r.error = result.error;
        await r.save();
        // The whole template is broken — stop instead of failing every row.
        if (/template|parameter|132\d{3}|does not exist/i.test(result.error) && !/empty for this contact/.test(result.error)) {
          const failedSoFar = await BroadcastRecipient.countDocuments({ broadcast: b._id, status: "failed" });
          const sentSoFar = await BroadcastRecipient.countDocuments({ broadcast: b._id, sentAt: { $exists: true } });
          if (failedSoFar >= 5 && sentSoFar === 0) {
            await Broadcast.updateOne(
              { _id: b._id },
              { $set: { status: "paused", lastError: `Paused automatically — every send is failing: ${result.error}` } },
            );
            break;
          }
        }
      } else {
        r.status = "sent";
        r.waMessageId = result.waMessageId;
        r.sentAt = new Date();
        r.error = undefined;
        await r.save();
        await recordNumberSend(number);
        if (category === "marketing") await recordMarketingSend(contact);
      }
      if (gap) await new Promise((res) => setTimeout(res, gap));
    }
    await refreshStats(b._id);
  } catch (e: any) {
    console.error(`[broadcast] tick failed for ${id}:`, e.message);
  } finally {
    busy.delete(id);
  }
}

/** One loop drives scheduling and sending for every campaign. */
export function startScheduler(): void {
  // A restart during "preparing" leaves a partial audience snapshot. Nothing
  // has been sent yet at that stage, so clear it and prepare again from scratch.
  (async () => {
    const stuck = await Broadcast.find({ status: "preparing" }).select("_id");
    for (const s of stuck) {
      await BroadcastRecipient.deleteMany({ broadcast: s._id });
      await Broadcast.updateOne({ _id: s._id }, { $set: { status: "scheduled", scheduledAt: new Date() } });
    }
    const resumed = await Broadcast.countDocuments({ status: "running" });
    if (resumed) console.log(`[broadcast] resuming ${resumed} running campaign(s) after restart`);
  })().catch(() => {});

  setInterval(async () => {
    try {
      const due = await Broadcast.find({ status: "scheduled", scheduledAt: { $lte: new Date() } }).select("_id");
      for (const b of due) prepareBroadcast(String(b._id)).catch(() => {});

      const running = await Broadcast.find({ status: "running" });
      for (const b of running) tick(b).catch(() => {});
    } catch (e: any) {
      console.error("[broadcast] scheduler error:", e.message);
    }
  }, TICK_MS);
}

/** Kept for existing callers: start a campaign now. */
export async function runBroadcast(broadcastId: string): Promise<void> {
  await prepareBroadcast(broadcastId);
}

// ── Delivery receipts and replies ───────────────────────

const RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, replied: 4 };

/** Apply a Meta status callback, never moving a recipient backwards. */
export async function applyRecipientStatus(
  waMessageId: string,
  status: string,
  error?: { title?: string; code?: number },
): Promise<boolean> {
  const rec = await BroadcastRecipient.findOne({ waMessageId });
  if (!rec) return false;

  const now = new Date();
  if (status === "failed") {
    rec.status = "failed";
    rec.error = error?.title || rec.error || "Delivery failed";
    rec.errorCode = error?.code;
  } else if ((RANK[status] ?? -1) > (RANK[rec.status] ?? -1)) {
    rec.status = status as RecipientStatus;
  }
  if (status === "delivered" && !rec.deliveredAt) rec.deliveredAt = now;
  if (status === "read") {
    rec.readAt = rec.readAt || now;
    rec.deliveredAt = rec.deliveredAt || now;
  }
  await rec.save();
  scheduleStatsRefresh(rec.broadcast);
  return true;
}

/** An inbound message within 72h of a broadcast counts as a reply to it. */
export async function recordBroadcastReply(contactId: unknown): Promise<void> {
  const since = new Date(Date.now() - 72 * 3600 * 1000);
  const rec = await BroadcastRecipient.findOne({
    contact: contactId,
    status: { $in: ["sent", "delivered", "read"] },
    sentAt: { $gte: since },
  }).sort({ sentAt: -1 });
  if (!rec) return;
  rec.status = "replied";
  rec.repliedAt = new Date();
  rec.readAt = rec.readAt || rec.repliedAt;
  rec.deliveredAt = rec.deliveredAt || rec.repliedAt;
  await rec.save();
  scheduleStatsRefresh(rec.broadcast);
}

// Status callbacks arrive in bursts — recount at most once per second per campaign.
const pendingRefresh = new Map<string, NodeJS.Timeout>();
function scheduleStatsRefresh(broadcastId: unknown) {
  const key = String(broadcastId);
  if (pendingRefresh.has(key)) return;
  pendingRefresh.set(
    key,
    setTimeout(() => {
      pendingRefresh.delete(key);
      refreshStats(key).catch(() => {});
    }, 1000),
  );
}

export async function loadTemplateFor(b: Pick<IBroadcast, "templateName" | "templateLanguage">) {
  return (
    (await Template.findOne({ name: b.templateName, language: b.templateLanguage }).lean()) ||
    (await Template.findOne({ name: b.templateName }).lean())
  );
}
