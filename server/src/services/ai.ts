import axios from "axios";
import { env } from "../config/env";
import { getSettings, KnowledgeDoc, Message } from "../models";
import { Types } from "mongoose";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Build the system prompt: business prompt + enabled knowledge docs. */
async function buildSystemPrompt(): Promise<string> {
  const settings = await getSettings();
  const docs = await KnowledgeDoc.find({ enabled: true }).lean();
  let prompt = settings.systemPrompt;
  if (docs.length) {
    prompt +=
      "\n\n## Business knowledge base\nUse the following verified business information to answer questions. Prefer it over general knowledge.\n\n" +
      docs.map((d) => `### ${d.title}\n${d.content}`).join("\n\n");
  }
  return prompt;
}

/** Last N turns of the conversation as alternating chat history. */
async function buildHistory(conversationId: Types.ObjectId, limit = 20): Promise<ChatTurn[]> {
  const msgs = await Message.find({ conversation: conversationId, type: "text" })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  msgs.reverse();
  const turns: ChatTurn[] = [];
  for (const m of msgs) {
    if (!m.text) continue;
    const role: "user" | "assistant" = m.direction === "in" ? "user" : "assistant";
    // merge consecutive same-role turns (APIs require alternation)
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += "\n" + m.text;
    else turns.push({ role, content: m.text });
  }
  // must start with user turn
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

async function callClaude(system: string, turns: ChatTurn[], model: string, maxTokens: number): Promise<string> {
  const { data } = await axios.post(
    "https://api.anthropic.com/v1/messages",
    { model, max_tokens: maxTokens, system, messages: turns },
    {
      headers: {
        "x-api-key": env.ai.anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      timeout: 60000
    }
  );
  return data?.content?.[0]?.text || "";
}

async function callOpenAI(system: string, turns: ChatTurn[], model: string, maxTokens: number): Promise<string> {
  const { data } = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model,
      max_completion_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...turns]
    },
    { headers: { Authorization: `Bearer ${env.ai.openaiKey}` }, timeout: 60000 }
  );
  return data?.choices?.[0]?.message?.content || "";
}

/** Generate an AI reply for a conversation. Returns empty string on failure. */
export async function generateReply(conversationId: Types.ObjectId): Promise<string> {
  try {
    const settings = await getSettings();
    const system = await buildSystemPrompt();
    const turns = await buildHistory(conversationId);
    if (!turns.length) return "";

    if (settings.aiProvider === "openai") {
      if (!env.ai.openaiKey) throw new Error("OPENAI_API_KEY not set");
      const model = settings.aiModel.startsWith("gpt") ? settings.aiModel : "gpt-4o-mini";
      return (await callOpenAI(system, turns, model, settings.aiMaxTokens)).trim();
    }
    if (!env.ai.anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");
    const model = settings.aiModel.startsWith("claude") ? settings.aiModel : "claude-sonnet-5";
    return (await callClaude(system, turns, model, settings.aiMaxTokens)).trim();
  } catch (err: any) {
    console.error("[ai] generateReply failed:", err?.response?.data || err.message);
    return "";
  }
}
