/**
 * WhatsApp Business Platform policy guardrails.
 *
 * Meta scores every business number on a quality rating (GREEN/YELLOW/RED) driven
 * mainly by user blocks and reports. A RED number gets its messaging limit cut and
 * can end up restricted. These helpers keep the platform inside the rules:
 *
 *  1. 24-hour customer service window — free-form messages are only allowed within
 *     24h of the customer's last inbound message. Outside it, only approved templates.
 *  2. Opt-out is absolute — STOP/UNSUBSCRIBE stops everything immediately.
 *  3. Frequency caps — limits marketing messages per contact per day.
 *  4. AI rate limiting — caps replies per conversation per hour so a loop can't spam.
 *  5. Quality circuit breaker — pauses non-essential sends when a number goes RED.
 *  6. Reply hygiene — length cap, no duplicate consecutive message.
 */
import { IContact, IConversation, ISettings, IWabaNumber, Message } from "../models";

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface Decision {
  allowed: boolean;
  reason?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Is the conversation inside the 24-hour customer service window? */
export function insideWindow(conv: Pick<IConversation, "lastInboundAt">): boolean {
  if (!conv.lastInboundAt) return false;
  return Date.now() - new Date(conv.lastInboundAt).getTime() < WINDOW_MS;
}

/** Milliseconds left in the window (0 if closed). */
export function windowRemainingMs(conv: Pick<IConversation, "lastInboundAt">): number {
  if (!conv.lastInboundAt) return 0;
  const left = WINDOW_MS - (Date.now() - new Date(conv.lastInboundAt).getTime());
  return left > 0 ? left : 0;
}

/** Did the customer just opt out? */
export function isOptOut(text: string, settings: ISettings): boolean {
  const t = text.trim().toLowerCase();
  return settings.optOutKeywords.some((k) => {
    const kw = k.trim().toLowerCase();
    if (!kw) return false;
    return t === kw || t.startsWith(kw + " ") || t.endsWith(" " + kw) || t.includes(kw);
  });
}

export function isOptIn(text: string): boolean {
  const t = text.trim().toLowerCase();
  return ["start", "resume", "subscribe", "unstop"].includes(t);
}

/** Can we send a free-form (non-template) message on this conversation right now? */
export function canSendFreeform(
  conv: IConversation,
  contact: IContact,
  number: IWabaNumber,
  settings: ISettings
): Decision {
  if (contact.optedOut) return { allowed: false, reason: "Contact has opted out" };
  if (!number.enabled) return { allowed: false, reason: "Number is disabled" };
  if (!insideWindow(conv))
    return {
      allowed: false,
      reason: "Outside the 24-hour customer service window — use an approved template"
    };
  if (settings.blockSendOnRedQuality && number.qualityRating === "RED")
    return { allowed: false, reason: "Number quality is RED — free-form sending paused" };
  return { allowed: true };
}

/** Can we send a template (marketing/utility) to this contact on this number? */
export function canSendTemplate(
  contact: IContact,
  number: IWabaNumber,
  settings: ISettings,
  category: "marketing" | "utility" = "marketing"
): Decision {
  if (contact.optedOut) return { allowed: false, reason: "Contact has opted out" };
  if (!number.enabled) return { allowed: false, reason: "Number is disabled" };
  if (number.status === "RESTRICTED")
    return { allowed: false, reason: "Number is restricted by Meta" };
  if (settings.blockSendOnRedQuality && number.qualityRating === "RED" && category === "marketing")
    return { allowed: false, reason: "Number quality is RED — marketing paused to protect the number" };
  if (category === "marketing") {
    const count = contact.marketingSentDate === today() ? contact.marketingSentToday : 0;
    if (count >= settings.maxMarketingPerContactPerDay)
      return { allowed: false, reason: `Daily marketing cap reached (${settings.maxMarketingPerContactPerDay})` };
  }
  return { allowed: true };
}

/** Record a marketing template send against the contact's daily cap. */
export async function recordMarketingSend(contact: IContact): Promise<void> {
  const d = today();
  if (contact.marketingSentDate !== d) {
    contact.marketingSentDate = d;
    contact.marketingSentToday = 0;
  }
  contact.marketingSentToday += 1;
  await contact.save();
}

/** Record an outbound send against the number's daily counter. */
export async function recordNumberSend(number: IWabaNumber): Promise<void> {
  const d = today();
  if (number.sentTodayDate !== d) {
    number.sentTodayDate = d;
    number.sentToday = 0;
  }
  number.sentToday += 1;
  await number.save();
}

/** Rate-limit AI replies per conversation. Returns false when over the cap. */
export async function consumeAiQuota(conv: IConversation, settings: ISettings): Promise<Decision> {
  const now = Date.now();
  const start = conv.aiWindowStart ? new Date(conv.aiWindowStart).getTime() : 0;
  if (now - start > 60 * 60 * 1000) {
    conv.aiWindowStart = new Date();
    conv.aiRepliesLastHour = 0;
  }
  if (conv.aiRepliesLastHour >= settings.maxAiRepliesPerHour) {
    return { allowed: false, reason: "AI hourly reply cap reached for this chat" };
  }
  conv.aiRepliesLastHour += 1;
  await conv.save();
  return { allowed: true };
}

/** Is the AI temporarily paused because a human just replied? */
export function aiTemporarilyPaused(conv: IConversation): boolean {
  return !!conv.aiPausedUntil && new Date(conv.aiPausedUntil).getTime() > Date.now();
}

/** Clean up an AI reply before it goes out: trim, cap length, strip markdown noise. */
export function sanitizeReply(text: string, settings: ISettings): string {
  let out = text.trim();
  // WhatsApp has no markdown headings/links syntax — keep it plain and human
  out = out.replace(/^#{1,6}\s+/gm, "");
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1: $2");
  out = out.replace(/\*\*(.+?)\*\*/g, "*$1*"); // WhatsApp bold is single asterisk
  if (out.length > settings.maxReplyChars) {
    out = out.slice(0, settings.maxReplyChars - 1).replace(/\s+\S*$/, "") + "…";
  }
  return out;
}

/** Guard against sending the identical message twice in a row. */
export async function isDuplicateOfLast(conversationId: unknown, text: string): Promise<boolean> {
  const last = await Message.findOne({ conversation: conversationId, direction: "out" })
    .sort({ createdAt: -1 })
    .lean();
  return !!last && last.text.trim() === text.trim();
}

// ════════════════════════════════════════════════════════
// AI reply safety review
// ════════════════════════════════════════════════════════

/** Marker the model emits when it can't answer confidently. */
export const ESCALATE_TOKEN = "[[ESCALATE]]";

const PROMO_PATTERNS = [
  /\b(buy now|order now|shop now|limited time|hurry|don'?t miss|last chance|special offer|exclusive deal|discount code|act fast|only today|book now before)\b/i,
  /\b\d{1,3}%\s*(off|discount)\b/i,
  /\bfree\s+(trial|gift|offer)\b/i
];

const ASKED_ABOUT_PROMO =
  /\b(price|cost|fee|charge|offer|discount|package|plan|pay|payment|buy|purchase|enroll|enrol|join|register|book|subscription|kitna|kitne|paisa)\b/i;

const SENSITIVE_REQUEST =
  /\b(otp|one[- ]time password|cvv|card number|credit card|debit card|password|pin number|aadhaar|aadhar|social security|ssn)\b/i;

const FRUSTRATION_PATTERNS = [
  /\b(worst|useless|pathetic|terrible|horrible|disgusting|fraud|scam|cheat(ed|ing)?|fake)\b/i,
  /\b(stop messaging|stop sending|don'?t message|leave me alone|not interested|bakwas|bekar|band karo)\b/i,
  /\b(refund|complaint|consumer court|legal action|report you|reporting you)\b/i,
  /\b(angry|furious|frustrated|fed up|disappointed)\b/i
];

export interface ReviewResult {
  action: "send" | "escalate" | "block";
  text: string;
  reason?: string;
}

/**
 * Final gate before an AI reply reaches the customer.
 *
 * Unsolicited promotion and pushy language are the fastest route to blocks and
 * reports, which is what actually drives a number's quality rating down. This
 * strips or stops those before they go out.
 */
export function reviewReply(
  draft: string,
  customerMessage: string,
  settings: ISettings,
  numberQuality = "GREEN"
): ReviewResult {
  let text = draft.trim();

  if (!text) return { action: "block", text: "", reason: "Empty reply" };

  // 1. Model signalled it doesn't know — hand to a human rather than guess.
  if (text.includes(ESCALATE_TOKEN)) {
    return {
      action: "escalate",
      text: text.replace(ESCALATE_TOKEN, "").trim(),
      reason: "AI was not confident enough to answer"
    };
  }

  // 2. Never ask for sensitive credentials.
  if (SENSITIVE_REQUEST.test(text)) {
    return { action: "block", text, reason: "Reply requested sensitive data" };
  }

  // 3. Unsolicited promotion.
  if (settings.blockPromoWhenNotAsked && !ASKED_ABOUT_PROMO.test(customerMessage)) {
    const hit = PROMO_PATTERNS.find((p) => p.test(text));
    if (hit) {
      return {
        action: "block",
        text,
        reason: "Promotional language in a reply the customer didn't ask for"
      };
    }
  }

  // 4. Too many links.
  const links = text.match(/https?:\/\/\S+/g) || [];
  if (links.length > settings.maxLinksPerReply) {
    const keep = links.slice(0, settings.maxLinksPerReply);
    for (const l of links.slice(settings.maxLinksPerReply)) text = text.replace(l, "");
    text = text.replace(/\s{2,}/g, " ").trim();
    void keep;
  }

  // 5. Shouting and spammy punctuation read as spam.
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length > 25 && letters === letters.toUpperCase()) {
    text = text.charAt(0) + text.slice(1).toLowerCase();
  }
  text = text.replace(/([!?])\1{1,}/g, "$1");

  // 6. Trim emoji spam.
  const emoji = text.match(/\p{Extended_Pictographic}/gu) || [];
  if (emoji.length > 3) {
    let seen = 0;
    text = text.replace(/\p{Extended_Pictographic}/gu, (m) => (++seen <= 3 ? m : ""));
  }

  // 7. On a degraded number, be stricter: shorter replies, no promo at all.
  if (settings.conservativeOnYellowQuality && numberQuality === "YELLOW") {
    if (PROMO_PATTERNS.some((p) => p.test(text)))
      return { action: "block", text, reason: "Promotional content withheld while quality is YELLOW" };
    const cap = Math.min(settings.maxReplyChars, 450);
    if (text.length > cap) text = text.slice(0, cap - 1).replace(/\s+\S*$/, "") + "…";
  }

  return { action: "send", text: text.trim() };
}

/** Is the customer showing frustration? Frustrated customers block and report. */
export function detectFrustration(text: string): boolean {
  return FRUSTRATION_PATTERNS.some((p) => p.test(text));
}

/** Human-readable meaning for the Meta error codes that matter operationally. */
export function explainErrorCode(code?: number): string | undefined {
  if (!code) return undefined;
  const map: Record<number, string> = {
    131026: "Message undeliverable — the number may not be on WhatsApp or can't receive messages",
    131047: "Outside the 24-hour window — a template is required",
    131049:
      "Meta withheld this marketing message to protect the user experience — you are messaging this person too often",
    131051: "Unsupported message type",
    131053: "Media upload failed",
    132000: "Template parameter count doesn't match the approved template",
    132001: "Template does not exist in this language",
    132005: "Template text was edited after approval",
    132007: "Template content violates policy",
    131031: "Account is restricted or has been locked",
    130472: "User is in an experiment group and marketing messages are being limited",
    133010: "Phone number is not registered on the Cloud API"
  };
  return map[code];
}

/** Extra instructions appended to every AI system prompt. */
export const POLICY_PROMPT = `
## WhatsApp conduct rules (must follow)
- Keep replies short and conversational — WhatsApp style, ideally under 700 characters. No headings, no markdown tables, no bullet-heavy walls of text.
- Reply in the same language the customer used.
- Never send promotional or sales content unless the customer asked about it. Unsolicited promotion gets the number reported and downgraded.
- Never ask the customer to message a different number, never send multiple links, and never repeat the same message.
- If the customer sounds annoyed, asks to stop, or asks for a human, acknowledge briefly and stop — do not try to keep the conversation going.
- Never promise prices, refunds, medical outcomes, delivery dates, or anything not stated in the business knowledge base. If unsure, say the team will confirm.
- Do not request sensitive data (card numbers, passwords, OTPs, full ID numbers).
- One message per reply. Do not send follow-ups the customer did not ask for.
`.trim();
