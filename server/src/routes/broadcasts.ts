/**
 * Broadcast campaigns: build, estimate, test, launch, control, report.
 */
import { Router } from "express";
import { Types } from "mongoose";
import {
  Broadcast,
  BroadcastRecipient,
  Contact,
  Conversation,
  IBroadcast,
  Message,
  WabaNumber,
} from "../models";
import { AuthedRequest, requirePermission } from "../middleware/auth";
import { maskWaId } from "../permissions";
import { normalizePhone } from "../services/phone";
import {
  effectiveAudience,
  estimateAudience,
  loadTemplateFor,
  prepareBroadcast,
  refreshStats,
  renderPreview,
  resolveVariable,
  sendBroadcastMessage,
} from "../services/broadcast";

export const broadcastsRouter = Router();

const EDITABLE = [
  "name",
  "description",
  "number",
  "templateName",
  "templateLanguage",
  "templateCategory",
  "bodyVariables",
  "headerVariables",
  "buttonVariable",
  "headerMedia",
  "audience",
  "speed",
  "scheduledAt",
] as const;

function pick(body: any): Partial<IBroadcast> {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in (body || {})) out[k] = body[k];
  if (out.number === "") out.number = undefined;
  if (out.headerMedia && !(out.headerMedia as any).link) out.headerMedia = undefined;
  if (out.scheduledAt === "" || out.scheduledAt === null) out.scheduledAt = undefined;
  return out as Partial<IBroadcast>;
}

function validateForLaunch(b: any): string | null {
  if (!b.name?.trim()) return "Give the campaign a name";
  if (!b.templateName) return "Choose a template";
  const vars = b.bodyVariables || [];
  const empty = vars.findIndex((v: any) => v.source === "static" ? !v.value?.trim() : false);
  if (empty >= 0) return `Variable {{${empty + 1}}} has no text`;
  const noFallback = vars.findIndex((v: any) => v.source !== "static" && !v.fallback?.trim());
  if (noFallback >= 0)
    return `Variable {{${noFallback + 1}}} needs a fallback for contacts who don't have that detail`;
  return null;
}

// ── List ────────────────────────────────────────────────

broadcastsRouter.get("/", requirePermission("broadcasts.view"), async (req, res) => {
  const q: Record<string, unknown> = {};
  if (req.query.status) q.status = String(req.query.status);
  const items = await Broadcast.find(q)
    .sort({ createdAt: -1 })
    .limit(200)
    .populate("number", "label displayPhoneNumber")
    .populate("createdBy", "name")
    .lean();

  // Summary for the header strip — last 30 days.
  const since = new Date(Date.now() - 30 * 86400000);
  const recent = items.filter((b) => b.startedAt && new Date(b.startedAt) >= since);
  const sum = (k: keyof IBroadcast["stats"]) => recent.reduce((a, b) => a + (b.stats?.[k] || 0), 0);
  const sent = sum("sent");
  res.json({
    items,
    summary: {
      campaigns: recent.length,
      sent,
      readRate: sent ? Math.round((sum("read") / sent) * 100) : 0,
      replyRate: sent ? Math.round((sum("replied") / sent) * 100) : 0,
      running: items.filter((b) => b.status === "running").length,
      scheduled: items.filter((b) => b.status === "scheduled").length,
    },
  });
});

// ── Audience estimate (live, as the builder changes) ────

broadcastsRouter.post("/estimate", requirePermission("broadcasts.view"), async (req, res) => {
  const audience = effectiveAudience({ audience: req.body?.audience || {}, audienceTags: [] } as any);
  res.json(await estimateAudience(audience, req.body?.number || undefined));
});

// ── Preview for a real contact ──────────────────────────

broadcastsRouter.post("/preview", requirePermission("broadcasts.view"), async (req, res) => {
  const b = req.body || {};
  const tpl = await loadTemplateFor({ templateName: b.templateName, templateLanguage: b.templateLanguage });
  if (!tpl) {
    res.status(404).json({ error: "Template not found — sync templates first" });
    return;
  }
  const contact =
    (b.contactId && (await Contact.findById(b.contactId).lean())) ||
    (await Contact.findOne({ optedOut: { $ne: true }, name: { $nin: ["", null] } }).sort({ lastSeenAt: -1 }).lean()) ||
    ({ name: "Asha Rao", waId: "919876543210", email: "asha@example.com", attributes: {} } as any);
  const params = (b.bodyVariables || []).map((v: any) => resolveVariable(v, contact));
  res.json({ contactName: contact.name, text: renderPreview(tpl.bodyText || "", params), params });
});

// ── Test send ───────────────────────────────────────────

broadcastsRouter.post("/test", requirePermission("broadcasts.send"), async (req, res) => {
  const b = req.body || {};
  const phone = normalizePhone(b.phone, b.defaultCountryCode ?? "91");
  if (!phone.ok) {
    res.status(400).json({ error: phone.reason });
    return;
  }
  if (!b.templateName) {
    res.status(400).json({ error: "Choose a template first" });
    return;
  }
  const number = b.number ? await WabaNumber.findById(b.number) : await WabaNumber.findOne({ enabled: true });
  if (!number) {
    res.status(400).json({ error: "No sending number available" });
    return;
  }
  const existing = await Contact.findOne({ waId: phone.waId }).lean();
  const contact = existing || ({ waId: phone.waId, name: "", attributes: {} } as any);
  const draft = { ...pick(b), templateCategory: b.templateCategory } as any;
  const result = await sendBroadcastMessage(draft, number, contact);
  if (result.error) {
    res.status(502).json({ error: result.error });
    return;
  }
  res.json({ ok: true, sentTo: `+${phone.waId}` });
});

// ── Create / read / update ──────────────────────────────

broadcastsRouter.post("/", requirePermission("broadcasts.send"), async (req: AuthedRequest, res) => {
  const data = pick(req.body);
  if (!data.name || !data.templateName) {
    res.status(400).json({ error: "A name and a template are required" });
    return;
  }
  const b = await Broadcast.create({ ...data, status: "draft", createdBy: req.userId });
  res.json(b);
});

broadcastsRouter.get("/:id", requirePermission("broadcasts.view"), async (req, res) => {
  const b = await refreshStats(req.params.id);
  if (!b) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  await b.populate("number", "label displayPhoneNumber messagingLimit qualityRating");
  await b.populate("audience.retargetBroadcast", "name");

  const [failures, timeline, template] = await Promise.all([
    BroadcastRecipient.aggregate([
      { $match: { broadcast: b._id, status: { $in: ["failed", "skipped"] } } },
      { $group: { _id: { status: "$status", error: "$error" }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 12 },
    ]),
    // Read activity by hour, for the "when do people open" chart.
    BroadcastRecipient.aggregate([
      { $match: { broadcast: b._id, readAt: { $exists: true } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%dT%H:00", date: "$readAt", timezone: "Asia/Kolkata" } },
          n: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 96 },
    ]),
    loadTemplateFor(b),
  ]);

  res.json({
    broadcast: b,
    template,
    failures: failures.map((f) => ({ status: f._id.status, reason: f._id.error || "Unknown", count: f.n })),
    readTimeline: timeline.map((t) => ({ hour: t._id, count: t.n })),
  });
});

broadcastsRouter.patch("/:id", requirePermission("broadcasts.send"), async (req, res) => {
  const b = await Broadcast.findById(req.params.id);
  if (!b) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  if (!["draft", "scheduled"].includes(b.status)) {
    res.status(409).json({ error: "This campaign has already started — duplicate it to make changes" });
    return;
  }
  Object.assign(b, pick(req.body));
  if (b.status === "scheduled" && !b.scheduledAt) b.status = "draft";
  await b.save();
  res.json(b);
});

// ── Launch & control ────────────────────────────────────

broadcastsRouter.post("/:id/launch", requirePermission("broadcasts.send"), async (req, res) => {
  const b = await Broadcast.findById(req.params.id);
  if (!b) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  if (!["draft", "scheduled"].includes(b.status)) {
    res.status(409).json({ error: `Campaign is already ${b.status}` });
    return;
  }
  const problem = validateForLaunch(b);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  const when = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;
  if (when && when.getTime() > Date.now() + 30000) {
    b.status = "scheduled";
    b.scheduledAt = when;
    await b.save();
    res.json({ ok: true, status: "scheduled", scheduledAt: when });
    return;
  }

  prepareBroadcast(String(b._id)).catch((e) => console.error("[broadcast] launch failed:", e.message));
  res.json({ ok: true, status: "preparing" });
});

broadcastsRouter.post("/:id/pause", requirePermission("broadcasts.send"), async (req, res) => {
  const r = await Broadcast.updateOne({ _id: req.params.id, status: "running" }, { $set: { status: "paused" } });
  if (!r.modifiedCount) {
    res.status(409).json({ error: "Only a running campaign can be paused" });
    return;
  }
  res.json(await refreshStats(req.params.id));
});

broadcastsRouter.post("/:id/resume", requirePermission("broadcasts.send"), async (req, res) => {
  const r = await Broadcast.updateOne(
    { _id: req.params.id, status: "paused" },
    { $set: { status: "running" }, $unset: { lastError: 1 } },
  );
  if (!r.modifiedCount) {
    res.status(409).json({ error: "Only a paused campaign can be resumed" });
    return;
  }
  res.json(await refreshStats(req.params.id));
});

broadcastsRouter.post("/:id/cancel", requirePermission("broadcasts.send"), async (req, res) => {
  const b = await Broadcast.findById(req.params.id);
  if (!b) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  if (["completed", "cancelled", "failed"].includes(b.status)) {
    res.status(409).json({ error: `Campaign is already ${b.status}` });
    return;
  }
  b.status = b.status === "scheduled" || b.status === "draft" ? "draft" : "cancelled";
  if (b.status === "draft") b.scheduledAt = undefined;
  await b.save();
  // Unsent recipients are marked skipped so the numbers add up.
  await BroadcastRecipient.updateMany(
    { broadcast: b._id, status: "pending" },
    { $set: { status: "skipped", error: "Campaign was stopped before this was sent" } },
  );
  res.json(await refreshStats(b._id));
});

broadcastsRouter.post("/:id/duplicate", requirePermission("broadcasts.send"), async (req: AuthedRequest, res) => {
  const src = await Broadcast.findById(req.params.id).lean();
  if (!src) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const copy = await Broadcast.create({
    ...pick(src),
    audience: effectiveAudience(src as any),
    name: `${src.name} (copy)`,
    status: "draft",
    scheduledAt: undefined,
    createdBy: req.userId,
  });
  res.json(copy);
});

/** New draft aimed at people from this campaign who did (or didn't do) something. */
broadcastsRouter.post("/:id/retarget", requirePermission("broadcasts.send"), async (req: AuthedRequest, res) => {
  const src = await Broadcast.findById(req.params.id).lean();
  if (!src) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const statuses: string[] = Array.isArray(req.body?.statuses) ? req.body.statuses : ["sent", "delivered"];
  const label = req.body?.label || "follow-up";
  const draft = await Broadcast.create({
    name: `${src.name} — ${label}`,
    number: src.number,
    templateName: src.templateName,
    templateLanguage: src.templateLanguage,
    templateCategory: src.templateCategory,
    bodyVariables: src.bodyVariables,
    headerVariables: src.headerVariables,
    buttonVariable: src.buttonVariable,
    headerMedia: src.headerMedia,
    speed: src.speed,
    audience: {
      includeTags: [],
      tagMatch: "any",
      excludeTags: [],
      contactType: "",
      activeWithinDays: 0,
      skipRecentlyBroadcastDays: 0,
      contactIds: [],
      retargetBroadcast: src._id,
      retargetStatuses: statuses,
    },
    status: "draft",
    createdBy: req.userId,
  });
  res.json(draft);
});

broadcastsRouter.delete("/:id", requirePermission("broadcasts.send"), async (req, res) => {
  const b = await Broadcast.findById(req.params.id);
  if (!b) {
    res.json({ ok: true });
    return;
  }
  if (["running", "preparing"].includes(b.status)) {
    res.status(409).json({ error: "Stop the campaign before deleting it" });
    return;
  }
  await BroadcastRecipient.deleteMany({ broadcast: b._id });
  await b.deleteOne();
  res.json({ ok: true });
});

// ── Recipients (report table + export) ──────────────────

broadcastsRouter.get("/:id/recipients", requirePermission("broadcasts.view"), async (req: AuthedRequest, res) => {
  const viewer = req.viewer!;
  const q: Record<string, unknown> = { broadcast: new Types.ObjectId(req.params.id) };
  const status = String(req.query.status || "");
  if (status === "notRead") q.status = { $in: ["sent", "delivered"] };
  else if (status === "readNoReply") q.status = "read";
  else if (status) q.status = status;
  const search = String(req.query.search || "").trim();
  if (search) {
    const esc = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const digits = search.replace(/[^0-9]/g, "");
    q.$or = [
      { name: new RegExp(esc, "i") },
      ...(digits.length >= 3 && !viewer.maskPhoneNumbers ? [{ waId: new RegExp(digits) }] : []),
    ];
  }

  const exporting = req.query.format === "csv";
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const limit = exporting ? 100000 : 50;

  const [items, total] = await Promise.all([
    BroadcastRecipient.find(q)
      .sort({ sentAt: -1, _id: 1 })
      .skip(exporting ? 0 : (page - 1) * limit)
      .limit(limit)
      .lean(),
    BroadcastRecipient.countDocuments(q),
  ]);
  const shaped = items.map((r) => ({
    ...r,
    waId: viewer.maskPhoneNumbers ? maskWaId(r.waId || "") : r.waId,
  }));

  if (exporting) {
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const iso = (d?: Date) => (d ? new Date(d).toISOString() : "");
    const lines = [
      ["phone", "name", "status", "sent_at", "delivered_at", "read_at", "replied_at", "error"].join(","),
      ...shaped.map((r) =>
        [
          viewer.maskPhoneNumbers ? r.waId : `+${r.waId}`,
          r.name,
          r.status,
          iso(r.sentAt),
          iso(r.deliveredAt),
          iso(r.readAt),
          iso(r.repliedAt),
          r.error,
        ]
          .map(esc)
          .join(","),
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="campaign-recipients.csv"`);
    res.send("﻿" + lines.join("\r\n"));
    return;
  }

  res.json({ items: shaped, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

/** Tag everyone in a result bucket, e.g. "replied" → hot leads. */
broadcastsRouter.post("/:id/tag-recipients", requirePermission("contacts.edit"), async (req, res) => {
  const tag = String(req.body?.tag || "").trim();
  const statuses: string[] = Array.isArray(req.body?.statuses) ? req.body.statuses : [];
  if (!tag || !statuses.length) {
    res.status(400).json({ error: "Choose who to tag and enter a tag" });
    return;
  }
  const ids = await BroadcastRecipient.distinct("contact", {
    broadcast: req.params.id,
    status: { $in: statuses },
  });
  const r = await Contact.updateMany({ _id: { $in: ids } }, { $addToSet: { tags: tag } });
  res.json({ tagged: r.modifiedCount });
});

/** Replies are regular inbox messages; this lists recent ones for the report. */
broadcastsRouter.get("/:id/replies", requirePermission("inbox.view"), async (req: AuthedRequest, res) => {
  const viewer = req.viewer!;
  const recs = await BroadcastRecipient.find({ broadcast: req.params.id, status: "replied" })
    .sort({ repliedAt: -1 })
    .limit(30)
    .lean();
  const out = await Promise.all(
    recs.map(async (r) => {
      const msg = await Message.findOne({
        contact: r.contact,
        direction: "in",
        createdAt: { $gte: r.sentAt || new Date(0) },
      })
        .sort({ createdAt: 1 })
        .lean();
      const conv = msg ? await Conversation.findById(msg.conversation).select("_id").lean() : null;
      return {
        name: r.name,
        waId: viewer.maskPhoneNumbers ? maskWaId(r.waId || "") : r.waId,
        text: msg?.text || "",
        at: r.repliedAt,
        conversationId: conv?._id,
      };
    }),
  );
  res.json(out);
});
