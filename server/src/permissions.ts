/**
 * Team permissions and privacy controls.
 *
 * Masking is applied on the SERVER, not in the browser. A masked user's API
 * responses never contain the full phone number, so it can't be recovered from
 * devtools, the network tab, or a copied API token.
 */
import { IUser } from "./models";

export interface PermissionDef {
  key: string;
  label: string;
  group: string;
  description: string;
}

export const PERMISSIONS: PermissionDef[] = [
  // Inbox
  { key: "inbox.view", label: "View inbox", group: "Inbox", description: "See conversations and message history" },
  { key: "inbox.send", label: "Reply to customers", group: "Inbox", description: "Send messages and templates in chats" },
  { key: "inbox.assign", label: "Assign & label chats", group: "Inbox", description: "Assign agents, add labels and notes" },
  { key: "inbox.ai", label: "Control AI per chat", group: "Inbox", description: "Pause or resume the AI on a conversation" },

  // Contacts & leads
  { key: "contacts.view", label: "View contacts", group: "Contacts", description: "Browse the contact list" },
  { key: "contacts.edit", label: "Edit contacts", group: "Contacts", description: "Create, edit and delete contacts" },
  { key: "contacts.export", label: "Export contacts", group: "Contacts", description: "Download or bulk-export contact data" },
  { key: "leads.view", label: "View leads", group: "Contacts", description: "See the lead pipeline" },
  { key: "leads.manage", label: "Manage leads", group: "Contacts", description: "Change lead status, assignment and notes" },
  { key: "tickets.view", label: "View tickets", group: "Contacts", description: "See support tickets" },
  { key: "tickets.manage", label: "Manage tickets", group: "Contacts", description: "Update ticket status and assignment" },

  // Messaging
  { key: "broadcasts.view", label: "View broadcasts", group: "Messaging", description: "See campaigns and their results" },
  { key: "broadcasts.send", label: "Send broadcasts", group: "Messaging", description: "Launch campaigns to contact segments" },
  { key: "templates.view", label: "View templates", group: "Messaging", description: "See approved message templates" },
  { key: "templates.manage", label: "Manage templates", group: "Messaging", description: "Sync and submit templates to Meta" },

  // Automation
  { key: "workflows.view", label: "View workflows", group: "Automation", description: "See webhook workflows and stats" },
  { key: "workflows.manage", label: "Manage workflows", group: "Automation", description: "Create, edit and delete workflows" },
  { key: "actions.view", label: "View AI actions", group: "Automation", description: "See what the AI can do" },
  { key: "actions.manage", label: "Manage AI actions", group: "Automation", description: "Create and edit AI actions and their webhooks" },
  { key: "knowledge.view", label: "View AI knowledge", group: "Automation", description: "Read the AI knowledge base" },
  { key: "knowledge.manage", label: "Manage AI knowledge", group: "Automation", description: "Edit what the AI knows about the business" },

  // Admin
  { key: "numbers.view", label: "View numbers", group: "Admin", description: "See WhatsApp numbers and their health" },
  { key: "numbers.manage", label: "Manage numbers", group: "Admin", description: "Add, configure and disable numbers" },
  { key: "analytics.view", label: "View dashboard", group: "Admin", description: "See analytics and alerts" },
  { key: "settings.manage", label: "Manage settings", group: "Admin", description: "Change AI, compliance and integration settings" },
  { key: "team.manage", label: "Manage team", group: "Admin", description: "Add team members and change their permissions" }
];

export const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** Sensible starting points when creating a team member. */
export const ROLE_PRESETS: Record<string, string[]> = {
  admin: ALL_PERMISSION_KEYS,
  manager: ALL_PERMISSION_KEYS.filter((k) => k !== "team.manage" && k !== "settings.manage"),
  agent: [
    "inbox.view",
    "inbox.send",
    "inbox.assign",
    "inbox.ai",
    "contacts.view",
    "leads.view",
    "leads.manage",
    "tickets.view",
    "tickets.manage",
    "templates.view"
  ]
};

/** Admins always have everything; everyone else uses their explicit list. */
export function effectivePermissions(user: Pick<IUser, "role" | "permissions">): string[] {
  if (user.role === "admin") return ALL_PERMISSION_KEYS;
  return user.permissions || [];
}

export function hasPermission(user: Pick<IUser, "role" | "permissions">, key: string): boolean {
  return effectivePermissions(user).includes(key);
}

// ── Phone masking ───────────────────────────────────────

/**
 * Show only the last 4 digits: 919880024120 → "+91 XXXXX X4120".
 * Enough to confirm identity on a call without exposing the number.
 */
export function maskWaId(waId: string): string {
  const digits = String(waId || "").replace(/[^0-9]/g, "");
  if (digits.length <= 4) return "XXXX";
  const last4 = digits.slice(-4);
  const hiddenCount = digits.length - 4;
  return `${"X".repeat(hiddenCount)}${last4}`;
}

/** Redact a phone number anywhere it appears in free text. */
export function maskPhonesInText(text: string): string {
  if (!text) return text;
  return text.replace(/(\+?\d[\d\s\-()]{7,}\d)/g, (m) => {
    const digits = m.replace(/[^0-9]/g, "");
    if (digits.length < 8) return m;
    return maskWaId(digits);
  });
}

export interface Viewer {
  id: string;
  role: string;
  permissions: string[];
  maskPhoneNumbers: boolean;
  allowedNumbers: string[];
}

/** Apply masking to a contact-shaped object (mutates a copy). */
export function maskContact<T extends Record<string, any>>(contact: T, viewer: Viewer): T {
  if (!viewer.maskPhoneNumbers || !contact) return contact;
  return {
    ...contact,
    waId: maskWaId(contact.waId),
    email: contact.email ? maskEmail(contact.email) : contact.email,
    masked: true
  };
}

function maskEmail(email: string): string {
  const [user, domain] = String(email).split("@");
  if (!domain) return "hidden";
  const visible = user.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(3, user.length - 2))}@${domain}`;
}

/** Does this viewer have access to the given number id? */
export function canSeeNumber(viewer: Viewer, numberId?: string): boolean {
  if (!viewer.allowedNumbers.length) return true; // unrestricted
  if (!numberId) return true;
  return viewer.allowedNumbers.includes(String(numberId));
}
