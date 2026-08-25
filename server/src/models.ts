import mongoose, { Schema, model, Document, Types } from "mongoose";

// ── User (admin/agents) ─────────────────────────────────
export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  role: "admin" | "agent";
  active: boolean;
}
const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: "Admin" },
    role: { type: String, enum: ["admin", "agent"], default: "admin" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const User = model<IUser>("User", userSchema);

// ── WABA phone number (multi-number support) ────────────
export interface IWabaNumber extends Document {
  label: string; // friendly name, e.g. "Svastha - Marketing"
  businessAccountId: string; // WABA ID
  phoneNumberId: string;
  displayPhoneNumber: string; // +91 98800 24120
  verifiedName: string;
  tokenOverride?: string; // optional per-number system-user token
  purpose: "marketing" | "support" | "otp" | "mixed";
  enabled: boolean;
  aiEnabled: boolean;
  systemPromptOverride?: string;
  // health (synced from Meta)
  status: string; // CONNECTED / PENDING / FLAGGED / RESTRICTED
  qualityRating: string; // GREEN / YELLOW / RED / UNKNOWN
  messagingLimit: string; // TIER_1K / TIER_10K / TIER_100K / UNLIMITED
  nameStatus: string; // APPROVED / PENDING_REVIEW / DECLINED
  platformType: string;
  throughputLevel: string;
  lastSyncAt?: Date;
  lastSyncError?: string;
  // rolling counters used for quality safeguards
  sentToday: number;
  sentTodayDate: string; // YYYY-MM-DD
}
const wabaNumberSchema = new Schema<IWabaNumber>(
  {
    label: { type: String, required: true },
    businessAccountId: { type: String, required: true },
    phoneNumberId: { type: String, required: true, unique: true, index: true },
    displayPhoneNumber: { type: String, default: "" },
    verifiedName: { type: String, default: "" },
    tokenOverride: String,
    purpose: {
      type: String,
      enum: ["marketing", "support", "otp", "mixed"],
      default: "mixed",
    },
    enabled: { type: Boolean, default: true },
    aiEnabled: { type: Boolean, default: true },
    systemPromptOverride: String,
    status: { type: String, default: "UNKNOWN" },
    qualityRating: { type: String, default: "UNKNOWN" },
    messagingLimit: { type: String, default: "UNKNOWN" },
    nameStatus: { type: String, default: "UNKNOWN" },
    platformType: { type: String, default: "" },
    throughputLevel: { type: String, default: "" },
    lastSyncAt: Date,
    lastSyncError: String,
    sentToday: { type: Number, default: 0 },
    sentTodayDate: { type: String, default: "" },
  },
  { timestamps: true },
);
export const WabaNumber = model<IWabaNumber>("WabaNumber", wabaNumberSchema);

// ── Contact ─────────────────────────────────────────────
export interface IContact extends Document {
  waId: string;
  name: string;
  email?: string;
  tags: string[];
  attributes: Map<string, string>;
  optedOut: boolean;
  optedOutAt?: Date;
  optInSource?: string;
  lastSeenAt?: Date;
  marketingSentToday: number;
  marketingSentDate: string;
}
const contactSchema = new Schema<IContact>(
  {
    waId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: "" },
    email: String,
    tags: { type: [String], default: [], index: true },
    attributes: { type: Map, of: String, default: {} },
    optedOut: { type: Boolean, default: false },
    optedOutAt: Date,
    optInSource: String,
    lastSeenAt: Date,
    marketingSentToday: { type: Number, default: 0 },
    marketingSentDate: { type: String, default: "" },
  },
  { timestamps: true },
);
export const Contact = model<IContact>("Contact", contactSchema);

// ── Conversation ────────────────────────────────────────
export interface IConversation extends Document {
  contact: Types.ObjectId;
  number: Types.ObjectId; // which WABA number this chat belongs to
  status: "open" | "pending" | "closed";
  aiEnabled: boolean; // AI auto-reply for this chat
  botPaused: boolean; // pause automated flows (templates/sequences)
  aiPausedUntil?: Date; // temporary pause after human takeover
  labels: string[];
  note: string;
  unreadCount: number;
  lastMessageAt: Date;
  lastInboundAt?: Date; // drives the 24-hour customer service window
  lastMessagePreview: string;
  assignedTo?: Types.ObjectId;
  aiRepliesLastHour: number;
  aiWindowStart?: Date;
}
const conversationSchema = new Schema<IConversation>(
  {
    contact: {
      type: Schema.Types.ObjectId,
      ref: "Contact",
      required: true,
      index: true,
    },
    number: {
      type: Schema.Types.ObjectId,
      ref: "WabaNumber",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "pending", "closed"],
      default: "open",
    },
    aiEnabled: { type: Boolean, default: true },
    botPaused: { type: Boolean, default: false },
    aiPausedUntil: Date,
    labels: { type: [String], default: [], index: true },
    note: { type: String, default: "" },
    unreadCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastInboundAt: Date,
    lastMessagePreview: { type: String, default: "" },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    aiRepliesLastHour: { type: Number, default: 0 },
    aiWindowStart: Date,
  },
  { timestamps: true },
);
conversationSchema.index({ contact: 1, number: 1 }, { unique: true });
export const Conversation = model<IConversation>(
  "Conversation",
  conversationSchema,
);

// ── Message ─────────────────────────────────────────────
export interface IMessage extends Document {
  conversation: Types.ObjectId;
  contact: Types.ObjectId;
  number: Types.ObjectId;
  direction: "in" | "out";
  author: "contact" | "ai" | "human" | "system" | "workflow" | "broadcast";
  type: string;
  text: string;
  mediaId?: string;
  mediaUrl?: string;
  waMessageId?: string;
  status: "received" | "queued" | "sent" | "delivered" | "read" | "failed";
  error?: string;
  sentBy?: Types.ObjectId;
}
const messageSchema = new Schema<IMessage>(
  {
    conversation: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    contact: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    number: { type: Schema.Types.ObjectId, ref: "WabaNumber" },
    direction: { type: String, enum: ["in", "out"], required: true },
    author: {
      type: String,
      enum: ["contact", "ai", "human", "system", "workflow", "broadcast"],
      required: true,
    },
    type: { type: String, default: "text" },
    text: { type: String, default: "" },
    mediaId: String,
    mediaUrl: String,
    waMessageId: { type: String, index: true },
    status: { type: String, default: "received" },
    error: String,
    sentBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
export const Message = model<IMessage>("Message", messageSchema);

// ── Template ────────────────────────────────────────────
export interface ITemplate extends Document {
  name: string;
  language: string;
  category: string;
  status: string;
  bodyText: string;
  headerText: string;
  variableCount: number;
  components: unknown[];
  metaId?: string;
  businessAccountId?: string;
}
const templateSchema = new Schema<ITemplate>(
  {
    name: { type: String, required: true },
    language: { type: String, default: "en" },
    category: { type: String, default: "MARKETING" },
    status: { type: String, default: "UNKNOWN" },
    bodyText: { type: String, default: "" },
    headerText: { type: String, default: "" },
    variableCount: { type: Number, default: 0 },
    components: { type: [Schema.Types.Mixed], default: [] },
    metaId: String,
    businessAccountId: String,
  },
  { timestamps: true },
);
templateSchema.index({ name: 1, language: 1 }, { unique: true });
export const Template = model<ITemplate>("Template", templateSchema);

// ── Broadcast campaign ──────────────────────────────────
export interface IBroadcast extends Document {
  name: string;
  number?: Types.ObjectId;
  templateName: string;
  templateLanguage: string;
  bodyParams: string[];
  audienceTags: string[];
  scheduledAt?: Date;
  status:
    | "draft"
    | "scheduled"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
  stats: {
    total: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    skipped: number;
  };
}
const broadcastSchema = new Schema<IBroadcast>(
  {
    name: { type: String, required: true },
    number: { type: Schema.Types.ObjectId, ref: "WabaNumber" },
    templateName: { type: String, required: true },
    templateLanguage: { type: String, default: "en" },
    bodyParams: { type: [String], default: [] },
    audienceTags: { type: [String], default: [] },
    scheduledAt: Date,
    status: { type: String, default: "draft" },
    stats: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      read: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);
export const Broadcast = model<IBroadcast>("Broadcast", broadcastSchema);

export interface IBroadcastRecipient extends Document {
  broadcast: Types.ObjectId;
  contact: Types.ObjectId;
  waMessageId?: string;
  status: "pending" | "sent" | "delivered" | "read" | "failed" | "skipped";
  error?: string;
}
const broadcastRecipientSchema = new Schema<IBroadcastRecipient>(
  {
    broadcast: {
      type: Schema.Types.ObjectId,
      ref: "Broadcast",
      required: true,
      index: true,
    },
    contact: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    waMessageId: { type: String, index: true },
    status: { type: String, default: "pending" },
    error: String,
  },
  { timestamps: true },
);
export const BroadcastRecipient = model<IBroadcastRecipient>(
  "BroadcastRecipient",
  broadcastRecipientSchema,
);

// ── Webhook workflow (event → approved template) ────────
export interface IWorkflow extends Document {
  name: string;
  description: string;
  key: string; // URL path segment
  secret: string; // shared secret header/query
  number: Types.ObjectId;
  templateName: string;
  templateLanguage: string;
  /** Each entry is a string template, e.g. "{{name}}" or "Hello {{course.title}}" */
  headerParams: string[];
  bodyParams: string[];
  buttonUrlParam?: string;
  /** Dot-path in the incoming payload that holds the phone number */
  phoneField: string;
  nameField: string;
  addTags: string[];
  addLabels: string[];
  dedupe: "none" | "once_per_contact" | "once_per_day";
  delayMinutes: number;
  enabled: boolean;
  verified: boolean; // true once a real payload has fired successfully
  lastFiredAt?: Date;
  lastError?: string;
  stats: {
    targeted: number;
    processed: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    skipped: number;
  };
}
const workflowSchema = new Schema<IWorkflow>(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    key: { type: String, required: true, unique: true, index: true },
    secret: { type: String, required: true },
    number: { type: Schema.Types.ObjectId, ref: "WabaNumber", required: true },
    templateName: { type: String, required: true },
    templateLanguage: { type: String, default: "en" },
    headerParams: { type: [String], default: [] },
    bodyParams: { type: [String], default: [] },
    buttonUrlParam: String,
    phoneField: { type: String, default: "phone" },
    nameField: { type: String, default: "name" },
    addTags: { type: [String], default: [] },
    addLabels: { type: [String], default: [] },
    dedupe: {
      type: String,
      enum: ["none", "once_per_contact", "once_per_day"],
      default: "none",
    },
    delayMinutes: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
    verified: { type: Boolean, default: false },
    lastFiredAt: Date,
    lastError: String,
    stats: {
      targeted: { type: Number, default: 0 },
      processed: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      read: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);
export const Workflow = model<IWorkflow>("Workflow", workflowSchema);

export interface IWorkflowEvent extends Document {
  workflow: Types.ObjectId;
  contact?: Types.ObjectId;
  waId: string;
  payload: unknown;
  waMessageId?: string;
  status: "received" | "sent" | "delivered" | "read" | "failed" | "skipped";
  error?: string;
  runAt?: Date;
}
const workflowEventSchema = new Schema<IWorkflowEvent>(
  {
    workflow: {
      type: Schema.Types.ObjectId,
      ref: "Workflow",
      required: true,
      index: true,
    },
    contact: { type: Schema.Types.ObjectId, ref: "Contact" },
    waId: { type: String, index: true },
    payload: Schema.Types.Mixed,
    waMessageId: { type: String, index: true },
    status: { type: String, default: "received" },
    error: String,
    runAt: Date,
  },
  { timestamps: true },
);
export const WorkflowEvent = model<IWorkflowEvent>(
  "WorkflowEvent",
  workflowEventSchema,
);

// ── Knowledge base ──────────────────────────────────────
export interface IKnowledgeDoc extends Document {
  title: string;
  content: string;
  enabled: boolean;
}
const knowledgeSchema = new Schema<IKnowledgeDoc>(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const KnowledgeDoc = model<IKnowledgeDoc>(
  "KnowledgeDoc",
  knowledgeSchema,
);

// ── Settings (singleton) ────────────────────────────────
export interface ISettings extends Document {
  businessName: string;
  aiProvider: "claude" | "openai";
  aiModel: string;
  systemPrompt: string;
  aiGlobalEnabled: boolean;
  aiMaxTokens: number;
  handoffKeywords: string[];
  optOutKeywords: string[];
  optOutReply: string;
  outsideHoursMessage: string;
  businessHours: {
    start: string;
    end: string;
    timezone: string;
    enabled: boolean;
  };
  // ── quality guardrails ──
  maxAiRepliesPerHour: number;
  maxReplyChars: number;
  maxMarketingPerContactPerDay: number;
  pauseAiAfterHumanReplyMinutes: number;
  blockSendOnRedQuality: boolean;
}
const settingsSchema = new Schema<ISettings>(
  {
    // Accept any _id type so legacy docs with a string _id (e.g. "bot") don't
    // cause a cast validation error when Mongoose tries to hydrate them.
    _id: { type: Schema.Types.Mixed },
    businessName: { type: String, default: "SVASTHA" },
    aiProvider: { type: String, enum: ["claude", "openai"], default: "claude" },
    aiModel: { type: String, default: "claude-sonnet-5" },
    systemPrompt: {
      type: String,
      default:
        "You are a helpful, warm customer support assistant for our business on WhatsApp. Answer briefly (WhatsApp style, 1-3 short paragraphs max), in the customer's language. If you don't know something, say you'll check with the team. Never invent prices or commitments.",
    },
    aiGlobalEnabled: { type: Boolean, default: true },
    aiMaxTokens: { type: Number, default: 500 },
    handoffKeywords: {
      type: [String],
      default: ["talk to human", "agent", "representative"],
    },
    optOutKeywords: {
      type: [String],
      default: [
        "stop",
        "unsubscribe",
        "opt out",
        "optout",
        "do not message",
        "band karo",
      ],
    },
    optOutReply: {
      type: String,
      default:
        "You've been unsubscribed and won't receive further messages from us. Reply START anytime to resume.",
    },
    outsideHoursMessage: { type: String, default: "" },
    businessHours: {
      start: { type: String, default: "09:00" },
      end: { type: String, default: "21:00" },
      timezone: { type: String, default: "Asia/Kolkata" },
      enabled: { type: Boolean, default: false },
    },
    maxAiRepliesPerHour: { type: Number, default: 20 },
    maxReplyChars: { type: Number, default: 900 },
    maxMarketingPerContactPerDay: { type: Number, default: 2 },
    pauseAiAfterHumanReplyMinutes: { type: Number, default: 30 },
    blockSendOnRedQuality: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const Settings = model<ISettings>("Settings", settingsSchema);

export async function getSettings(): Promise<ISettings> {
  // Prefer a document whose _id is a proper ObjectId; skip legacy string-id
  // docs (e.g. _id: "bot") that were inserted by older app versions.
  let s = await Settings.findOne({ _id: { $type: "objectId" } });
  if (!s) {
    // Fallback: try any document so existing string-id settings aren't lost
    s = await Settings.findOne({ _id: { $not: { $type: "objectId" } } });
    if (s) return s; // tolerate it if it's the only one
    s = await Settings.create({});
  }
  return s;
}

/** Drop legacy single-number unique index on conversations if it exists. */
export async function runMigrations(): Promise<void> {
  try {
    const indexes = await Conversation.collection.indexes();
    const legacy = indexes.find((i) => i.name === "contact_1" && i.unique);
    if (legacy) {
      await Conversation.collection.dropIndex("contact_1");
      console.log("[db] dropped legacy conversations.contact_1 unique index");
    }
  } catch {
    /* collection may not exist yet */
  }
}

export { mongoose };
