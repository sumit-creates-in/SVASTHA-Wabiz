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
  sentToday: number;
  conversations?: number;
  unread?: number;
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
}

export interface Agent {
  _id: string;
  name: string;
  email: string;
  role: string;
}

export interface Conversation {
  _id: string;
  contact: Contact;
  number: Pick<
    WabaNumber,
    "_id" | "label" | "displayPhoneNumber" | "verifiedName" | "qualityRating"
  >;
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
  stats: {
    total: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    skipped: number;
  };
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
  businessHours: {
    start: string;
    end: string;
    timezone: string;
    enabled: boolean;
  };
  maxAiRepliesPerHour: number;
  maxReplyChars: number;
  maxMarketingPerContactPerDay: number;
  pauseAiAfterHumanReplyMinutes: number;
  blockSendOnRedQuality: boolean;
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
}
