import type { Template, BroadcastVariable } from "../types";

export interface ParsedTemplate {
  headerFormat: "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  headerText: string;
  headerVarCount: number;
  body: string;
  bodyVarCount: number;
  footer: string;
  buttons: { type: string; text: string; url?: string; dynamic: boolean }[];
  hasDynamicUrlButton: boolean;
  sampleHeaderUrl?: string;
}

function countVars(text: string): number {
  const nums = (text.match(/\{\{(\d+)\}\}/g) || []).map((m) => parseInt(m.replace(/\D/g, ""), 10));
  return nums.length ? Math.max(...nums) : 0;
}

/** Turn Meta's component list into something the builder and preview can use. */
export function parseTemplate(t?: Template | null): ParsedTemplate {
  const comps: any[] = t?.components || [];
  const header = comps.find((c) => c.type === "HEADER");
  const body = comps.find((c) => c.type === "BODY");
  const footer = comps.find((c) => c.type === "FOOTER");
  const buttonsComp = comps.find((c) => c.type === "BUTTONS");
  const buttons = (buttonsComp?.buttons || []).map((b: any) => ({
    type: b.type,
    text: b.text,
    url: b.url,
    dynamic: b.type === "URL" && /\{\{\d+\}\}/.test(b.url || ""),
  }));
  const bodyText = body?.text || t?.bodyText || "";
  const headerText = header?.format === "TEXT" ? header.text || "" : "";
  return {
    headerFormat: (header?.format || "NONE") as ParsedTemplate["headerFormat"],
    headerText,
    headerVarCount: countVars(headerText),
    body: bodyText,
    bodyVarCount: Math.max(countVars(bodyText), t?.variableCount || 0),
    footer: footer?.text || "",
    buttons,
    hasDynamicUrlButton: buttons.some((b: any) => b.dynamic),
    sampleHeaderUrl: header?.example?.header_handle?.[0],
  };
}

export const SOURCE_LABELS: Record<BroadcastVariable["source"], string> = {
  static: "Same text for everyone",
  firstName: "Contact's first name",
  name: "Contact's full name",
  phone: "Contact's phone",
  email: "Contact's email",
  attribute: "Custom field",
};

/** Sensible default: first variable is usually a greeting name. */
export function defaultVariables(count: number): BroadcastVariable[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0
      ? { source: "firstName" as const, value: "", fallback: "there" }
      : { source: "static" as const, value: "", fallback: "" },
  );
}

/** Fill variables for a sample contact, client-side, for the live preview. */
export function sampleValue(
  v: BroadcastVariable,
  sample: { name?: string; waId?: string; email?: string; attributes?: Record<string, string> },
): string {
  let val = "";
  if (v.source === "static") val = v.value;
  if (v.source === "name") val = sample.name || "";
  if (v.source === "firstName") val = (sample.name || "").split(/\s+/)[0] || "";
  if (v.source === "phone") val = sample.waId ? `+${sample.waId}` : "";
  if (v.source === "email") val = sample.email || "";
  if (v.source === "attribute") val = sample.attributes?.[v.value] || "";
  return val.trim() || v.fallback || "";
}

export function fill(text: string, values: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_m, i) => values[Number(i) - 1] || `{{${i}}}`);
}

/** WhatsApp formatting: *bold*, _italic_, ~strike~ → safe HTML. */
export function waFormat(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>")
    .replace(/~([^~\n]+)~/g, "<s>$1</s>")
    .replace(/\n/g, "<br/>");
}
