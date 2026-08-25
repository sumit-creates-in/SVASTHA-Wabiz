import mongoose, { Schema, model, Document, Types } from "mongoose";

// ── User (admin/agents) ─────────────────────────────────
export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  role: "admin" | "manager" | "agent";
  active: boolean;
  /** Granular permission keys. Admins implicitly have all of them. */
  permissions: string[];
  /** WhatsApp numbers this user may see. Empty = all numbers. */
  allowedNumbers: Types.ObjectId[];
  /** Hide most digits of customer phone numbers from this user. */
  maskPhoneNumbers: boolean;
  lastLoginAt?: Date;
}
const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: "Admin" },
    role: { type: String, enum: ["admin", "manager", "agent"], default: "agent" },
    active: { type: Boolean, default: true },
    permissions: { type: [String], default: [] },
    allowedNumbers: { type: [Schema.Types.ObjectId], ref: "WabaNumber", default: [] },
    maskPhoneNumbers: { type: Boolean, default: false },
    lastLoginAt: Date
  },
  { timestamps: true }
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
  /** Last time Meta actually delivered a webhook for this number. */
  lastWebhookAt?: Date;
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
    purpose: { type: String, enum: ["marketing", "support", "otp", "mixed"], default: "mixed" },
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
    lastWebhookAt: Date,
    sentToday: { type: Number, default: 0 },
    sentTodayDate: { type: String, default: "" }
  },
  { timestamps: true }
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
  // ── Synced from the Svastha app ──
  isCustomer: boolean;
  externalId?: string;
  customerData: Map<string, string>;
  customerSyncedAt?: Date;
  customerLookupError?: string;
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
    isCustomer: { type: Boolean, default: false, index: true },
    externalId: { type: String, index: true },
    customerData: { type: Map, of: String, default: {} },
    customerSyncedAt: Date,
    customerLookupError: String
  },
  { timestamps: true }
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
    contact: { type: Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    number: { type: Schema.Types.ObjectId, ref: "WabaNumber", required: true, index: true },
    status: { type: String, enum: ["open", "pending", "closed"], default: "open" },
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
    aiWindowStart: Date
  },
  { timestamps: true }
);
conversationSchema.index({ contact: 1, number: 1 }, { unique: true });
export const Conversation = model<IConversation>("Conversation", conversationSchema);

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
  errorCode?: number;
  sentBy?: Types.ObjectId;
}
const messageSchema = new Schema<IMessage>(
  {
    conversation: { type: Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    contact: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    number: { type: Schema.Types.ObjectId, ref: "WabaNumber" },
    direction: { type: String, enum: ["in", "out"], required: true },
    author: {
      type: String,
      enum: ["contact", "ai", "human", "system", "workflow", "broadcast"],
      required: true
    },
    type: { type: String, default: "text" },
    text: { type: String, default: "" },
    mediaId: String,
    mediaUrl: String,
    waMessageId: { type: String, index: true },
    status: { type: String, default: "received" },
    error: String,
    errorCode: { type: Number, index: true },
    sentBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
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
    businessAccountId: String
  },
  { timestamps: true }
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
  status: "draft" | "scheduled" | "running" | "completed" | "failed" | "cancelled";
  stats: { total: number; sent: number; delivered: number; read: number; failed: number; skipped: number };
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
      skipped: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
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
    broadcast: { type: Schema.Types.ObjectId, ref: "Broadcast", required: true, index: true },
    contact: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    waMessageId: { type: String, index: true },
    status: { type: String, default: "pending" },
    error: String
  },
  { timestamps: true }
);
export const BroadcastRecipient = model<IBroadcastRecipient>("BroadcastRecipient", broadcastRecipientSchema);

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
    dedupe: { type: String, enum: ["none", "once_per_contact", "once_per_day"], default: "none" },
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
      skipped: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
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
    workflow: { type: Schema.Types.ObjectId, ref: "Workflow", required: true, index: true },
    contact: { type: Schema.Types.ObjectId, ref: "Contact" },
    waId: { type: String, index: true },
    payload: Schema.Types.Mixed,
    waMessageId: { type: String, index: true },
    status: { type: String, default: "received" },
    error: String,
    runAt: Date
  },
  { timestamps: true }
);
export const WorkflowEvent = model<IWorkflowEvent>("WorkflowEvent", workflowEventSchema);

// ════════════════════════════════════════════════════════
// AI ACTIONS — things the AI can DO, not just say.
// Each action becomes a tool the model can call once it has collected the
// required fields from the customer. Firing it posts to your webhook.
// ════════════════════════════════════════════════════════
export interface IActionField {
  key: string;
  label: string;
  description: string;
  type: "string" | "number" | "date" | "enum" | "boolean";
  options?: string[];
  required: boolean;
}

export interface IAiAction extends Document {
  name: string; // machine name, e.g. book_sales_call
  displayName: string;
  /** Tells the model WHEN to use this. The most important field. */
  description: string;
  triggerExamples: string[];
  audience: "any" | "lead" | "customer";
  enabled: boolean;
  numbers: Types.ObjectId[]; // empty = all numbers
  fields: IActionField[];
  // outbound webhook
  webhookUrl: string;
  webhookMethod: "POST" | "PUT";
  webhookHeaders: Map<string, string>;
  webhookSecret?: string;
  /** Optional JSON template. Blank = send the standard envelope. */
  payloadTemplate?: string;
  // after firing
  confirmationMessage: string;
  addTags: string[];
  addLabels: string[];
  createsLead: boolean;
  createsTicket: boolean;
  handoffAfter: boolean;
  stats: { triggered: number; succeeded: number; failed: number };
}

const actionFieldSchema = new Schema<IActionField>(
  {
    key: { type: String, required: true },
    label: { type: String, default: "" },
    description: { type: String, default: "" },
    type: { type: String, enum: ["string", "number", "date", "enum", "boolean"], default: "string" },
    options: { type: [String], default: [] },
    required: { type: Boolean, default: true }
  },
  { _id: false }
);

const aiActionSchema = new Schema<IAiAction>(
  {
    name: { type: String, required: true, unique: true },
    displayName: { type: String, required: true },
    description: { type: String, required: true },
    triggerExamples: { type: [String], default: [] },
    audience: { type: String, enum: ["any", "lead", "customer"], default: "any" },
    enabled: { type: Boolean, default: true },
    numbers: { type: [Schema.Types.ObjectId], ref: "WabaNumber", default: [] },
    fields: { type: [actionFieldSchema], default: [] },
    webhookUrl: { type: String, required: true },
    webhookMethod: { type: String, enum: ["POST", "PUT"], default: "POST" },
    webhookHeaders: { type: Map, of: String, default: {} },
    webhookSecret: String,
    payloadTemplate: String,
    confirmationMessage: { type: String, default: "Done — our team will be in touch shortly." },
    addTags: { type: [String], default: [] },
    addLabels: { type: [String], default: [] },
    createsLead: { type: Boolean, default: false },
    createsTicket: { type: Boolean, default: false },
    handoffAfter: { type: Boolean, default: false },
    stats: {
      triggered: { type: Number, default: 0 },
      succeeded: { type: Number, default: 0 },
      failed: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);
export const AiAction = model<IAiAction>("AiAction", aiActionSchema);

export interface IActionRun extends Document {
  action: Types.ObjectId;
  actionName: string;
  contact: Types.ObjectId;
  conversation: Types.ObjectId;
  number?: Types.ObjectId;
  input: Map<string, string>;
  payload: unknown;
  responseStatus?: number;
  responseBody?: string;
  status: "pending" | "succeeded" | "failed";
  error?: string;
  attempts: number;
}
const actionRunSchema = new Schema<IActionRun>(
  {
    action: { type: Schema.Types.ObjectId, ref: "AiAction", required: true, index: true },
    actionName: String,
    contact: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    conversation: { type: Schema.Types.ObjectId, ref: "Conversation" },
    number: { type: Schema.Types.ObjectId, ref: "WabaNumber" },
    input: { type: Map, of: String, default: {} },
    payload: Schema.Types.Mixed,
    responseStatus: Number,
    responseBody: String,
    status: { type: String, default: "pending", index: true },
    error: String,
    attempts: { type: Number, default: 0 }
  },
  { timestamps: true }
);
export const ActionRun = model<IActionRun>("ActionRun", actionRunSchema);

// ── Lead ────────────────────────────────────────────────
export interface ILead extends Document {
  contact: Types.ObjectId;
  conversation?: Types.ObjectId;
  number?: Types.ObjectId;
  interest: string;
  source: string;
  qualification: Map<string, string>;
  score: number;
  status: "new" | "qualified" | "call_booked" | "converted" | "lost";
  assignedTo?: Types.ObjectId;
  note: string;
}
const leadSchema = new Schema<ILead>(
  {
    contact: { type: Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    conversation: { type: Schema.Types.ObjectId, ref: "Conversation" },
    number: { type: Schema.Types.ObjectId, ref: "WabaNumber" },
    interest: { type: String, default: "" },
    source: { type: String, default: "whatsapp" },
    qualification: { type: Map, of: String, default: {} },
    score: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["new", "qualified", "call_booked", "converted", "lost"],
      default: "new",
      index: true
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    note: { type: String, default: "" }
  },
  { timestamps: true }
);
export const Lead = model<ILead>("Lead", leadSchema);

// ── Support ticket ──────────────────────────────────────
export interface ITicket extends Document {
  contact: Types.ObjectId;
  conversation?: Types.ObjectId;
  reference: string;
  subject: string;
  detail: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "in_progress" | "resolved" | "closed";
  externalId?: string;
  assignedTo?: Types.ObjectId;
}
const ticketSchema = new Schema<ITicket>(
  {
    contact: { type: Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    conversation: { type: Schema.Types.ObjectId, ref: "Conversation" },
    reference: { type: String, required: true, unique: true },
    subject: { type: String, default: "" },
    detail: { type: String, default: "" },
    category: { type: String, default: "general" },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed"],
      default: "open",
      index: true
    },
    externalId: String,
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);
export const Ticket = model<ITicket>("Ticket", ticketSchema);

// ── Quality snapshots (trend tracking per number) ───────
export interface IQualitySnapshot extends Document {
  number: Types.ObjectId;
  qualityRating: string;
  messagingLimit: string;
  status: string;
  changed: boolean; // true when this differs from the previous snapshot
}
const qualitySnapshotSchema = new Schema<IQualitySnapshot>(
  {
    number: { type: Schema.Types.ObjectId, ref: "WabaNumber", required: true, index: true },
    qualityRating: String,
    messagingLimit: String,
    status: String,
    changed: { type: Boolean, default: false }
  },
  { timestamps: true }
);
export const QualitySnapshot = model<IQualitySnapshot>("QualitySnapshot", qualitySnapshotSchema);

// ── Alerts (quality degradation, policy events) ─────────
export interface IAlert extends Document {
  level: "info" | "warning" | "critical";
  title: string;
  detail: string;
  number?: Types.ObjectId;
  acknowledged: boolean;
}
const alertSchema = new Schema<IAlert>(
  {
    level: { type: String, enum: ["info", "warning", "critical"], default: "info" },
    title: { type: String, required: true },
    detail: { type: String, default: "" },
    number: { type: Schema.Types.ObjectId, ref: "WabaNumber" },
    acknowledged: { type: Boolean, default: false }
  },
  { timestamps: true }
);
export const Alert = model<IAlert>("Alert", alertSchema);

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
    enabled: { type: Boolean, default: true }
  },
  { timestamps: true }
);
export const KnowledgeDoc = model<IKnowledgeDoc>("KnowledgeDoc", knowledgeSchema);

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
  businessHours: { start: string; end: string; timezone: string; enabled: boolean };
  // ── quality guardrails ──
  maxAiRepliesPerHour: number;
  maxReplyChars: number;
  maxMarketingPerContactPerDay: number;
  pauseAiAfterHumanReplyMinutes: number;
  blockSendOnRedQuality: boolean;
  // ── AI safety layer ──
  escalateWhenUnsure: boolean;
  frustrationAutoHandoff: boolean;
  blockPromoWhenNotAsked: boolean;
  maxLinksPerReply: number;
  conservativeOnYellowQuality: boolean;
  autoPauseMarketingOnDegrade: boolean;
  escalationMessage: string;
  // ── Svastha app customer lookup ──
  customerLookupEnabled: boolean;
  customerLookupUrl: string; // {{phone}} is substituted
  customerLookupMethod: "GET" | "POST";
  customerLookupHeaders: Map<string, string>;
  customerLookupCacheMinutes: number;
  /** Dot-path in the response that indicates an existing customer. */
  customerFoundPath: string;
  /** Dot-path to the object of customer fields to show the AI. */
  customerDataPath: string;
}
const settingsSchema = new Schema<ISettings>(
  {
    // Accept any _id type so legacy documents with a string _id (e.g. "bot"),
    // written by older versions, can still be read and migrated instead of
    // throwing a cast error. Credit: Sachin's "fixes id issue".
    _id: { type: Schema.Types.Mixed },
    businessName: { type: String, default: "SVASTHA" },
    aiProvider: { type: String, enum: ["claude", "openai"], default: "claude" },
    aiModel: { type: String, default: "claude-sonnet-5" },
    systemPrompt: {
      type: String,
      default:
        "You are a helpful, warm customer support assistant for our business on WhatsApp. Answer briefly (WhatsApp style, 1-3 short paragraphs max), in the customer's language. If you don't know something, say you'll check with the team. Never invent prices or commitments."
    },
    aiGlobalEnabled: { type: Boolean, default: true },
    aiMaxTokens: { type: Number, default: 500 },
    handoffKeywords: { type: [String], default: ["talk to human", "agent", "representative"] },
    optOutKeywords: {
      type: [String],
      default: ["stop", "unsubscribe", "opt out", "optout", "do not message", "band karo"]
    },
    optOutReply: {
      type: String,
      default:
        "You've been unsubscribed and won't receive further messages from us. Reply START anytime to resume."
    },
    outsideHoursMessage: { type: String, default: "" },
    businessHours: {
      start: { type: String, default: "09:00" },
      end: { type: String, default: "21:00" },
      timezone: { type: String, default: "Asia/Kolkata" },
      enabled: { type: Boolean, default: false }
    },
    maxAiRepliesPerHour: { type: Number, default: 20 },
    maxReplyChars: { type: Number, default: 900 },
    maxMarketingPerContactPerDay: { type: Number, default: 2 },
    pauseAiAfterHumanReplyMinutes: { type: Number, default: 30 },
    blockSendOnRedQuality: { type: Boolean, default: true },
    escalateWhenUnsure: { type: Boolean, default: true },
    frustrationAutoHandoff: { type: Boolean, default: true },
    blockPromoWhenNotAsked: { type: Boolean, default: true },
    maxLinksPerReply: { type: Number, default: 1 },
    conservativeOnYellowQuality: { type: Boolean, default: true },
    autoPauseMarketingOnDegrade: { type: Boolean, default: true },
    escalationMessage: {
      type: String,
      default:
        "Let me check that with the team and get back to you shortly — I don't want to give you the wrong information."
    },
    customerLookupEnabled: { type: Boolean, default: false },
    customerLookupUrl: { type: String, default: "" },
    customerLookupMethod: { type: String, enum: ["GET", "POST"], default: "GET" },
    customerLookupHeaders: { type: Map, of: String, default: {} },
    customerLookupCacheMinutes: { type: Number, default: 30 },
    customerFoundPath: { type: String, default: "found" },
    customerDataPath: { type: String, default: "customer" }
  },
  { timestamps: true }
);
export const Settings = model<ISettings>("Settings", settingsSchema);

/**
 * Settings live in exactly ONE document with a fixed _id.
 * Without this, concurrent boots could create two documents and saves would
 * appear to "revert" — you'd write to one and read back the other.
 */
export const SETTINGS_ID = new mongoose.Types.ObjectId("000000000000000000000001");

export async function getSettings(): Promise<ISettings> {
  const s = await Settings.findOneAndUpdate(
    { _id: SETTINGS_ID },
    { $setOnInsert: { _id: SETTINGS_ID } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return s as ISettings;
}

export async function runMigrations(): Promise<void> {
  // 1. Drop the legacy single-number unique index on conversations.
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

  // 2. Consolidate duplicate settings documents onto the singleton _id.
  //    Older versions could leave several settings documents behind — including
  //    one with a string _id such as "bot" — so a save would write to one
  //    document while the next read returned another. That looked exactly like
  //    settings silently reverting after a refresh.
  try {
    const strays = await Settings.find({ _id: { $ne: SETTINGS_ID } })
      .sort({ updatedAt: -1 })
      .lean();
    if (strays.length) {
      const newest = strays[0];
      const { _id, createdAt, updatedAt, __v, ...fields } = newest as Record<string, unknown>;
      await Settings.findOneAndUpdate({ _id: SETTINGS_ID }, { $set: fields }, { upsert: true });
      await Settings.deleteMany({ _id: { $ne: SETTINGS_ID } });
      console.log(`[db] consolidated ${strays.length} stray settings document(s) into the singleton`);
    }
  } catch (e: any) {
    console.warn("[db] settings migration skipped:", e.message);
  }
}

export { mongoose };
