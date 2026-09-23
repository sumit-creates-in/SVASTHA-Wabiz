/**
 * Spreadsheet reading and writing for contact import/export.
 *
 * The critical detail: phone numbers must never pass through a JavaScript
 * number, or long ones lose precision. Excel cells are read with parseNumber
 * returning the raw stored text, and CSVs are read with every value as text.
 */
import { getToken } from "./api";
// The spreadsheet libraries are loaded on demand (only when someone imports or
// exports) so they don't slow down the rest of the app.

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
  fileName: string;
}

function cellToText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function tidy(matrix: string[][], fileName: string): ParsedSheet {
  const nonEmpty = matrix.filter((r) => r.some((c) => c && c.trim()));
  if (!nonEmpty.length) throw new Error("The file is empty.");
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const headerRow = nonEmpty[0];
  const headers = Array.from({ length: width }, (_, i) => {
    const h = (headerRow[i] || "").replace(/^﻿/, "").trim();
    return h || `Column ${i + 1}`;
  });
  const rows = nonEmpty.slice(1).map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim()));
  if (!rows.length) throw new Error("The file only has a header row — no contacts in it.");
  return { headers, rows, fileName };
}

export async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "xls") {
    throw new Error(
      "Old .xls files aren't supported. Open it in Excel and use File → Save As → Excel Workbook (.xlsx), or CSV.",
    );
  }

  if (ext === "xlsx") {
    // parseNumber returns the exact digits Excel stored, never a float.
    const { readSheet } = await import("read-excel-file/browser");
    const data = await readSheet(file, { parseNumber: (s: string) => s });
    const matrix = (data as unknown[][]).map((row) => row.map(cellToText));
    return tidy(matrix, file.name);
  }

  const text = (await file.text()).replace(/^﻿/, "");
  return parseText(text, file.name);
}

/** CSV, TSV, or rows pasted straight from Excel / Google Sheets. */
export async function parseText(text: string, fileName = "Pasted data"): Promise<ParsedSheet> {
  const { default: papa } = await import("papaparse");
  const result = papa.parse<string[]>(text.trim(), {
    skipEmptyLines: "greedy",
    dynamicTyping: false, // keep everything as text
  });
  if (result.errors.length && !result.data.length) {
    throw new Error(`Couldn't read that file: ${result.errors[0].message}`);
  }
  return tidy(result.data as string[][], fileName);
}

// ── Column detection ────────────────────────────────────

export type ColumnTarget =
  | "ignore"
  | "phone"
  | "countryCode"
  | "name"
  | "firstName"
  | "lastName"
  | "email"
  | "tags"
  | "notes"
  | "attribute";

export const TARGET_LABELS: Record<ColumnTarget, string> = {
  ignore: "Don't import",
  phone: "Phone number",
  countryCode: "Country code",
  name: "Full name",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  tags: "Tags",
  notes: "Notes",
  attribute: "Custom field",
};

const PATTERNS: [ColumnTarget, RegExp][] = [
  ["countryCode", /^(country[\s_-]?code|cc|dial[\s_-]?code|isd)$/i],
  ["phone", /phone|mobile|whats\s?app|wa[\s_-]?id|cell|contact[\s_-]?(no|number)|^number$|^mob/i],
  ["firstName", /^first[\s_-]?name$|^fname$|^given/i],
  ["lastName", /^last[\s_-]?name$|^lname$|^surname$|^family/i],
  ["name", /name/i],
  ["email", /e-?mail/i],
  ["tags", /^(tags?|labels?|segments?|groups?|lists?)$/i],
  ["notes", /^(notes?|remarks?|comments?|description)$/i],
];

function looksLikePhones(values: string[]): boolean {
  const filled = values.filter(Boolean).slice(0, 30);
  if (!filled.length) return false;
  const phoneish = filled.filter((v) => {
    const d = v.replace(/[\s\-+().]/g, "");
    return /^\d{10,15}$/.test(d) || /^\d(\.\d+)?e\+?\d+$/i.test(d);
  });
  return phoneish.length / filled.length > 0.7;
}

export function guessMapping(sheet: ParsedSheet): ColumnTarget[] {
  const used = new Set<ColumnTarget>();
  const mapping = sheet.headers.map((h) => {
    for (const [target, re] of PATTERNS) {
      if (re.test(h) && !used.has(target)) {
        used.add(target);
        return target;
      }
    }
    return "attribute" as ColumnTarget;
  });

  // No header matched a phone column — find one by its contents.
  if (!used.has("phone")) {
    const idx = sheet.headers.findIndex((_, i) => looksLikePhones(sheet.rows.map((r) => r[i])));
    if (idx >= 0) mapping[idx] = "phone";
  }
  // A full name column makes first/last redundant, and vice versa.
  if (mapping.includes("name") && (mapping.includes("firstName") || mapping.includes("lastName"))) {
    const i = mapping.indexOf("name");
    mapping[i] = "attribute";
  }
  return mapping;
}

export interface ImportRow {
  phone: string;
  name: string;
  email: string;
  tags: string;
  notes: string;
  attributes: Record<string, string>;
}

export function buildRows(sheet: ParsedSheet, mapping: ColumnTarget[]): ImportRow[] {
  return sheet.rows.map((cells) => {
    const row: ImportRow = { phone: "", name: "", email: "", tags: "", notes: "", attributes: {} };
    let cc = "";
    let first = "";
    let last = "";
    mapping.forEach((target, i) => {
      const v = cells[i] ?? "";
      switch (target) {
        case "phone":
          row.phone = v;
          break;
        case "countryCode":
          cc = v.replace(/[^0-9]/g, "");
          break;
        case "name":
          row.name = v;
          break;
        case "firstName":
          first = v;
          break;
        case "lastName":
          last = v;
          break;
        case "email":
          row.email = v;
          break;
        case "tags":
          row.tags = v;
          break;
        case "notes":
          row.notes = v;
          break;
        case "attribute":
          if (v) row.attributes[sheet.headers[i]] = v;
          break;
      }
    });
    if (!row.name && (first || last)) row.name = `${first} ${last}`.trim();
    // Separate country-code column: glue it on unless the number already has one.
    if (cc && row.phone && !row.phone.trim().startsWith("+")) {
      const digits = row.phone.replace(/[^0-9]/g, "");
      if (!digits.startsWith(cc) || digits.length <= 10) row.phone = `+${cc}${digits}`;
    }
    return row;
  });
}

// ── Download helpers ────────────────────────────────────

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadCsv(header: string[], rows: (string | number)[][], name: string) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), name);
}

/** Every cell written as text so Excel never reformats phone numbers. */
export async function downloadXlsx(header: string[], rows: string[][], name: string) {
  const data = [
    header.map((h) => ({ value: h, type: String, fontWeight: "bold" as const })),
    ...rows.map((r) => r.map((v) => ({ value: v ?? "", type: String }))),
  ];
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const blob = await writeXlsxFile(data as any, {
    columns: header.map((h) => ({ width: Math.min(40, Math.max(12, h.length + 4)) })),
  }).toBlob();
  saveBlob(blob, name);
}

/** Authenticated download of a server-generated file. */
export async function downloadFromApi(path: string, name: string) {
  const res = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${getToken() || ""}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `Download failed (${res.status})`);
  }
  saveBlob(await res.blob(), name);
}

export function downloadSampleCsv() {
  downloadCsv(
    ["phone", "name", "email", "tags", "city"],
    [
      ["+91 98765 43210", "Asha Rao", "asha@example.com", "lead; 21-day", "Pune"],
      ["9812345678", "Vikram Singh", "", "customer", "Delhi"],
      ["+14155552671", "Priya Shah", "priya@example.com", "", "San Francisco"],
    ],
    "svastha-contacts-template.csv",
  );
}

/** Same display rule as the server: 919876543210 → +91 98765 43210. */
export function formatPhone(waId: string, masked?: boolean): string {
  if (!waId) return "—";
  if (masked) return waId;
  if (/^91\d{10}$/.test(waId)) return `+91 ${waId.slice(2, 7)} ${waId.slice(7)}`;
  return `+${waId}`;
}

export function isValidWaId(waId: string): boolean {
  return /^(?:91\d{10}|(?!91)[1-9]\d{9,14})$/.test(waId);
}
