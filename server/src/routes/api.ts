import { Router } from "express";
import {
  Contact,
  Conversation,
  Message,
  Template,
  Broadcast,
  KnowledgeDoc,
  getSettings,
  Settings
} from "../models";
import * as wa from "../services/whatsapp";
import { generateReply } from "../services/ai";
import { runBroadcast } from "../services/broadcast";
import { emit } from "../realtime";

export const apiRouter = Router();

// ── Conversations & messages ────────────────────────────
apiRouter.get("/conversations", async (req, res) => {
  const status = (req.query.status as string) || undefined;
  const q: Record<string, unknown> = {};
  if (status) q.status = status;
  const items = await Conversation.find(q)
    .sort({ lastMessageAt: -1 })
    .limit(200)
    .populate("contact")
    .lean();
  res.json(items);
});

apiRouter.get("/conversations/:id/messages", async (req, res) => {
  const items = await Message.find({ conversation: req.params.id })
    .sort({ createdAt: 1 })
    .limit(500)
    .lean();
  await Conversation.updateOne({ _id: req.params.id }, { $set: { unreadCount: 0 } });
  res.json(items);
});

apiRouter.patch("/conversations/:id", async (req, res) => {
  const allowed: Record<string, unknown> = {};
  for (const k of ["aiEnabled", "status", "unreadCount"] as const) {
    if (k in (req.body || {})) allowed[k] = req.body[k];
  }
  const conv = await Conversation.findByIdAndUpdate(req.params.id, { $set: allowed }, { new: true })
    .populate("contact")
    .lean();
  if (conv) emit("conversation:update", conv);
  res.json(conv);
});

// Send a manual (human) reply
apiRouter.post("/conversations/:id/messages", async (req, res) => {
  const conv = await Conversation.findById(req.params.id).populate("contact");
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const text = String(req.body?.text || "").trim();
  if (!text) {
    res.status(400).json({ error: "Text required" });
    return;
  }
  const contact: any = conv.contact;
  const result = await wa.sendText(contact.waId, text);
  const msg = await Message.create({
    conversation: conv._id,
    contact: contact._id,
    direction: "out",
    author: "human",
    type: "text",
    text,
    waMessageId: result.waMessageId,
    status: result.error ? "failed" : "sent",
    error: result.error
  });
  conv.lastMessageAt = new Date();
  conv.lastMessagePreview = text.slice(0, 120);
  await conv.save();
  emit("message:new", { message: msg.toObject(), conversation: conv.toObject() });
  res.json(msg);
});

// Ask AI for a suggested draft (doesn't send)
apiRouter.post("/conversations/:id/suggest", async (req, res) => {
  const conv = await Conversation.findById(req.params.id);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const text = await generateReply(conv._id as any);
  res.json({ text });
});

// ── Contacts ────────────────────────────────────────────
apiRouter.get("/contacts", async (req, res) => {
  const search = String(req.query.search || "").trim();
  const tag = String(req.query.tag || "").trim();
  const q: Record<string, unknown> = {};
  if (search) q.$or = [{ name: new RegExp(search, "i") }, { waId: new RegExp(search) }];
  if (tag) q.tags = tag;
  const items = await Contact.find(q).sort({ updatedAt: -1 }).limit(500).lean();
  res.json(items);
});

apiRouter.post("/contacts", async (req, res) => {
  const { waId, name, tags } = req.body || {};
  if (!waId) {
    res.status(400).json({ error: "waId (phone) required" });
    return;
  }
  const c = await Contact.findOneAndUpdate(
    { waId: String(waId).replace(/[^0-9]/g, "") },
    { $set: { name: name || "", tags: tags || [] } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.json(c);
});

apiRouter.patch("/contacts/:id", async (req, res) => {
  const allowed: Record<string, unknown> = {};
  for (const k of ["name", "tags", "optedOut", "attributes"] as const) {
    if (k in (req.body || {})) allowed[k] = req.body[k];
  }
  const c = await Contact.findByIdAndUpdate(req.params.id, { $set: allowed }, { new: true }).lean();
  res.json(c);
});

apiRouter.delete("/contacts/:id", async (req, res) => {
  await Contact.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

// Bulk import: [{waId, name, tags}]
apiRouter.post("/contacts/import", async (req, res) => {
  const rows: any[] = Array.isArray(req.body) ? req.body : req.body?.rows || [];
  let imported = 0;
  for (const r of rows) {
    const waId = String(r.waId || r.phone || "").replace(/[^0-9]/g, "");
    if (!waId) continue;
    await Contact.findOneAndUpdate(
      { waId },
      { $set: { name: r.name || "" }, $addToSet: { tags: { $each: r.tags || [] } } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    imported++;
  }
  res.json({ imported });
});

// ── Templates ───────────────────────────────────────────
apiRouter.get("/templates", async (_req, res) => {
  res.json(await Template.find().sort({ updatedAt: -1 }).lean());
});

// Pull latest templates from Meta
apiRouter.post("/templates/sync", async (_req, res) => {
  try {
    const metaTemplates = await wa.fetchTemplates();
    for (const t of metaTemplates) {
      const body = (t.components || []).find((c: any) => c.type === "BODY");
      await Template.findOneAndUpdate(
        { name: t.name, language: t.language },
        {
          $set: {
            category: t.category,
            status: t.status,
            bodyText: body?.text || "",
            components: t.components || [],
            metaId: t.id
          }
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }
    res.json({ synced: metaTemplates.length });
  } catch (e: any) {
    res.status(502).json({ error: e?.response?.data?.error?.message || e.message });
  }
});

apiRouter.post("/templates", async (req, res) => {
  const { name, language, category, bodyText } = req.body || {};
  if (!name || !bodyText) {
    res.status(400).json({ error: "name and bodyText required" });
    return;
  }
  try {
    await wa.createTemplate({
      name: String(name).toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      language: language || "en",
      category: category || "MARKETING",
      bodyText
    });
    res.json({ ok: true, note: "Submitted to Meta for approval. Sync after approval." });
  } catch (e: any) {
    res.status(502).json({ error: e?.response?.data?.error?.message || e.message });
  }
});

// ── Broadcasts ──────────────────────────────────────────
apiRouter.get("/broadcasts", async (_req, res) => {
  res.json(await Broadcast.find().sort({ createdAt: -1 }).lean());
});

apiRouter.post("/broadcasts", async (req, res) => {
  const { name, templateName, templateLanguage, bodyParams, audienceTags, scheduledAt } = req.body || {};
  if (!name || !templateName) {
    res.status(400).json({ error: "name and templateName required" });
    return;
  }
  const b = await Broadcast.create({
    name,
    templateName,
    templateLanguage: templateLanguage || "en",
    bodyParams: bodyParams || [],
    audienceTags: audienceTags || [],
    scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
    status: scheduledAt ? "scheduled" : "draft"
  });
  res.json(b);
});

apiRouter.post("/broadcasts/:id/send", async (req, res) => {
  runBroadcast(req.params.id).catch((e) => console.error("[broadcast]", e.message));
  res.json({ ok: true, started: true });
});

apiRouter.post("/broadcasts/:id/cancel", async (req, res) => {
  const b = await Broadcast.findByIdAndUpdate(
    req.params.id,
    { $set: { status: "cancelled" } },
    { new: true }
  ).lean();
  res.json(b);
});

apiRouter.delete("/broadcasts/:id", async (req, res) => {
  await Broadcast.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

// ── Knowledge base ──────────────────────────────────────
apiRouter.get("/knowledge", async (_req, res) => {
  res.json(await KnowledgeDoc.find().sort({ updatedAt: -1 }).lean());
});
apiRouter.post("/knowledge", async (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !content) {
    res.status(400).json({ error: "title and content required" });
    return;
  }
  res.json(await KnowledgeDoc.create({ title, content }));
});
apiRouter.patch("/knowledge/:id", async (req, res) => {
  const allowed: Record<string, unknown> = {};
  for (const k of ["title", "content", "enabled"] as const) {
    if (k in (req.body || {})) allowed[k] = req.body[k];
  }
  res.json(await KnowledgeDoc.findByIdAndUpdate(req.params.id, { $set: allowed }, { new: true }).lean());
});
apiRouter.delete("/knowledge/:id", async (req, res) => {
  await KnowledgeDoc.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

// ── Settings ────────────────────────────────────────────
apiRouter.get("/settings", async (_req, res) => {
  res.json(await getSettings());
});
apiRouter.patch("/settings", async (req, res) => {
  const s = await getSettings();
  const allowed = [
    "businessName",
    "aiProvider",
    "aiModel",
    "systemPrompt",
    "aiGlobalEnabled",
    "aiMaxTokens",
    "handoffKeywords",
    "outsideHoursMessage",
    "businessHours"
  ] as const;
  for (const k of allowed) {
    if (k in (req.body || {})) (s as any)[k] = req.body[k];
  }
  await s.save();
  res.json(s);
});

// ── Analytics ───────────────────────────────────────────
apiRouter.get("/analytics/overview", async (_req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [contacts, openConvs, msgIn, msgOut, aiReplies, byDay] = await Promise.all([
    Contact.countDocuments(),
    Conversation.countDocuments({ status: "open" }),
    Message.countDocuments({ direction: "in", createdAt: { $gte: since } }),
    Message.countDocuments({ direction: "out", createdAt: { $gte: since } }),
    Message.countDocuments({ author: "ai", createdAt: { $gte: since } }),
    Message.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            direction: "$direction"
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.day": 1 } }
    ])
  ]);
  const automationRate = msgOut > 0 ? Math.round((aiReplies / msgOut) * 100) : 0;
  res.json({ contacts, openConvs, msgIn, msgOut, aiReplies, automationRate, byDay });
});
