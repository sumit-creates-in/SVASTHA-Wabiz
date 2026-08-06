export interface Contact {
  _id: string;
  waId: string;
  name: string;
  tags: string[];
  optedOut: boolean;
  lastSeenAt?: string;
  createdAt?: string;
}

export interface Conversation {
  _id: string;
  contact: Contact;
  status: "open" | "closed";
  aiEnabled: boolean;
  unreadCount: number;
  lastMessageAt: string;
  lastMessagePreview: string;
}

export interface Message {
  _id: string;
  conversation: string;
  direction: "in" | "out";
  author: "contact" | "ai" | "human" | "system";
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
  stats: { total: number; sent: number; delivered: number; read: number; failed: number };
  createdAt: string;
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
  outsideHoursMessage: string;
  businessHours: { start: string; end: string; timezone: string; enabled: boolean };
}

export interface AnalyticsOverview {
  contacts: number;
  openConvs: number;
  msgIn: number;
  msgOut: number;
  aiReplies: number;
  automationRate: number;
  byDay: { _id: { day: string; direction: "in" | "out" }; count: number }[];
}
