/**
 * Phone number normalisation for WhatsApp IDs.
 *
 * WhatsApp identifies people by their full international number with no "+",
 * e.g. 919876543210. Spreadsheets mangle these in predictable ways, and the
 * worst one is silent: Excel turns 919876543210 into 9.19876E+11, and a naive
 * "keep the digits" import then produces 91987611 — a number that looks real
 * but belongs to nobody. Every import path goes through this one function.
 */

export interface PhoneResult {
  ok: boolean;
  /** Digits only, with country code, e.g. 919876543210. */
  waId?: string;
  /** Why the number was rejected. */
  reason?: string;
  /** Accepted, but something about it looks off. */
  warning?: string;
  /** Human-readable note of anything we corrected. */
  fixed?: string;
}

const SCIENTIFIC = /^([+-]?)(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/;

/** Expand "9.19876543210E+11" exactly, or report that digits were lost. */
function expandScientific(s: string): { digits?: string; lossy: boolean } {
  const m = s.match(SCIENTIFIC);
  if (!m) return { lossy: false };
  const intPart = m[2];
  const frac = m[3] || "";
  const exp = parseInt(m[4], 10);
  const mantissa = intPart + frac;
  const integerLength = intPart.length + exp;

  // Digits actually written in the cell, ignoring leading zeros.
  const given = mantissa.replace(/^0+/, "").length;
  let digits: string;
  if (frac.length >= exp) digits = mantissa.slice(0, integerLength);
  else digits = mantissa + "0".repeat(exp - frac.length);
  digits = digits.replace(/^0+/, "");

  // If Excel stored fewer digits than the number has, the rest were padded
  // with zeros that were never in the original — the number is unrecoverable.
  return { digits, lossy: given < digits.length };
}

export function normalizePhone(raw: unknown, defaultCountryCode = "91"): PhoneResult {
  if (raw === null || raw === undefined) return { ok: false, reason: "Phone number is empty" };
  let s = String(raw).trim();
  if (!s) return { ok: false, reason: "Phone number is empty" };

  const cc = String(defaultCountryCode || "").replace(/[^0-9]/g, "");
  const notes: string[] = [];

  // 1. Excel scientific notation.
  const compact = s.replace(/[\s,]/g, "");
  if (SCIENTIFIC.test(compact)) {
    const { digits, lossy } = expandScientific(compact);
    if (lossy || !digits) {
      return {
        ok: false,
        reason:
          `Excel turned this number into scientific notation (${s}) and dropped digits. ` +
          `Format the phone column as Text in Excel, or upload the .xlsx file instead of a CSV.`,
      };
    }
    s = digits;
    notes.push("expanded from Excel scientific notation");
  }

  // 2. Numbers exported with a trailing ".0" (common from Google Sheets / pandas).
  if (/^\+?\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");

  // 3. Strip formatting.
  let international = false;
  s = s.replace(/[\s\-().\/ ]/g, "");
  if (s.startsWith("+")) {
    international = true;
    s = s.slice(1);
  } else if (s.startsWith("00")) {
    international = true;
    s = s.slice(2);
  }
  if (!/^\d+$/.test(s)) {
    return { ok: false, reason: `Contains characters that aren't digits ("${String(raw).trim()}")` };
  }

  // 4. Add the country code where it's clearly missing.
  let digits = s;
  if (!international && cc) {
    if (digits.length === 10 && !digits.startsWith("0")) {
      digits = cc + digits;
      notes.push(`added country code +${cc}`);
    } else if (digits.length === 11 && digits.startsWith("0")) {
      digits = cc + digits.slice(1);
      notes.push(`replaced leading 0 with +${cc}`);
    }
  }

  // 5. Validate.
  if (digits.length < 10) {
    return {
      ok: false,
      reason: `Only ${digits.length} digits — too short for a WhatsApp number (need country code + number)`,
    };
  }
  if (digits.length > 15) {
    return { ok: false, reason: `${digits.length} digits — longer than any valid phone number` };
  }
  if (digits.startsWith("0")) {
    return { ok: false, reason: "Starts with 0 — missing country code" };
  }

  // India (+91) has exactly 10 national digits, and mobiles start 6-9.
  let warning: string | undefined;
  if (digits.startsWith("91")) {
    if (digits.length !== 12) {
      return {
        ok: false,
        reason: `Indian numbers need exactly 10 digits after +91 (this has ${digits.length - 2})`,
      };
    }
    if (!/^91[6-9]/.test(digits)) warning = "Doesn't look like an Indian mobile number";
  }
  if (/^(\d)\1+$/.test(digits.slice(-10))) warning = "Looks like a placeholder number";

  return {
    ok: true,
    waId: digits,
    fixed: notes.length ? notes.join(", ") : undefined,
    warning,
  };
}

/**
 * Mongo query fragment matching stored contacts whose waId can't be a real
 * WhatsApp number — typically leftovers from a mangled spreadsheet import.
 */
export const INVALID_WAID_QUERY = {
  waId: { $not: /^(?:91\d{10}|(?!91)[1-9]\d{9,14})$/ },
};

/** Pretty display: 919876543210 → +91 98765 43210. */
export function formatPhone(waId: string): string {
  if (/^91\d{10}$/.test(waId)) return `+91 ${waId.slice(2, 7)} ${waId.slice(7)}`;
  return `+${waId}`;
}
