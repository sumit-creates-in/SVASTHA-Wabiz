import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  Contact,
  Conversation,
  Message,
  Template,
  Broadcast,
  KnowledgeDoc,
  WabaNumber,
  Workflow,
  WorkflowEvent,
  User,
  Alert,
  QualitySnapshot,
  getSettings
} from "../models";
import * as wa from "../services/whatsapp";
import { generateReply, classifyConversation } from "../services/ai";
import { runBroadcast } from "../services/broadcast";
import { fireWorkflow, newKey, newSecret } from "../services/workflows";
import {
  canSendFreeform,
  insideWindow,
  windowRemainingMs,
  recordNumberSend
} from "../services/compliance";
import { emit } from "../realtime";
import { env } from "../config/env";
import { AuthedRequest } from "../middleware/auth";

export const apiRouter = Router();

// ════════════════════════════════════════════════════════
// NUMBERS (multi-number health & management)
// ════════════════════════════════════════════════════════
apiRouter.get("/numbers", async (_req, res) => {
  const numbers = await WabaNumber.find().sort({ createdAt: 1 }).lean();
  const withCounts = await Promise.all(
    numbers.map(async (n) => ({
      ...n,
      tokenOverride: n.tokenOverride ? "set" : undefined,
      conversations: await Conversation.countDocuments({ number: n._id }),
      unread: await Conversation.countDocuments({ number: n._id, unreadCount: { $gt: 0 } })
    }))
  );
  res.json(withCounts);
});

apiRouter.post("/numbers", async (req, res) => {
  const { label, businessAccountId, phoneNumberId, tokenOverride, purpose, aiEnabled, systemPromptOverride } =
    req.body || {};
  if (!label || !businessAccountId || !phoneNumberId) {
    res.status(400).json({ error: "label, businessAccountId and phoneNumberId are required" });
    return;
  }
  const exists = await WabaNumber.findOne({ phoneNumberId });
  if (exists) {
    res.status(409).json({ error: "This phone number ID is already connected" });
    return;
  }
  const num = await WabaNumber.create({
    label,
    businessAccountId,
    phoneNumberId,
    tokenOverride: tokenOverride || undefined,
    purpose: purpose || "mixed",
    aiEnabled: aiEnabled !== false,
    systemPromptOverride
  });
  await wa.syncNumberHealth(num);

  // Subscribing the app to the WABA is what actually starts webhook delivery —
  // do it automatically so nobody has to discover this step the hard way.
  let subscribed = false;
  let subscribeError: string | undefined;
  try {
    subscribed = await wa.subscribeApp(num.businessAccountId, num.tokenOverride);
  } catch (e: any) {
    subscribeError = e?.response?.data?.error?.message || e.message;
    console.warn(`[numbers] auto-subscribe failed for ${num.businessAccountId}: ${subscribeError}`);
  }

  res.json({ ...num.toObject(), subscribed, subscribeError });
});

apiRouter.patch("/numbers/:id", async (req, res) => {
  const allowed: Record<string, unknown> = {};
  for (const k of [
    "label",
    "purpose",
    "enabled",
    "aiEnabled",
    "systemPromptOverride",
    "tokenOverride",
    "businessAccountId"
  ] as const) {
    if (k in (req.body || {})) allowed[k] = req.body[k];
  }
  const n = await WabaNumber.findByIdAndUpdate(req.params.id, { $set: allowed }, { new: true }).lean();
  res.json(n);
});

apiRouter.delete("/numbers/:id", async (req, res) => {
  await WabaNumber.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

apiRouter.post("/numbers/:id/sync", async (req, res) => {
  const n = await WabaNumber.findById(req.params.id);
  if (!n) {
    res.status(404).json({ error: "Number not found" });
    return;
  }
  await wa.syncNumberHealth(n);
  res.json(n);
});

apiRouter.post("/numbers/sync-all", async (_req, res) => {
  await wa.syncAllNumbers();
  res.json({ ok: true });
});

// ── Webhook subscriptions ───────────────────────────────
// Verifying a callback URL is not enough: the app must also be subscribed to the
// WABA. These endpoints show which apps are subscribed and let you fix it in a click.

/** Subscription status for every number, grouped by WABA (one Graph call per WABA). */
apiRouter.get("/numbers/subscription-status", async (_req, res) => {
  const numbers = await WabaNumber.find().lean();
  const result: Record<string, unknown> = {};
  const cache = new Map<string, { apps: wa.SubscribedApp[]; error?: string }>();

  for (const n of numbers) {
    const cacheKey = `${n.businessAccountId}:${n.tokenOverride || "default"}`;
    if (!cache.has(cacheKey)) {
      try {
        cache.set(cacheKey, { apps: await wa.getSubscribedApps(n.businessAccountId, n.tokenOverride) });
      } catch (e: any) {
        cache.set(cacheKey, { apps: [], error: e?.response?.data?.error?.message || e.message });
      }
    }
    const entry = cache.get(cacheKey)!;
    const appId = await wa.getAppId(n.tokenOverride);
    result[String(n._id)] = {
      appId,
      apps: entry.apps,
      subscribed: !!appId && entry.apps.some((a) => a.id === appId),
      otherApps: entry.apps.filter((a) => a.id !== appId),
      error: entry.error
    };
  }
  res.json(result);
});

/** Subscribe this app to the number's WABA so webhooks start flowing. */
apiRouter.post("/numbers/:id/subscribe", async (req, res) => {
  const n = await WabaNumber.findById(req.params.id);
  if (!n) {
    res.status(404).json({ error: "Number not found" });
    return;
  }
  try {
    const ok = await wa.subscribeApp(n.businessAccountId, n.tokenOverride);
    const apps = await wa.getSubscribedApps(n.businessAccountId, n.tokenOverride);
    res.json({ ok, apps });
  } catch (e: any) {
    res.status(502).json({ error: e?.response?.data?.error?.message || e.message });
  }
});

/** Unsubscribe this app from the number's WABA. */
apiRouter.delete("/numbers/:id/subscribe", async (req, res) => {
  const n = await WabaNumber.findById(req.params.id);
  if (!n) {
    res.status(404).json({ error: "Number not found" });
    return;
  }
  try {
    const ok = await wa.unsubscribeApp(n.businessAccountId, n.tokenOverride);
    res.json({ ok });
  } catch (e: any) {
    res.status(502).json({ error: e?.response?.data?.error?.message || e.message });
  }
});

/** Discover phone numbers registered under a WABA (for the "Add number" flow). */
apiRouter.post("/numbers/discover", async (req, res) => {
  const { businessAccountId, token } = req.body || {};
  if (!businessAccountId) {
    res.status(400).json({ error: "businessAccountId required" });
    return;
  }
  try {
    const list = await wa.fetchPhoneNumbers(businessAccountId, token || undefined);
    const known = await WabaNumber.find({ businessAccountId }).select("phoneNumberId").lean();
    const knownIds = new Set(known.map((k) => k.phoneNumberId));
    res.json(
      list.map((p: any) => ({
        phoneNumberId: p.id,
        displayPhoneNumber: p.display_phone_number,
        verifiedName: p.verified_name,
        qualityRating: p.quality_rating,
        messagingLimit: p.messaging_limit_tier,
        nameStatus: p.name_status,
        alreadyAdded: knownIds.has(p.id)
      }))
    );
  } catch (e: any) {
    res.status(502).json({ error: e?.response?.data?.error?.message || e.message });
  }
});

/** Quality rating trend for one number. */
apiRouter.get("/numbers/:id/quality-history", async (req, res) => {
  const items = await QualitySnapshot.find({ number: req.params.id })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json(items.reverse());
});

// ════════════════════════════════════════════════════════
// ALERTS
// ════════════════════════════════════════════════════════
apiRouter.get("/alerts", async (req, res) => {
  const q: Record<string, unknown> = {};
  if (req.query.unacknowledged === "true") q.acknowledged = false;
  const items = await Alert.find(q)
    .sort({ createdAt: -1 })
    .limit(100)
    .populate("number", "label displayPhoneNumber")
    .lean();
  res.json(items);
});

apiRouter.post("/alerts/:id/ack", async (req, res) => {
  const a = await Alert.findByIdAndUpdate(
    req.params.id,
    { $set: { acknowledged: true } },
    { new: true }
  ).lean();
  res.json(a);
});

apiRouter.post("/alerts/ack-all", async (_req, res) => {
  await Alert.updateMany({ acknowledged: false }, { $set: { acknowledged: true } });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
// CONVERSATIONS & MESSAGES
// ════════════════════════════════════════════════════════
apiRouter.get("/conversations", async (req, res) => {
  const { status, number, label, assigned, unread, search } = req.query as Record<string, string>;
  const q: Record<string, unknown> = {};
  if (status) q.status = status;
  if (number) q.number = number;
  if (label) q.labels = label;
  if (assigned === "me") q.assignedTo = (req as AuthedRequest).userId;
  else if (assigned === "unassigned") q.assignedTo = { $exists: false };
  if (unread === "true") q.unreadCount = { $gt: 0 };

  if (search) {
    const contacts = await Contact.find({
      $or: [{ name: new RegExp(search, "i") }, { waId: new RegExp(search) }]
    })
      .select("_id")
      .lean();
    q.contact = { $in: contacts.map((c) => c._id) };
  }

  const items = await Conversation.find(q)
    .sort({ lastMessageAt: -1 })
    .limit(300)
    .populate("contact")
    .populate("number", "label displayPhoneNumber verifiedName qualityRating")
    .populate("assignedTo", "name email")
    .lean();

  res.json(
    items.map((c) => ({
      ...c,
      insideWindow: insideWindow(c as any),
      windowRemainingMs: windowRemainingMs(c as any)
    }))
  );
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
  for (const k of ["aiEnabled", "botPaused", "status", "unreadCount", "labels", "note"] as const) {
    if (k in (req.body || {})) allowed[k] = req.body[k];
  }
  if ("assignedTo" in (req.body || {})) {
    allowed.assignedTo = req.body.assignedTo || undefined;
  }
  if (req.body?.aiPauseMinutes) {
    allowed.aiPausedUntil = new Date(Date.now() + Number(req.body.aiPauseMinutes) * 60000);
  }
  const conv = await Conversation.findByIdAndUpdate(req.params.id, { $set: allowed }, { new: true })
    .populate("contact")
    .populate("number", "label displayPhoneNumber verifiedName qualityRating")
    .populate("assignedTo", "name email")
    .lean();
  if (conv) emit("conversation:update", conv);
  res.json(conv);
});

/** Send a manual (human) reply — blocked outside the 24h window. */
apiRouter.post("/conversations/:id/messages", async (req: AuthedRequest, res) => {
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
  const number = await WabaNumber.findById(conv.number);
  const settings = await getSettings();
  if (!number) {
    res.status(400).json({ error: "Sending number not found" });
    return;
  }
  const gate = canSendFreeform(conv, contact, number, settings);
  if (!gate.allowed) {
    res.status(409).json({ error: gate.reason, needsTemplate: !insideWindow(conv) });
    return;
  }

  const result = await wa.sendText(number, contact.waId, text);
  const msg = await Message.create({
    conversation: conv._id,
    contact: contact._id,
    number: number._id,
    direction: "out",
    author: "human",
    type: "text",
    text,
    waMessageId: result.waMessageId,
    status: result.error ? "failed" : "sent",
    error: result.error,
    sentBy: req.userId
  });
  if (!result.error) await recordNumberSend(number);

  conv.lastMessageAt = new Date();
  conv.lastMessagePreview = text.slice(0, 120);
  // human took over → hold the AI back briefly so it doesn't talk over the agent
  if (settings.pauseAiAfterHumanReplyMinutes > 0)
    conv.aiPausedUntil = new Date(Date.now() + settings.pauseAiAfterHumanReplyMinutes * 60000);
  await conv.save();

  emit("message:new", { message: msg.toObject(), conversation: conv.toObject() });
  res.json(msg);
});

/** Send an approved template into a chat (the only option outside the 24h window). */
apiRouter.post("/conversations/:id/template", async (req, res) => {
  const conv = await Conversation.findById(req.params.id).populate("contact");
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const { templateName, language, bodyParams } = req.body || {};
  const contact: any = conv.contact;
  const number = await WabaNumber.findById(conv.number);
  if (!number || !templateName) {
    res.status(400).json({ error: "templateName and a valid number are required" });
    return;
  }
  if (contact.optedOut) {
    res.status(409).json({ error: "Contact has opted out" });
    return;
  }
  const result = await wa.sendTemplate(
    number,
    contact.waId,
    templateName,
    language || "en",
    bodyParams || []
  );
  if (result.error) {
    res.status(502).json({ error: result.error });
    return;
  }
  const tpl = await Template.findOne({ name: templateName }).lean();
  const preview = (tpl?.bodyText || templateName).replace(
    /\{\{(\d+)\}\}/g,
    (_m: string, i: string) => (bodyParams || [])[Number(i) - 1] ?? `{{${i}}}`
  );
  const msg = await Message.create({
    conversation: conv._id,
    contact: contact._id,
    number: number._id,
    direction: "out",
    author: "human",
    type: "template",
    text: preview,
    waMessageId: result.waMessageId,
    status: "sent"
  });
  conv.lastMessageAt = new Date();
  conv.lastMessagePreview = preview.slice(0, 120);
  await conv.save();
  emit("message:new", { message: msg.toObject(), conversation: conv.toObject() });
  res.json(msg);
});

apiRouter.post("/conversations/:id/suggest", async (req, res) => {
  const conv = await Conversation.findById(req.params.id);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const number = await WabaNumber.findById(conv.number);
  const text = await generateReply(conv._id as any, number);
  res.json({ text });
});

apiRouter.post("/conversations/:id/classify", async (req, res) => {
  const conv = await Conversation.findById(req.params.id);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const result = await classifyConversation(conv._id as any);
  if (result) {
    conv.labels = Array.from(new Set([...conv.labels, ...result.labels]));
    await conv.save();
    emit("conversation:update", conv.toObject());
  }
  res.json(result || { error: "Classification unavailable" });
});

/** All labels in use, for filters. */
apiRouter.get("/labels", async (_req, res) => {
  const labels = await Conversation.distinct("labels");
  res.json(labels.filter(Boolean).sort());
});

// ════════════════════════════════════════════════════════
// AGENTS
// ════════════════════════════════════════════════════════
apiRouter.get("/agents", async (_req, res) => {
  res.json(await User.find({ active: true }).select("name email role").lean());
});

apiRouter.post("/agents", async (req, res) => {
  const { email, password, name, role } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: "email and password required" });
    return;
  }
  const exists = await User.findOne({ email: String(email).toLowerCase() });
  if (exists) {
    res.status(409).json({ error: "User already exists" });
    return;
  }
  const passwordHash = await bcrypt.hash(String(password), 10);
  const u = await User.create({ email, passwordHash, name: name || "Agent", role: role || "agent" });
  res.json({ id: u._id, email: u.email, name: u.name, role: u.role });
});

// ════════════════════════════════════════════════════════
// CONTACTS
// ════════════════════════════════════════════════════════
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
  const { waId, name, tags, email } = req.body || {};
  if (!waId) {
    res.status(400).json({ error: "waId (phone) required" });
    return;
  }
  const c = await Contact.findOneAndUpdate(
    { waId: String(waId).replace(/[^0-9]/g, "") },
    { $set: { name: name || "", tags: tags || [], email } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.json(c);
});

apiRouter.patch("/contacts/:id", async (req, res) => {
  const allowed: Record<string, unknown> = {};
  for (const k of ["name", "tags", "optedOut", "attributes", "email"] as const) {
    if (k in (req.body || {})) allowed[k] = req.body[k];
  }
  const c = await Contact.findByIdAndUpdate(req.params.id, { $set: allowed }, { new: true }).lean();
  res.json(c);
});

apiRouter.delete("/contacts/:id", async (req, res) => {
  await Contact.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

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

// ════════════════════════════════════════════════════════
// TEMPLATES
// ════════════════════════════════════════════════════════
apiRouter.get("/templates", async (_req, res) => {
  res.json(await Template.find().sort({ updatedAt: -1 }).lean());
});

apiRouter.post("/templates/sync", async (_req, res) => {
  const numbers = await WabaNumber.find();
  const wabaIds = Array.from(new Set(numbers.map((n) => n.businessAccountId)));
  if (!wabaIds.length && env.whatsapp.businessAccountId) wabaIds.push(env.whatsapp.businessAccountId);
  let synced = 0;
  const errors: string[] = [];
  for (const wabaId of wabaIds) {
    const token = numbers.find((n) => n.businessAccountId === wabaId)?.tokenOverride;
    try {
      const metaTemplates = await wa.fetchTemplates(wabaId, token);
      for (const t of metaTemplates) {
        const body = (t.components || []).find((c: any) => c.type === "BODY");
        const header = (t.components || []).find((c: any) => c.type === "HEADER");
        const varCount = (String(body?.text || "").match(/\{\{\d+\}\}/g) || []).length;
        await Template.findOneAndUpdate(
          { name: t.name, language: t.language },
          {
            $set: {
              category: t.category,
              status: t.status,
              bodyText: body?.text || "",
              headerText: header?.text || "",
              variableCount: varCount,
              components: t.components || [],
              metaId: t.id,
              businessAccountId: wabaId
            }
          },
          { upsert: true, setDefaultsOnInsert: true }
        );
        synced++;
      }
    } catch (e: any) {
      errors.push(`${wabaId}: ${e?.response?.data?.error?.message || e.message}`);
    }
  }
  if (errors.length && synced === 0) {
    res.status(502).json({ error: errors.join(" | ") });
    return;
  }
  res.json({ synced, errors });
});

apiRouter.post("/templates", async (req, res) => {
  const { name, language, category, bodyText, businessAccountId } = req.body || {};
  if (!name || !bodyText) {
    res.status(400).json({ error: "name and bodyText required" });
    return;
  }
  const wabaId = businessAccountId || (await WabaNumber.findOne())?.businessAccountId || env.whatsapp.businessAccountId;
  if (!wabaId) {
    res.status(400).json({ error: "No WhatsApp Business Account configured" });
    return;
  }
  try {
    await wa.createTemplate(wabaId, {
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

// ════════════════════════════════════════════════════════
// BROADCASTS
// ════════════════════════════════════════════════════════
apiRouter.get("/broadcasts", async (_req, res) => {
  res.json(await Broadcast.find().sort({ createdAt: -1 }).populate("number", "label displayPhoneNumber").lean());
});

apiRouter.post("/broadcasts", async (req, res) => {
  const { name, templateName, templateLanguage, bodyParams, audienceTags, scheduledAt, number } =
    req.body || {};
  if (!name || !templateName) {
    res.status(400).json({ error: "name and templateName required" });
    return;
  }
  const b = await Broadcast.create({
    name,
    number: number || undefined,
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
  const b = await Broadcast.findByIdAndUpdate(req.params.id, { $set: { status: "cancelled" } }, { new: true }).lean();
  res.json(b);
});

apiRouter.delete("/broadcasts/:id", async (req, res) => {
  await Broadcast.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
// WEBHOOK WORKFLOWS
// ════════════════════════════════════════════════════════
apiRouter.get("/workflows", async (_req, res) => {
  const items = await Workflow.find()
    .sort({ createdAt: -1 })
    .populate("number", "label displayPhoneNumber")
    .lean();
  res.json(items);
});

apiRouter.post("/workflows", async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.templateName || !body.number) {
    res.status(400).json({ error: "name, templateName and number are required" });
    return;
  }
  const w = await Workflow.create({
    name: body.name,
    description: body.description || "",
    key: newKey(body.name),
    secret: newSecret(),
    number: body.number,
    templateName: body.templateName,
    templateLanguage: body.templateLanguage || "en",
    headerParams: body.headerParams || [],
    bodyParams: body.bodyParams || [],
    buttonUrlParam: body.buttonUrlParam || undefined,
    phoneField: body.phoneField || "phone",
    nameField: body.nameField || "name",
    addTags: body.addTags || [],
    addLabels: body.addLabels || [],
    dedupe: body.dedupe || "none",
    delayMinutes: Number(body.delayMinutes) || 0,
    enabled: body.enabled !== false
  });
  res.json(w);
});

apiRouter.patch("/workflows/:id", async (req, res) => {
  const allowed: Record<string, unknown> = {};
  for (const k of [
    "name",
    "description",
    "number",
    "templateName",
    "templateLanguage",
    "headerParams",
    "bodyParams",
    "buttonUrlParam",
    "phoneField",
    "nameField",
    "addTags",
    "addLabels",
    "dedupe",
    "delayMinutes",
    "enabled"
  ] as const) {
    if (k in (req.body || {})) allowed[k] = req.body[k];
  }
  const w = await Workflow.findByIdAndUpdate(req.params.id, { $set: allowed }, { new: true }).lean();
  res.json(w);
});

apiRouter.delete("/workflows/:id", async (req, res) => {
  await Workflow.deleteOne({ _id: req.params.id });
  await WorkflowEvent.deleteMany({ workflow: req.params.id });
  res.json({ ok: true });
});

apiRouter.post("/workflows/:id/rotate-secret", async (req, res) => {
  const w = await Workflow.findByIdAndUpdate(
    req.params.id,
    { $set: { secret: newSecret() } },
    { new: true }
  ).lean();
  res.json(w);
});

/** Fire a workflow with a sample payload, straight from the dashboard. */
apiRouter.post("/workflows/:id/test", async (req, res) => {
  const w = await Workflow.findById(req.params.id);
  if (!w) {
    res.status(404).json({ error: "Workflow not found" });
    return;
  }
  const result = await fireWorkflow(w, req.body || {});
  res.json(result);
});

apiRouter.get("/workflows/:id/events", async (req, res) => {
  const items = await WorkflowEvent.find({ workflow: req.params.id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.json(items);
});

/** Aggregate report across all workflows. */
apiRouter.get("/workflows-report", async (_req, res) => {
  const workflows = await Workflow.find().lean();
  const totals = workflows.reduce(
    (acc, w) => {
      acc.targeted += w.stats.targeted;
      acc.processed += w.stats.processed;
      acc.sent += w.stats.sent;
      acc.delivered += w.stats.delivered;
      acc.read += w.stats.read;
      acc.failed += w.stats.failed;
      acc.skipped += w.stats.skipped;
      return acc;
    },
    { targeted: 0, processed: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 }
  );
  const recent = await WorkflowEvent.find()
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("workflow", "name")
    .lean();
  res.json({ totals, workflows, recent });
});

// ════════════════════════════════════════════════════════
// KNOWLEDGE / SETTINGS / ANALYTICS
// ════════════════════════════════════════════════════════
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
    "optOutKeywords",
    "optOutReply",
    "outsideHoursMessage",
    "businessHours",
    "maxAiRepliesPerHour",
    "maxReplyChars",
    "maxMarketingPerContactPerDay",
    "pauseAiAfterHumanReplyMinutes",
    "blockSendOnRedQuality",
    "escalateWhenUnsure",
    "frustrationAutoHandoff",
    "blockPromoWhenNotAsked",
    "maxLinksPerReply",
    "conservativeOnYellowQuality",
    "autoPauseMarketingOnDegrade",
    "escalationMessage"
  ] as const;
  for (const k of allowed) {
    if (k in (req.body || {})) (s as any)[k] = req.body[k];
  }
  await s.save();
  res.json(s);
});

apiRouter.get("/analytics/overview", async (_req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [contacts, openConvs, msgIn, msgOut, aiReplies, byDay, numbers, optedOut, needsHuman] =
    await Promise.all([
      Contact.countDocuments(),
      Conversation.countDocuments({ status: { $in: ["open", "pending"] } }),
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
      ]),
      WabaNumber.find().select("label displayPhoneNumber qualityRating messagingLimit status enabled sentToday").lean(),
      Contact.countDocuments({ optedOut: true }),
      Conversation.countDocuments({ labels: "needs-human" })
    ]);
  const automationRate = msgOut > 0 ? Math.round((aiReplies / msgOut) * 100) : 0;

  // Failure breakdown — the fastest way to spot a quality problem forming.
  const errorsRaw = await Message.aggregate([
    { $match: { status: "failed", createdAt: { $gte: since } } },
    { $group: { _id: { code: "$errorCode", error: "$error" }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 8 }
  ]);
  const errors = errorsRaw.map((e) => ({
    code: e._id.code,
    message: e._id.error || "Unknown error",
    count: e.count
  }));

  const [alerts, escalations, atRisk] = await Promise.all([
    Alert.countDocuments({ acknowledged: false }),
    Message.countDocuments({
      author: "system",
      text: /AI escalated/,
      createdAt: { $gte: since }
    }),
    Conversation.countDocuments({ labels: "at-risk" })
  ]);

  res.json({
    contacts,
    openConvs,
    msgIn,
    msgOut,
    aiReplies,
    automationRate,
    byDay,
    numbers,
    optedOut,
    needsHuman,
    errors,
    alerts,
    escalations,
    atRisk
  });
});
