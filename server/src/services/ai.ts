import axios from "axios";
import { env } from "../config/env";
import { getSettings, IWabaNumber, KnowledgeDoc, Message } from "../models";
import { POLICY_PROMPT, sanitizeReply } from "./compliance";
import { Types } from "mongoose";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Business prompt + per-number override + knowledge base + policy rules. */
async function buildSystemPrompt(number?: IWabaNumber | null): Promise<string> {
  const settings = await getSettings();
  const docs = await KnowledgeDoc.find({ enabled: true }).lean();
  let prompt = number?.systemPromptOverride?.trim() || settings.systemPrompt;

  if (number) {
    prompt += `\n\nYou are answering on the business WhatsApp number "${number.verifiedName || number.label}" (${number.displayPhoneNumber}).`;
    if (number.purpose === "otp")
      prompt +=
        " This number is used for transactional/OTP messages only — never send marketing content here.";
    if (number.purpose === "support")
      prompt +=
        " This number is a customer support line — be practical and solution-focused.";
  }

  if (docs.length) {
    prompt +=
      "\n\n## Business knowledge base\nUse the following verified business information to answer questions. Prefer it over general knowledge. If the answer isn't here, say the team will confirm.\n\n" +
      docs.map((d) => `### ${d.title}\n${d.content}`).join("\n\n");
  }

  prompt += "\n\n" + POLICY_PROMPT;
  return prompt;
}

async function buildHistory(
  conversationId: Types.ObjectId,
  limit = 20,
): Promise<ChatTurn[]> {
  const msgs = await Message.find({
    conversation: conversationId,
    author: { $ne: "system" },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  msgs.reverse();
  const turns: ChatTurn[] = [];
  for (const m of msgs) {
    if (!m.text) continue;
    const role: "user" | "assistant" =
      m.direction === "in" ? "user" : "assistant";
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += "\n" + m.text;
    else turns.push({ role, content: m.text });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

async function callClaude(
  system: string,
  turns: ChatTurn[],
  model: string,
  maxTokens: number,
): Promise<string> {
  const { data } = await axios.post(
    "https://api.anthropic.com/v1/messages",
    { model, max_tokens: maxTokens, system, messages: turns },
    {
      headers: {
        "x-api-key": env.ai.anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      timeout: 60000,
    },
  );
  return data?.content?.[0]?.text || "";
}

async function callOpenAI(
  system: string,
  turns: ChatTurn[],
  model: string,
  maxTokens: number,
): Promise<string> {
  const { data } = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model,
      max_completion_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...turns],
    },
    {
      headers: { Authorization: `Bearer ${env.ai.openaiKey}` },
      timeout: 60000,
    },
  );
  return data?.choices?.[0]?.message?.content || "";
}

/** Generate a policy-safe AI reply. Returns empty string if it can't. */
export async function generateReply(
  conversationId: Types.ObjectId,
  number?: IWabaNumber | null,
): Promise<string> {
  try {
    const settings = await getSettings();
    const system = await buildSystemPrompt(number);
    const turns = await buildHistory(conversationId);
    if (!turns.length) return "";

    let raw: string;
    if (settings.aiProvider === "openai") {
      if (!env.ai.openaiKey) throw new Error("OPENAI_API_KEY not set");
      const model = settings.aiModel.startsWith("gpt")
        ? settings.aiModel
        : "gpt-4o-mini";
      raw = await callOpenAI(system, turns, model, settings.aiMaxTokens);
    } else {
      if (!env.ai.anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");
      const model = settings.aiModel.startsWith("claude")
        ? settings.aiModel
        : "claude-sonnet-5";
      raw = await callClaude(system, turns, model, settings.aiMaxTokens);
    }
    return sanitizeReply(raw, settings);
  } catch (err: any) {
    console.error(
      "[ai] generateReply failed:",
      err?.response?.data?.error?.message || err.message,
    );
    return "";
  }
}

/** Classify a conversation for lead management (intent + urgency + suggested labels). */
export async function classifyConversation(
  conversationId: Types.ObjectId,
): Promise<{
  intent: string;
  urgency: "low" | "medium" | "high";
  labels: string[];
  summary: string;
} | null> {
  try {
    const settings = await getSettings();
    const turns = await buildHistory(conversationId, 12);
    if (!turns.length) return null;
    const transcript = turns
      .map((t) => `${t.role === "user" ? "Customer" : "Us"}: ${t.content}`)
      .join("\n");
    const system =
      'You classify WhatsApp customer conversations. Reply with ONLY compact JSON: {"intent":"new_lead|question|complaint|booking|payment|support|spam|other","urgency":"low|medium|high","labels":["short-tag"],"summary":"one sentence"}. No prose, no code fences.';
    const turnsForModel: ChatTurn[] = [{ role: "user", content: transcript }];
    const raw =
      settings.aiProvider === "openai" && env.ai.openaiKey
        ? await callOpenAI(system, turnsForModel, "gpt-4o-mini", 300)
        : await callClaude(
            system,
            turnsForModel,
            "claude-haiku-4-5-20251001",
            300,
          );
    const json = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(json);
    return {
      intent: String(parsed.intent || "other"),
      urgency: ["low", "medium", "high"].includes(parsed.urgency)
        ? parsed.urgency
        : "low",
      labels: Array.isArray(parsed.labels)
        ? parsed.labels.slice(0, 4).map(String)
        : [],
      summary: String(parsed.summary || ""),
    };
  } catch (err: any) {
    console.error("[ai] classify failed:", err.message);
    return null;
  }
}
