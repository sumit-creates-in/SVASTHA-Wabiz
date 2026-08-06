import mongoose, { Schema, model, Document, Types } from "mongoose";

// ── User (admin/agents) ─────────────────────────────────
export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  role: "admin" | "agent";
}
const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: "Admin" },
    role: { type: String, enum: ["admin", "agent"], default: "admin" }
  },
  { timestamps: true }
);
export const User = model<IUser>("User", userSchema);

// ── Contact ─────────────────────────────────────────────
export interface IContact extends Document {
  waId: string; // phone number in international format, e.g. 919876543210
  name: string;
  tags: string[];
  attributes: Map<string, string>;
  optedOut: boolean;
  lastSeenAt?: Date;
}
const contactSchema = new Schema<IContact>(
  {
    waId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: "" },
    tags: { type: [String], default: [], index: true },
    attributes: { type: Map, of: String, default: {} },
    optedOut: { type: Boolean, default: false },
    lastSeenAt: Date
  },
  { timestamps: true }
);
export const Contact = model<IContact>("Contact", contactSchema);

// ── Conversation ────────────────────────────────────────
export interface IConversation extends Document {
  contact: Types.ObjectId;
  status: "open" | "closed";
  aiEnabled: boolean; // AI auto-reply on/off for this chat
  unreadCount: number;
  lastMessageAt: Date;
  lastMessagePreview: string;
  assignedTo?: Types.ObjectId;
}
const conversationSchema = new Schema<IConversation>(
  {
    contact: { type: Schema.Types.ObjectId, ref: "Contact", required: true, unique: true },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    aiEnabled: { type: Boolean, default: true },
    unreadCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: { type: String, default: "" },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);
export const Conversation = model<IConversation>("Conversation", conversationSchema);

// ── Message ─────────────────────────────────────────────
export interface IMessage extends Document {
  conversation: Types.ObjectId;
  contact: Types.ObjectId;
  direction: "in" | "out";
  author: "contact" | "ai" | "human" | "system";
  type: string; // text, image, audio, video, document, sticker, location, template, interactive
  text: string;
  mediaId?: string;
  mediaUrl?: string;
  waMessageId?: string;
  status: "received" | "queued" | "sent" | "delivered" | "read" | "failed";
  error?: string;
}
const messageSchema = new Schema<IMessage>(
  {
    conversation: { type: Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    contact: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    direction: { type: String, enum: ["in", "out"], required: true },
    author: { type: String, enum: ["contact", "ai", "human", "system"], required: true },
    type: { type: String, default: "text" },
    text: { type: String, default: "" },
    mediaId: String,
    mediaUrl: String,
    waMessageId: { type: String, index: true },
    status: { type: String, default: "received" },
    error: String
  },
  { timestamps: true }
);
export const Message = model<IMessage>("Message", messageSchema);

// ── Template (mirror of Meta message templates) ─────────
export interface ITemplate extends Document {
  name: string;
  language: string;
  category: string;
  status: string;
  bodyText: string;
  components: unknown[];
  metaId?: string;
}
const templateSchema = new Schema<ITemplate>(
  {
    name: { type: String, required: true },
    language: { type: String, default: "en" },
    category: { type: String, default: "MARKETING" },
    status: { type: String, default: "UNKNOWN" },
    bodyText: { type: String, default: "" },
    components: { type: [Schema.Types.Mixed], default: [] },
    metaId: String
  },
  { timestamps: true }
);
templateSchema.index({ name: 1, language: 1 }, { unique: true });
export const Template = model<ITemplate>("Template", templateSchema);

// ── Broadcast campaign ──────────────────────────────────
export interface IBroadcast extends Document {
  name: string;
  templateName: string;
  templateLanguage: string;
  bodyParams: string[];
  audienceTags: string[]; // empty = all contacts
  scheduledAt?: Date;
  status: "draft" | "scheduled" | "running" | "completed" | "failed" | "cancelled";
  stats: { total: number; sent: number; delivered: number; read: number; failed: number };
}
const broadcastSchema = new Schema<IBroadcast>(
  {
    name: { type: String, required: true },
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
      failed: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);
export const Broadcast = model<IBroadcast>("Broadcast", broadcastSchema);

// Per-recipient delivery record for a broadcast
export interface IBroadcastRecipient extends Document {
  broadcast: Types.ObjectId;
  contact: Types.ObjectId;
  waMessageId?: string;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
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

// ── Knowledge base document (fed to the AI) ─────────────
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
  handoffKeywords: string[]; // customer phrases that pause AI and flag human
  outsideHoursMessage: string;
  businessHours: { start: string; end: string; timezone: string; enabled: boolean };
}
const settingsSchema = new Schema<ISettings>(
  {
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
    outsideHoursMessage: { type: String, default: "" },
    businessHours: {
      start: { type: String, default: "09:00" },
      end: { type: String, default: "21:00" },
      timezone: { type: String, default: "Asia/Kolkata" },
      enabled: { type: Boolean, default: false }
    }
  },
  { timestamps: true }
);
export const Settings = model<ISettings>("Settings", settingsSchema);

export async function getSettings(): Promise<ISettings> {
  let s = await Settings.findOne();
  if (!s) s = await Settings.create({});
  return s;
}

export { mongoose };
