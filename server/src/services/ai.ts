/**
 * Replies come from One Mind.
 *
 * This file used to build prompts, pick a model, call OpenAI/Claude and run local "AI
 * actions". None of that lives here any more. Wabiz collects the recent messages of a
 * conversation, asks One Mind (services/brain.ts) and returns the answer. There is no model,
 * no API key and no knowledge base in this app.
 */
import { Types } from "mongoose";
import { getSettings, IContact, IWabaNumber, Message } from "../models";
import { sanitizeReply } from "./compliance";
import { askBrain, BrainAction, ChatTurn } from "./brain";

/** What One Mind decided for this turn. */
export interface AiDecision {
  kind: "text" | "none";
  text?: string;
  /** Calls One Mind booked or raised while answering (already done — for notes and labels). */
  performed?: BrainAction[];
  /** Member or lead, as One Mind saw them. */
  personType?: string;
  /** One Mind could not be reached; `text` is the saved offline line. */
  offline?: boolean;
  error?: string;
}

async function buildHistory(conversationId: Types.ObjectId, limit = 20): Promise<ChatTurn[]> {
  const msgs = await Message.find({ conversation: conversationId, author: { $ne: "system" } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  msgs.reverse();
  const turns: ChatTurn[] = [];
  for (const m of msgs) {
    if (!m.text) continue;
    const role: "user" | "assistant" = m.direction === "in" ? "user" : "assistant";
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += "\n" + m.text;
    else turns.push({ role, content: m.text });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

/** If they arrived by tapping a Meta ad, One Mind is told what the ad said. */
function referralOf(contact: IContact) {
  const r = contact.referral;
  if (!r || !r.sourceId || (!r.headline && !r.body)) return undefined;
  return { headline: r.headline || undefined, body: r.body || undefined };
}

/** Ask One Mind what to reply to the latest message in this conversation. */
export async function decide(
  conversationId: Types.ObjectId,
  _number: IWabaNumber | null | undefined,
  contact: IContact,
): Promise<AiDecision> {
  try {
    const messages = await buildHistory(conversationId);
    if (!messages.length) return { kind: "none" };
    const out = await askBrain({
      contact: { phone: contact.waId, name: contact.name || undefined, platform: "WhatsApp" },
      messages,
      context: { referral: referralOf(contact) },
    });
    const settings = await getSettings();
    const text = out.reply ? sanitizeReply(out.reply, settings) : "";
    return {
      kind: text ? "text" : "none",
      text,
      performed: out.actions,
      personType: out.personType,
      offline: out.offline,
      error: out.ok ? undefined : out.error,
    };
  } catch (err: any) {
    console.error("[ai] decide failed:", err?.message);
    return { kind: "none", error: err?.message };
  }
}

export const FOLLOWUP_SKIP = "[[SKIP]]";

/**
 * A nudge for someone who went quiet — written by One Mind from the same knowledge and
 * rules as every other reply. Returns FOLLOWUP_SKIP when One Mind judges a nudge would be
 * unwelcome, or when it cannot be reached (a follow-up is never worth a canned line).
 */
export async function generateFollowUp(
  conversationId: Types.ObjectId,
  _number: IWabaNumber | null,
  contact: IContact | null,
  _ctx?: unknown,
): Promise<string> {
  try {
    if (!contact) return FOLLOWUP_SKIP;
    const messages = await buildHistory(conversationId);
    if (!messages.length) return FOLLOWUP_SKIP;
    const out = await askBrain({
      contact: { phone: contact.waId, name: contact.name || undefined, platform: "WhatsApp" },
      messages,
      task: "followup",
    });
    if (!out.ok || out.skip || !out.reply.trim()) return FOLLOWUP_SKIP;
    return sanitizeReply(out.reply, await getSettings());
  } catch (err: any) {
    console.error("[ai] follow-up failed:", err?.message);
    return FOLLOWUP_SKIP;
  }
}
