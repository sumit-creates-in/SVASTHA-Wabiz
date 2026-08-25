export interface WabaNumber {
  _id: string;
  label: string;
  businessAccountId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  purpose: "marketing" | "support" | "otp" | "mixed";
  enabled: boolean;
  aiEnabled: boolean;
  systemPromptOverride?: string;
  status: string;
  qualityRating: string;
  messagingLimit: string;
  nameStatus: string;
  throughputLevel: string;
  lastSyncAt?: string;
  lastSyncError?: string;
  lastWebhookAt?: string;
  sentToday: number;
  conversations?: number;
  unread?: number;
}

export interface SubscribedApp {
  id: string;
  name: string;
  link?: string;
}

export interface SubscriptionStatus {
  appId: string | null;
  apps: SubscribedApp[];
  otherApps: SubscribedApp[];
  subscribed: boolean;
  error?: string;
}

export interface DiscoveredNumber {
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: string;
  messagingLimit: string;
  nameStatus: string;
  alreadyAdded: boolean;
}

export interface Contact {
  _id: string;
  waId: string;
  name: string;
  email?: string;
  tags: string[];
  optedOut: boolean;
  lastSeenAt?: string;
  createdAt?: string;
  /** True when this viewer only sees masked digits. */
  masked?: boolean;
  isCustomer?: boolean;
  externalId?: string;
  customerData?: Record<string, string>;
}

export interface Agent {
  _id: string;
  name: string;
  email: string;
  role: string;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "agent";
  permissions: string[];
  maskPhoneNumbers: boolean;
  allowedNumbers: string[];
}

export interface PermissionDef {
  key: string;
  label: string;
  group: string;
  description: string;
}

export interface TeamMember {
  _id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "agent";
  active: boolean;
  permissions: string[];
  effectivePermissions: string[];
  allowedNumbers: { _id: string; label: string; displayPhoneNumber: string }[];
  maskPhoneNumbers: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

export interface ActionField {
  key: string;
  label: string;
  description: string;
  type: "string" | "number" | "date" | "enum" | "boolean";
  options?: string[];
  required: boolean;
}

export interface AiAction {
  _id: string;
  name: string;
  displayName: string;
  description: string;
  triggerExamples: string[];
  audience: "any" | "lead" | "customer";
  enabled: boolean;
  numbers: { _id: string; label: string }[] | string[];
  fields: ActionField[];
  webhookUrl: string;
  webhookMethod: "POST" | "PUT";
  webhookSecret?: string;
  payloadTemplate?: string;
  confirmationMessage: string;
  addTags: string[];
  addLabels: string[];
  createsLead: boolean;
  createsTicket: boolean;
  handoffAfter: boolean;
  stats: { triggered: number; succeeded: number; failed: number };
}

export interface ActionRun {
  _id: string;
  actionName: string;
  contact?: { name: string; waId: string };
  input: Record<string, string>;
  status: "pending" | "succeeded" | "failed";
  responseStatus?: number;
  error?: string;
  createdAt: string;
}

export interface Lead {
  _id: string;
  contact: Contact;
  interest: string;
  source: string;
  qualification: Record<string, string>;
  score: number;
  status: "new" | "qualified" | "call_booked" | "converted" | "lost";
  assignedTo?: { _id: string; name: string };
  number?: { label: string };
  note: string;
  createdAt: string;
}

export interface Ticket {
  _id: string;
  contact: Contact;
  reference: string;
  subject: string;
  detail: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "in_progress" | "resolved" | "closed";
  assignedTo?: { _id: string; name: string };
  createdAt: string;
}

export interface Conversation {
  _id: string;
  contact: Contact;
  number: Pick<WabaNumber, "_id" | "label" | "displayPhoneNumber" | "verifiedName" | "qualityRating">;
  status: "open" | "pending" | "closed";
  aiEnabled: boolean;
  botPaused: boolean;
  aiPausedUntil?: string;
  labels: string[];
  note: string;
  unreadCount: number;
  lastMessageAt: string;
  lastInboundAt?: string;
  lastMessagePreview: string;
  assignedTo?: Agent;
  insideWindow?: boolean;
  windowRemainingMs?: number;
}

export interface Message {
  _id: string;
  conversation: string;
  direction: "in" | "out";
  author: "contact" | "ai" | "human" | "system" | "workflow" | "broadcast";
  type: string;
  text: string;
  status: string;
  error?: string;
  createdAt: string;
}

export interface Template {
  _id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  bodyText: string;
  variableCount: number;
}

export interface Broadcast {
  _id: string;
  name: string;
  templateName: string;
  templateLanguage: string;
  bodyParams: string[];
  audienceTags: string[];
  scheduledAt?: string;
  status: string;
  stats: { total: number; sent: number; delivered: number; read: number; failed: number; skipped: number };
  createdAt: string;
}

export interface Workflow {
  _id: string;
  name: string;
  description: string;
  key: string;
  secret: string;
  number: { _id: string; label: string; displayPhoneNumber: string } | string;
  templateName: string;
  templateLanguage: string;
  headerParams: string[];
  bodyParams: string[];
  phoneField: string;
  nameField: string;
  addTags: string[];
  addLabels: string[];
  dedupe: "none" | "once_per_contact" | "once_per_day";
  delayMinutes: number;
  enabled: boolean;
  verified: boolean;
  lastFiredAt?: string;
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

export interface WorkflowEvent {
  _id: string;
  waId: string;
  status: string;
  error?: string;
  createdAt: string;
  workflow?: { name: string };
}

export interface KnowledgeDoc {
  _id: string;
  title: string;
  content: string;
  enabled: boolean;
}

export interface Settings {
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
  maxAiRepliesPerHour: number;
  maxReplyChars: number;
  maxMarketingPerContactPerDay: number;
  pauseAiAfterHumanReplyMinutes: number;
  blockSendOnRedQuality: boolean;
  escalateWhenUnsure: boolean;
  frustrationAutoHandoff: boolean;
  blockPromoWhenNotAsked: boolean;
  maxLinksPerReply: number;
  conservativeOnYellowQuality: boolean;
  autoPauseMarketingOnDegrade: boolean;
  escalationMessage: string;
  customerLookupEnabled: boolean;
  customerLookupUrl: string;
  customerLookupMethod: "GET" | "POST";
  customerLookupHeaders: Record<string, string>;
  customerLookupCacheMinutes: number;
  customerFoundPath: string;
  customerDataPath: string;
}

export interface Alert {
  _id: string;
  level: "info" | "warning" | "critical";
  title: string;
  detail: string;
  acknowledged: boolean;
  createdAt: string;
  number?: { label: string; displayPhoneNumber: string };
}

export interface QualitySnapshot {
  _id: string;
  qualityRating: string;
  messagingLimit: string;
  status: string;
  changed: boolean;
  createdAt: string;
}

export interface AnalyticsOverview {
  contacts: number;
  openConvs: number;
  msgIn: number;
  msgOut: number;
  aiReplies: number;
  automationRate: number;
  optedOut: number;
  needsHuman: number;
  numbers: WabaNumber[];
  byDay: { _id: { day: string; direction: "in" | "out" }; count: number }[];
  errors: { code?: number; message: string; count: number }[];
  alerts: number;
  escalations: number;
  atRisk: number;
}
