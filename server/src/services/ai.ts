import axios from "axios";
import { env } from "../config/env";
import {
  getSettings,
  IContact,
  IWabaNumber,
  KnowledgeDoc,
  Message,
} from "../models";
import { ESCALATE_TOKEN, POLICY_PROMPT, sanitizeReply } from "./compliance";
import { actionsFor, toToolSchema, toOpenAiTool } from "./actions";
import { customerContextBlock } from "./customer";
import { Types } from "mongoose";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** What the model decided to do with this turn. */
export interface AiDecision {
  kind: "text" | "action" | "none";
  text?: string;
  actionName?: string;
  args?: Record<string, unknown>;
}

async function buildSystemPrompt(
  number?: IWabaNumber | null,
  contact?: IContact | null,
): Promise<string> {
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

  if (contact) prompt += customerContextBlock(contact);

  if (docs.length) {
    prompt +=
      "\n\n## Business knowledge base\nUse the following verified business information to answer questions. Prefer it over general knowledge. If the answer isn't here, say the team will confirm.\n\n" +
      docs.map((d) => `### ${d.title}\n${d.content}`).join("\n\n");
  }

  prompt += "\n\n" + POLICY_PROMPT;

  if (settings.escalateWhenUnsure) {
    prompt += `\n\n## When you are not sure
If the answer is not in the business knowledge base above, and no action covers the request, do NOT guess and do NOT give a generic non-answer. Reply with exactly this marker and nothing else:
${ESCALATE_TOKEN}
A human will take over. Guessing damages trust and gets the number reported — escalating costs nothing.`;
  }

  if (
    settings.conservativeOnYellowQuality &&
    number &&
    number.qualityRating === "YELLOW"
  ) {
    prompt +=
      "\n\n## Caution mode\nThis number's quality rating has dropped. Keep replies unusually short and strictly factual. Do not mention offers, promotions or prices unless the customer asked directly.";
  }

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

// ── Provider calls ──────────────────────────────────────

async function callClaude(
  system: string,
  turns: ChatTurn[],
  model: string,
  maxTokens: number,
  tools?: unknown[],
): Promise<AiDecision> {
  const { data } = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model,
      max_tokens: maxTokens,
      system,
      messages: turns,
      ...(tools && tools.length ? { tools } : {}),
    },
    {
      headers: {
        "x-api-key": env.ai.anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      timeout: 60000,
    },
  );

  const blocks: any[] = data?.content || [];
  const toolUse = blocks.find((b) => b.type === "tool_use");
  if (toolUse) {
    return {
      kind: "action",
      actionName: toolUse.name,
      args: toolUse.input || {},
    };
  }
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text ? { kind: "text", text } : { kind: "none" };
}

async function callOpenAI(
  system: string,
  turns: ChatTurn[],
  model: string,
  maxTokens: number,
  tools?: unknown[],
): Promise<AiDecision> {
  // Some newer/custom OpenAI models (e.g. o-series, gpt-5.x-luna) do not
  // support function tools via /v1/chat/completions. If tools are requested,
  // try with tools first; on a 400 error mentioning tools/reasoning_effort,
  // automatically retry without tools so the chat reply still goes through.
  const buildBody = (withTools: boolean) => ({
    model,
    max_completion_tokens: maxTokens,
    messages: [{ role: "system", content: system }, ...turns],
    ...(withTools && tools && tools.length
      ? { tools, tool_choice: "auto" }
      : {}),
  });

  let data: any;
  try {
    const resp = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      buildBody(true),
      {
        headers: { Authorization: `Bearer ${env.ai.openaiKey}` },
        timeout: 60000,
      },
    );
    data = resp.data;
  } catch (err: any) {
    const msg: string = err?.response?.data?.error?.message || "";
    // Retry without tools when model doesn't support them
    if (
      err?.response?.status === 400 &&
      (msg.includes("tools") ||
        msg.includes("reasoning_effort") ||
        msg.includes("function"))
    ) {
      console.warn(
        `[ai] model "${model}" doesn't support tools — retrying without tools`,
      );
      const resp = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        buildBody(false),
        {
          headers: { Authorization: `Bearer ${env.ai.openaiKey}` },
          timeout: 60000,
        },
      );
      data = resp.data;
    } else {
      throw err;
    }
  }

  const msg = data?.choices?.[0]?.message;
  const call = msg?.tool_calls?.[0];
  if (call?.function?.name) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      /* malformed arguments — treated as missing below */
    }
    return { kind: "action", actionName: call.function.name, args };
  }
  const text = (msg?.content || "").trim();
  return text ? { kind: "text", text } : { kind: "none" };
}

/**
 * Decide what to do with this turn: reply in text, or call one of the
 * configured actions (book a call, raise a ticket, etc.).
 */
export async function decide(
  conversationId: Types.ObjectId,
  number?: IWabaNumber | null,
  contact?: IContact | null,
): Promise<AiDecision> {
  try {
    const settings = await getSettings();
    const system = await buildSystemPrompt(number, contact);
    const turns = await buildHistory(conversationId);
    if (!turns.length) return { kind: "none" };

    const actions = number && contact ? await actionsFor(number, contact) : [];

    if (settings.aiProvider === "openai") {
      if (!env.ai.openaiKey) throw new Error("OPENAI_API_KEY not set");
      const model = settings.aiModel.startsWith("gpt")
        ? settings.aiModel
        : "gpt-4o-mini";
      const decision = await callOpenAI(
        system,
        turns,
        model,
        settings.aiMaxTokens,
        actions.map(toOpenAiTool),
      );
      if (decision.kind === "text")
        decision.text = sanitizeReply(decision.text!, settings);
      return decision;
    }

    if (!env.ai.anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");
    const model = settings.aiModel.startsWith("claude")
      ? settings.aiModel
      : "claude-sonnet-5";
    const decision = await callClaude(
      system,
      turns,
      model,
      settings.aiMaxTokens,
      actions.map(toToolSchema),
    );
    if (decision.kind === "text")
      decision.text = sanitizeReply(decision.text!, settings);
    return decision;
  } catch (err: any) {
    console.error(
      "[ai] decide failed:",
      err?.response?.data?.error?.message || err.message,
    );
    return { kind: "none" };
  }
}

/** Text-only reply, used by the "AI draft" button in the inbox. */
export async function generateReply(
  conversationId: Types.ObjectId,
  number?: IWabaNumber | null,
  contact?: IContact | null,
): Promise<string> {
  const decision = await decide(conversationId, number, contact);
  if (decision.kind === "text") return decision.text || "";
  if (decision.kind === "action")
    return `[The AI would run the "${decision.actionName}" action here with: ${JSON.stringify(decision.args)}]`;
  return "";
}

/** Classify a conversation for lead management. */
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
    const decision =
      settings.aiProvider === "openai" && env.ai.openaiKey
        ? await callOpenAI(system, turnsForModel, "gpt-4o-mini", 300)
        : await callClaude(
            system,
            turnsForModel,
            "claude-haiku-4-5-20251001",
            300,
          );
    const raw = decision.text || "";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
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
