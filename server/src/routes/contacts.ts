/**
 * Contacts: list, search, filter, create, edit, bulk actions, import, export.
 *
 * Every phone number that enters through here passes through normalizePhone(),
 * so a bad spreadsheet produces a clear rejection instead of a wrong contact.
 */
import { Router } from "express";
import crypto from "crypto";
import {
  ActionRun,
  BroadcastRecipient,
  Contact,
  Conversation,
  FollowUpJob,
  Lead,
  Message,
  Ticket,
} from "../models";
import { AuthedRequest, requirePermission } from "../middleware/auth";
import { maskContact, maskWaId, Viewer } from "../permissions";
import { INVALID_WAID_QUERY, normalizePhone } from "../services/phone";

export const contactsRouter = Router();

const MAX_IMPORT_ROWS = 50000;

// ── Helpers ─────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanTags(input: unknown): string[] {
  const list = Array.isArray(input)
    ? input
    : String(input ?? "")
        .split(/[,;|]/);
  return Array.from(
    new Set(list.map((t) => String(t).trim()).filter((t) => t && t.length <= 60)),
  );
}

export interface ContactFilter {
  search?: string;
  tag?: string;
  status?: string; // all | active | optedOut | customer | lead | fromAd | invalid
  source?: string;
  batch?: string;
  ids?: string[];
}

/** One filter definition shared by list, export and bulk actions. */
function buildQuery(f: ContactFilter, viewer?: Viewer): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  if (f.ids?.length) and.push({ _id: { $in: f.ids } });

  const search = (f.search || "").trim();
  if (search) {
    const or: Record<string, unknown>[] = [
      { name: new RegExp(escapeRegex(search), "i") },
      { email: new RegExp(escapeRegex(search), "i") },
    ];
    // A masked viewer mustn't be able to probe numbers digit by digit.
    const digits = search.replace(/[^0-9]/g, "");
    if (digits.length >= 3 && !viewer?.maskPhoneNumbers) {
      or.push({ waId: new RegExp(escapeRegex(digits)) });
    }
    and.push({ $or: or });
  }

  if (f.tag) and.push({ tags: f.tag });
  if (f.source) and.push({ source: f.source });
  if (f.batch) and.push({ importBatch: f.batch });

  switch (f.status) {
    case "active":
      and.push({ optedOut: { $ne: true } });
      break;
    case "optedOut":
      and.push({ optedOut: true });
      break;
    case "customer":
      and.push({ isCustomer: true });
      break;
    case "lead":
      and.push({ isCustomer: { $ne: true } });
      break;
    case "fromAd":
      and.push({ "referral.sourceId": { $exists: true, $ne: null } });
      break;
    case "invalid":
      and.push(INVALID_WAID_QUERY);
      break;
  }

  return and.length ? { $and: and } : {};
}

function filterFrom(src: Record<string, any>): ContactFilter {
  return {
    search: src.search ? String(src.search) : undefined,
    tag: src.tag ? String(src.tag) : undefined,
    status: src.status ? String(src.status) : undefined,
    source: src.source ? String(src.source) : undefined,
    batch: src.batch ? String(src.batch) : undefined,
    ids: Array.isArray(src.ids)
      ? src.ids.map(String)
      : typeof src.ids === "string" && src.ids
        ? src.ids.split(",")
        : undefined,
  };
}

/** Delete contacts and everything that hangs off them, so nothing is orphaned. */
async function deleteContactsCascade(ids: unknown[]): Promise<number> {
  if (!ids.length) return 0;
  const convs = await Conversation.find({ contact: { $in: ids } }).select("_id").lean();
  const convIds = convs.map((c) => c._id);
  await Promise.all([
    Message.deleteMany({ conversation: { $in: convIds } }),
    FollowUpJob.deleteMany({ contact: { $in: ids } }),
    BroadcastRecipient.deleteMany({ contact: { $in: ids } }),
    Lead.deleteMany({ contact: { $in: ids } }),
    Ticket.deleteMany({ contact: { $in: ids } }),
    ActionRun.deleteMany({ contact: { $in: ids } }),
  ]);
  await Conversation.deleteMany({ _id: { $in: convIds } });
  const res = await Contact.deleteMany({ _id: { $in: ids } });
  return res.deletedCount || 0;
}

const SORTABLE = new Set(["name", "createdAt", "updatedAt", "lastSeenAt", "waId"]);

// ── List & stats ────────────────────────────────────────

contactsRouter.get("/", requirePermission("contacts.view"), async (req: AuthedRequest, res) => {
  const viewer = req.viewer!;
  const q = buildQuery(filterFrom(req.query as any), viewer);
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const limit = Math.min(500, Math.max(10, parseInt(String(req.query.limit || "50"), 10) || 50));
  const sortField = SORTABLE.has(String(req.query.sort)) ? String(req.query.sort) : "createdAt";
  const dir = req.query.dir === "asc" ? 1 : -1;

  const [items, total] = await Promise.all([
    Contact.find(q)
      .sort({ [sortField]: dir, _id: dir })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("-customerData")
      .lean(),
    Contact.countDocuments(q),
  ]);

  res.json({
    items: items.map((c) => maskContact(c as any, viewer)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    limit,
  });
});

contactsRouter.get("/stats", requirePermission("contacts.view"), async (_req, res) => {
  const [total, optedOut, customers, fromAd, invalid] = await Promise.all([
    Contact.estimatedDocumentCount(),
    Contact.countDocuments({ optedOut: true }),
    Contact.countDocuments({ isCustomer: true }),
    Contact.countDocuments({ "referral.sourceId": { $exists: true, $ne: null } }),
    Contact.countDocuments(INVALID_WAID_QUERY),
  ]);
  res.json({ total, optedOut, customers, leads: total - customers, fromAd, invalid });
});

contactsRouter.get("/tags", requirePermission("contacts.view"), async (_req, res) => {
  const rows = await Contact.aggregate([
    { $unwind: "$tags" },
    { $group: { _id: "$tags", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
  res.json(rows.map((r) => ({ tag: r._id, count: r.count })));
});

// ── Phone check (live validation in forms) ──────────────

contactsRouter.post("/validate-phone", requirePermission("contacts.view"), async (req, res) => {
  const result = normalizePhone(req.body?.phone, req.body?.defaultCountryCode ?? "91");
  let existing: { _id: unknown; name: string } | null = null;
  if (result.ok) {
    existing = await Contact.findOne({ waId: result.waId }).select("name").lean();
  }
  res.json({ ...result, existing });
});

// ── Tags management ─────────────────────────────────────

contactsRouter.post("/tags/rename", requirePermission("contacts.edit"), async (req, res) => {
  const from = String(req.body?.from || "").trim();
  const to = String(req.body?.to || "").trim();
  if (!from || !to) {
    res.status(400).json({ error: "Both the old and new tag names are required" });
    return;
  }
  // Two steps so contacts that already have both tags don't end up with duplicates.
  await Contact.updateMany({ tags: from }, { $addToSet: { tags: to } });
  const r = await Contact.updateMany({ tags: from }, { $pull: { tags: from } });
  res.json({ updated: r.modifiedCount });
});

contactsRouter.post("/tags/delete", requirePermission("contacts.edit"), async (req, res) => {
  const tag = String(req.body?.tag || "").trim();
  if (!tag) {
    res.status(400).json({ error: "tag is required" });
    return;
  }
  const r = await Contact.updateMany({ tags: tag }, { $pull: { tags: tag } });
  res.json({ updated: r.modifiedCount });
});

// ── Bulk actions ────────────────────────────────────────

contactsRouter.post("/bulk", requirePermission("contacts.edit"), async (req: AuthedRequest, res) => {
  const { action, tags } = req.body || {};
  const filter = filterFrom(req.body?.filter || {});
  if (!filter.ids?.length && !req.body?.allMatching) {
    res.status(400).json({ error: "Select some contacts first" });
    return;
  }
  const q = buildQuery(filter, req.viewer);
  const tagList = cleanTags(tags);

  switch (action) {
    case "addTags": {
      if (!tagList.length) {
        res.status(400).json({ error: "Enter at least one tag" });
        return;
      }
      const r = await Contact.updateMany(q, { $addToSet: { tags: { $each: tagList } } });
      res.json({ affected: r.modifiedCount });
      return;
    }
    case "removeTags": {
      if (!tagList.length) {
        res.status(400).json({ error: "Enter at least one tag" });
        return;
      }
      const r = await Contact.updateMany(q, { $pull: { tags: { $in: tagList } } });
      res.json({ affected: r.modifiedCount });
      return;
    }
    case "optOut": {
      const r = await Contact.updateMany(q, { $set: { optedOut: true, optedOutAt: new Date() } });
      res.json({ affected: r.modifiedCount });
      return;
    }
    case "optIn": {
      const r = await Contact.updateMany(q, { $set: { optedOut: false }, $unset: { optedOutAt: 1 } });
      res.json({ affected: r.modifiedCount });
      return;
    }
    case "delete": {
      const ids = (await Contact.find(q).select("_id").lean()).map((c) => c._id);
      const deleted = await deleteContactsCascade(ids);
      res.json({ affected: deleted });
      return;
    }
    default:
      res.status(400).json({ error: `Unknown action "${action}"` });
  }
});

// ── Import ──────────────────────────────────────────────

interface ImportRow {
  phone?: unknown;
  name?: unknown;
  email?: unknown;
  tags?: unknown;
  notes?: unknown;
  attributes?: Record<string, unknown>;
}

interface AnalysedRow {
  row: number; // 1-based row number in the user's file (header = row 1)
  raw: string;
  name: string;
  status: "new" | "update" | "invalid" | "duplicate";
  waId?: string;
  reason?: string;
  warning?: string;
  fixed?: string;
  input: ImportRow;
}

async function analyseRows(
  rows: ImportRow[],
  defaultCountryCode: string,
): Promise<{ analysed: AnalysedRow[]; existing: Set<string> }> {
  const seen = new Map<string, number>();
  const analysed: AnalysedRow[] = rows.map((r, i) => {
    const rowNum = i + 2;
    const raw = r.phone === undefined || r.phone === null ? "" : String(r.phone);
    const result = normalizePhone(r.phone, defaultCountryCode);
    const base = { row: rowNum, raw, name: String(r.name ?? "").trim(), input: r };
    if (!result.ok) return { ...base, status: "invalid" as const, reason: result.reason };
    const firstRow = seen.get(result.waId!);
    if (firstRow) {
      return {
        ...base,
        status: "duplicate" as const,
        waId: result.waId,
        reason: `Same number as row ${firstRow} — only the first is imported`,
      };
    }
    seen.set(result.waId!, rowNum);
    return {
      ...base,
      status: "new" as const,
      waId: result.waId,
      warning: result.warning,
      fixed: result.fixed,
    };
  });

  const waIds = analysed.filter((a) => a.waId && a.status === "new").map((a) => a.waId!);
  const existing = new Set<string>();
  for (let i = 0; i < waIds.length; i += 5000) {
    const found = await Contact.find({ waId: { $in: waIds.slice(i, i + 5000) } })
      .select("waId")
      .lean();
    found.forEach((c) => existing.add(c.waId));
  }
  analysed.forEach((a) => {
    if (a.status === "new" && existing.has(a.waId!)) a.status = "update";
  });
  return { analysed, existing };
}

function summarise(analysed: AnalysedRow[]) {
  const count = (s: AnalysedRow["status"]) => analysed.filter((a) => a.status === s).length;
  return {
    total: analysed.length,
    new: count("new"),
    update: count("update"),
    invalid: count("invalid"),
    duplicate: count("duplicate"),
    corrected: analysed.filter((a) => a.fixed).length,
    warnings: analysed.filter((a) => a.warning).length,
    scientificNotation: analysed.filter((a) => a.reason?.startsWith("Excel turned")).length,
  };
}

function readRows(body: any): ImportRow[] | string {
  const rows = body?.rows;
  if (!Array.isArray(rows)) return "No rows were sent";
  if (!rows.length) return "The file has no data rows";
  if (rows.length > MAX_IMPORT_ROWS)
    return `That file has ${rows.length.toLocaleString()} rows — split it into files of ${MAX_IMPORT_ROWS.toLocaleString()} or fewer`;
  return rows;
}

/** Dry run: tell the user exactly what will happen before anything is written. */
contactsRouter.post("/import/preview", requirePermission("contacts.edit"), async (req, res) => {
  const rows = readRows(req.body);
  if (typeof rows === "string") {
    res.status(400).json({ error: rows });
    return;
  }
  const { analysed } = await analyseRows(rows, String(req.body?.defaultCountryCode ?? "91"));
  const strip = (a: AnalysedRow) => ({ ...a, input: undefined });
  res.json({
    summary: summarise(analysed),
    problems: analysed
      .filter((a) => a.status === "invalid" || a.status === "duplicate" || a.warning)
      .slice(0, 2000)
      .map(strip),
    sample: analysed.filter((a) => a.status === "new" || a.status === "update").slice(0, 25).map(strip),
  });
});

contactsRouter.post("/import", requirePermission("contacts.edit"), async (req, res) => {
  const rows = readRows(req.body);
  if (typeof rows === "string") {
    res.status(400).json({ error: rows });
    return;
  }
  const mode: "merge" | "skip" | "overwrite" = ["merge", "skip", "overwrite"].includes(req.body?.mode)
    ? req.body.mode
    : "merge";
  const extraTags = cleanTags(req.body?.addTags);
  const batch = `imp_${new Date().toISOString().slice(0, 10)}_${crypto.randomBytes(3).toString("hex")}`;

  const { analysed } = await analyseRows(rows, String(req.body?.defaultCountryCode ?? "91"));

  const ops: any[] = [];
  let skippedExisting = 0;

  for (const a of analysed) {
    if (a.status !== "new" && a.status !== "update") continue;
    if (a.status === "update" && mode === "skip") {
      skippedExisting++;
      continue;
    }

    const r = a.input;
    const name = String(r.name ?? "").trim();
    const email = String(r.email ?? "").trim();
    const notes = String(r.notes ?? "").trim();
    const tags = Array.from(new Set([...cleanTags(r.tags), ...extraTags]));
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.attributes || {})) {
      const key = String(k).trim().replace(/[.$]/g, "_").slice(0, 60);
      const val = v === null || v === undefined ? "" : String(v).trim();
      if (key && val) attrs[key] = val.slice(0, 1000);
    }

    const set: Record<string, unknown> = { importBatch: batch };
    // waId comes from the upsert filter, so it doesn't need repeating here.
    const setOnInsert: Record<string, unknown> = { source: "import" };

    if (mode === "overwrite") {
      set.name = name;
      if (email) set.email = email;
      if (notes) set.notes = notes;
      set.tags = tags;
      for (const [k, v] of Object.entries(attrs)) set[`attributes.${k}`] = v;
    } else {
      // merge: fill in what we have without blanking what's already there
      if (name) set.name = name;
      else setOnInsert.name = "";
      if (email) set.email = email;
      if (notes) set.notes = notes;
      for (const [k, v] of Object.entries(attrs)) set[`attributes.${k}`] = v;
    }

    const update: Record<string, unknown> = { $set: set, $setOnInsert: setOnInsert };
    if (mode !== "overwrite" && tags.length) update.$addToSet = { tags: { $each: tags } };

    ops.push({ updateOne: { filter: { waId: a.waId }, update, upsert: true } });
  }

  let created = 0;
  let updated = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const r = await Contact.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    created += r.upsertedCount;
    updated += r.matchedCount;
  }

  const summary = summarise(analysed);
  res.json({
    batch,
    created,
    updated,
    skippedExisting,
    invalid: summary.invalid,
    duplicate: summary.duplicate,
    problems: analysed
      .filter((a) => a.status === "invalid" || a.status === "duplicate")
      .slice(0, 5000)
      .map((a) => ({ row: a.row, raw: a.raw, name: a.name, reason: a.reason })),
  });
});

// ── Export ──────────────────────────────────────────────

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

contactsRouter.get("/export", requirePermission("contacts.export"), async (req: AuthedRequest, res) => {
  const viewer = req.viewer!;
  const q = buildQuery(filterFrom(req.query as any), viewer);
  const contacts = await Contact.find(q).sort({ createdAt: -1 }).limit(100000).lean();

  // Collect every custom attribute key so each gets its own column.
  const attrKeys = new Set<string>();
  contacts.forEach((c: any) => Object.keys(c.attributes || {}).forEach((k) => attrKeys.add(k)));
  const attrList = Array.from(attrKeys).sort();

  const header = [
    "phone",
    "name",
    "email",
    "tags",
    "opted_out",
    "customer",
    "source",
    "notes",
    "created_at",
    "last_seen_at",
    ...attrList,
  ];
  const rows = contacts.map((c: any) => {
    const phone = viewer.maskPhoneNumbers ? maskWaId(c.waId) : `+${c.waId}`;
    return [
      phone,
      c.name || "",
      viewer.maskPhoneNumbers ? "" : c.email || "",
      (c.tags || []).join("; "),
      c.optedOut ? "yes" : "no",
      c.isCustomer ? "yes" : "no",
      c.source || "",
      c.notes || "",
      c.createdAt ? new Date(c.createdAt).toISOString() : "",
      c.lastSeenAt ? new Date(c.lastSeenAt).toISOString() : "",
      ...attrList.map((k) => (c.attributes || {})[k] ?? ""),
    ];
  });

  if (req.query.format === "json") {
    res.json({ header, rows });
    return;
  }

  // BOM so Excel opens UTF-8 names (Hindi etc.) correctly.
  const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(csv);
});

// ── Single contact ──────────────────────────────────────

contactsRouter.post("/", requirePermission("contacts.edit"), async (req, res) => {
  const { phone, waId, name, email, tags, notes, defaultCountryCode } = req.body || {};
  const result = normalizePhone(phone ?? waId, defaultCountryCode ?? "91");
  if (!result.ok) {
    res.status(400).json({ error: result.reason });
    return;
  }
  const existing = await Contact.findOne({ waId: result.waId }).lean();
  if (existing) {
    res.status(409).json({
      error: `This number already belongs to ${existing.name || "an existing contact"}`,
      existingId: existing._id,
    });
    return;
  }
  const c = await Contact.create({
    waId: result.waId,
    name: String(name || "").trim(),
    email: email ? String(email).trim() : undefined,
    tags: cleanTags(tags),
    notes: String(notes || ""),
    source: "manual",
  });
  res.json(c);
});

contactsRouter.get("/:id", requirePermission("contacts.view"), async (req: AuthedRequest, res) => {
  const viewer = req.viewer!;
  const c = await Contact.findById(req.params.id).lean();
  if (!c) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  const [conversations, leads, tickets] = await Promise.all([
    Conversation.find({ contact: c._id })
      .sort({ lastMessageAt: -1 })
      .populate("number", "label displayPhoneNumber")
      .select("number status labels lastMessageAt lastMessagePreview")
      .lean(),
    Lead.find({ contact: c._id }).sort({ createdAt: -1 }).limit(10).lean(),
    Ticket.find({ contact: c._id }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  res.json({ contact: maskContact(c as any, viewer), conversations, leads, tickets });
});

contactsRouter.patch("/:id", requirePermission("contacts.edit"), async (req, res) => {
  const b = req.body || {};
  const set: Record<string, unknown> = {};

  if ("phone" in b) {
    const result = normalizePhone(b.phone, b.defaultCountryCode ?? "91");
    if (!result.ok) {
      res.status(400).json({ error: result.reason });
      return;
    }
    const clash = await Contact.findOne({ waId: result.waId, _id: { $ne: req.params.id } }).lean();
    if (clash) {
      res.status(409).json({ error: `That number already belongs to ${clash.name || "another contact"}` });
      return;
    }
    set.waId = result.waId;
  }
  if ("name" in b) set.name = String(b.name || "").trim();
  if ("email" in b) set.email = String(b.email || "").trim();
  if ("notes" in b) set.notes = String(b.notes || "");
  if ("tags" in b) set.tags = cleanTags(b.tags);
  if ("attributes" in b && b.attributes && typeof b.attributes === "object") {
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.attributes)) {
      const key = String(k).trim().replace(/[.$]/g, "_");
      if (key) attrs[key] = String(v ?? "");
    }
    set.attributes = attrs;
  }
  if ("optedOut" in b) {
    set.optedOut = !!b.optedOut;
    if (b.optedOut) set.optedOutAt = new Date();
  }

  const c = await Contact.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).lean();
  if (!c) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  res.json(c);
});

contactsRouter.delete("/:id", requirePermission("contacts.edit"), async (req, res) => {
  const deleted = await deleteContactsCascade([req.params.id]);
  res.json({ ok: deleted > 0 });
});
