/**
 * Customer lookup against the Svastha app.
 *
 * On an inbound message we ask your API "who is this phone number?". The answer
 * decides whether the AI treats the person as a lead (sell) or an existing
 * customer (support), and gets injected into the AI's context so it can answer
 * account-specific questions without guessing.
 */
import axios from "axios";
import { Contact, IContact, getSettings } from "../models";

function readPath(obj: any, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

/** Flatten a nested object into "a.b: value" strings the model can read. */
function flatten(obj: any, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (obj == null) return out;
  if (typeof obj !== "object") {
    out[prefix || "value"] = String(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    if (obj.length && typeof obj[0] !== "object") {
      out[prefix] = obj.join(", ");
    } else {
      obj.slice(0, 5).forEach((v, i) => flatten(v, prefix ? `${prefix}[${i}]` : String(i), out));
    }
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else if (v !== null && v !== undefined && v !== "") out[key] = String(v);
  }
  return out;
}

/**
 * Look the contact up, using a cached result when it's fresh enough.
 * Never throws — a lookup failure must not stop a customer being answered.
 */
export async function syncCustomer(contact: IContact, force = false): Promise<IContact> {
  const settings = await getSettings();
  if (!settings.customerLookupEnabled || !settings.customerLookupUrl) return contact;

  const cacheMs = Math.max(0, settings.customerLookupCacheMinutes) * 60000;
  if (
    !force &&
    contact.customerSyncedAt &&
    Date.now() - new Date(contact.customerSyncedAt).getTime() < cacheMs
  ) {
    return contact;
  }

  const url = settings.customerLookupUrl.replace(/\{\{\s*phone\s*\}\}/g, encodeURIComponent(contact.waId));
  const headers: Record<string, string> = {};
  settings.customerLookupHeaders?.forEach?.((v: string, k: string) => (headers[k] = v));

  try {
    const res =
      settings.customerLookupMethod === "POST"
        ? await axios.post(url, { phone: contact.waId }, { headers, timeout: 12000 })
        : await axios.get(url, { headers, timeout: 12000 });

    const body = res.data;
    const foundRaw = settings.customerFoundPath ? readPath(body, settings.customerFoundPath) : body;
    const data = settings.customerDataPath ? readPath(body, settings.customerDataPath) : body;

    const found =
      typeof foundRaw === "boolean"
        ? foundRaw
        : foundRaw !== undefined && foundRaw !== null && foundRaw !== "" && foundRaw !== false;

    contact.isCustomer = !!found && !!data;
    contact.customerData = new Map(Object.entries(found && data ? flatten(data) : {})) as any;
    contact.externalId =
      (readPath(data, "id") as string) || (readPath(data, "customer_id") as string) || contact.externalId;
    contact.customerSyncedAt = new Date();
    contact.customerLookupError = undefined;
    if (!contact.name) {
      const n = readPath(data, "name") || readPath(data, "full_name");
      if (n) contact.name = String(n);
    }
  } catch (err: any) {
    contact.customerLookupError =
      err?.response?.status
        ? `Lookup failed (HTTP ${err.response.status})`
        : err.message || "Lookup failed";
    contact.customerSyncedAt = new Date();
    console.warn(`[customer] lookup failed for ${contact.waId}: ${contact.customerLookupError}`);
  }

  await contact.save();
  return contact;
}

/** Render the customer record as a block for the AI system prompt. */
export function customerContextBlock(contact: IContact): string {
  if (!contact.isCustomer || !contact.customerData || contact.customerData.size === 0) {
    return `\n\n## Who you are talking to
This person is NOT a registered customer in our system — treat them as a prospective customer (a lead). Be helpful and answer their questions. If they show interest in a programme, use the appropriate action to capture their details.`;
  }

  const lines: string[] = [];
  contact.customerData.forEach((v, k) => lines.push(`- ${k}: ${v}`));

  return `\n\n## Who you are talking to
This is an EXISTING CUSTOMER. Their account details from the Svastha app:
${lines.join("\n")}

Use these details to answer account-specific questions directly and accurately. Never state anything about their account that is not listed above. If they have a problem you cannot resolve from this information, raise a support ticket using the appropriate action rather than guessing.`;
}

/** Refresh in the background without blocking the reply path. */
export function syncCustomerInBackground(contactId: unknown): void {
  Contact.findById(contactId)
    .then((c) => c && syncCustomer(c))
    .catch(() => {});
}
