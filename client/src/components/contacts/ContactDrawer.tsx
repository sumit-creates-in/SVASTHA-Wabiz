import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X, Trash2, MessageSquare, Plus, Megaphone, UserCheck, Ban, Save } from "lucide-react";
import { api } from "../../lib/api";
import { formatPhone } from "../../lib/spreadsheet";
import type { Contact } from "../../types";

interface Detail {
  contact: Contact;
  conversations: {
    _id: string;
    number?: { label: string; displayPhoneNumber: string };
    status: string;
    labels: string[];
    lastMessageAt: string;
    lastMessagePreview: string;
  }[];
  leads: { _id: string; interest: string; status: string; createdAt: string }[];
  tickets: { _id: string; reference: string; subject: string; status: string }[];
}

export default function ContactDrawer({
  contactId,
  canEdit,
  onClose,
  onChanged,
}: {
  contactId: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "", tags: [] as string[] });
  const [attrs, setAttrs] = useState<[string, string][]>([]);
  const [tagInput, setTagInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function load() {
    const d = await api<Detail>(`/contacts/${contactId}`);
    setDetail(d);
    const c = d.contact;
    setForm({
      name: c.name || "",
      phone: c.masked ? "" : `+${c.waId}`,
      email: c.email || "",
      notes: c.notes || "",
      tags: c.tags || [],
    });
    setAttrs(Object.entries(c.attributes || {}));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  if (!detail) {
    return (
      <Shell onClose={onClose}>
        <p className="p-6 text-sm text-slate-400">{error || "Loading…"}</p>
      </Shell>
    );
  }
  const c = detail.contact;

  async function save() {
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        email: form.email,
        notes: form.notes,
        tags: form.tags,
        attributes: Object.fromEntries(attrs.filter(([k]) => k.trim())),
      };
      if (!c.masked && form.phone.replace(/[^0-9]/g, "") !== c.waId) body.phone = form.phone;
      await api(`/contacts/${contactId}`, { method: "PATCH", body });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await load();
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleOptOut() {
    await api(`/contacts/${contactId}`, { method: "PATCH", body: { optedOut: !c.optedOut } });
    await load();
    onChanged();
  }

  async function remove() {
    if (
      !confirm(
        `Delete ${c.name || "this contact"}?\n\nTheir chat history, leads and tickets will be deleted too. This can't be undone.`,
      )
    )
      return;
    await api(`/contacts/${contactId}`, { method: "DELETE" });
    onChanged();
    onClose();
  }

  function addTag() {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) setForm({ ...form, tags: [...form.tags, t] });
    setTagInput("");
  }

  const ro = !canEdit;

  return (
    <Shell onClose={onClose}>
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold shrink-0">
              {(c.name || "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-semibold truncate">{c.name || "Unnamed contact"}</div>
              <div className="text-sm text-slate-500 font-mono">{formatPhone(c.waId, c.masked)}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3 text-[11px]">
          {c.isCustomer ? (
            <span className="bg-emerald-100 text-emerald-700 rounded px-2 py-0.5">Customer</span>
          ) : (
            <span className="bg-sky-100 text-sky-700 rounded px-2 py-0.5">Lead</span>
          )}
          {c.optedOut && <span className="bg-red-100 text-red-700 rounded px-2 py-0.5">Opted out</span>}
          {c.referral?.sourceId && <span className="bg-violet-100 text-violet-700 rounded px-2 py-0.5">From ad</span>}
          <span className="bg-slate-100 text-slate-600 rounded px-2 py-0.5">Source: {c.source || "whatsapp"}</span>
          {c.createdAt && (
            <span className="bg-slate-100 text-slate-600 rounded px-2 py-0.5">
              Added {new Date(c.createdAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Name</label>
            <input className="input" value={form.name} disabled={ro} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Phone</label>
            {c.masked ? (
              <input className="input" value={formatPhone(c.waId, true)} disabled />
            ) : (
              <input
                className="input font-mono"
                value={form.phone}
                disabled={ro}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            )}
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={form.email} disabled={ro} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="label">Tags</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {form.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 bg-brand-100 text-brand-700 text-xs rounded-full px-2.5 py-1">
                {t}
                {!ro && (
                  <button onClick={() => setForm({ ...form, tags: form.tags.filter((x) => x !== t) })}>
                    <X size={11} />
                  </button>
                )}
              </span>
            ))}
            {!form.tags.length && <span className="text-xs text-slate-400">No tags</span>}
          </div>
          {!ro && (
            <input
              className="input text-sm"
              placeholder="Add a tag and press Enter"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                }
              }}
            />
          )}
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea
            className="input text-sm"
            rows={3}
            disabled={ro}
            placeholder="Anything the team should know"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Custom fields</label>
            {!ro && (
              <button className="text-xs text-brand-600 flex items-center gap-1" onClick={() => setAttrs([...attrs, ["", ""]])}>
                <Plus size={12} /> Add field
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {attrs.map(([k, v], i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input text-xs w-1/3"
                  placeholder="Field"
                  value={k}
                  disabled={ro}
                  onChange={(e) => setAttrs(attrs.map((a, j) => (j === i ? [e.target.value, a[1]] : a)))}
                />
                <input
                  className="input text-xs flex-1"
                  placeholder="Value"
                  value={v}
                  disabled={ro}
                  onChange={(e) => setAttrs(attrs.map((a, j) => (j === i ? [a[0], e.target.value] : a)))}
                />
                {!ro && (
                  <button className="text-slate-400 hover:text-red-600" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            {!attrs.length && <p className="text-xs text-slate-400">None — imported columns like City show up here.</p>}
          </div>
        </div>

        {/* Conversations */}
        <div>
          <label className="label">Conversations</label>
          {detail.conversations.length ? (
            <div className="space-y-1.5">
              {detail.conversations.map((cv) => (
                <Link
                  key={cv._id}
                  to={`/inbox?conversation=${cv._id}`}
                  className="flex items-start gap-2 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50"
                >
                  <MessageSquare size={14} className="text-brand-600 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium">
                      {cv.number?.label || "WhatsApp"}{" "}
                      <span className="text-slate-400 font-normal">
                        · {new Date(cv.lastMessageAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 truncate">{cv.lastMessagePreview}</div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No messages yet.</p>
          )}
        </div>

        {(detail.leads.length > 0 || detail.tickets.length > 0) && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            {detail.leads.length > 0 && (
              <div>
                <label className="label">Leads</label>
                {detail.leads.map((l) => (
                  <div key={l._id} className="bg-slate-50 rounded px-2 py-1 mb-1">
                    {l.interest || "Lead"} · <span className="text-slate-500">{l.status.replace("_", " ")}</span>
                  </div>
                ))}
              </div>
            )}
            {detail.tickets.length > 0 && (
              <div>
                <label className="label">Tickets</label>
                {detail.tickets.map((t) => (
                  <div key={t._id} className="bg-slate-50 rounded px-2 py-1 mb-1">
                    {t.reference} · <span className="text-slate-500">{t.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {c.referral?.sourceId && (
          <div className="bg-violet-50 rounded-lg p-3 text-xs">
            <div className="font-semibold text-violet-800 flex items-center gap-1 mb-0.5">
              <Megaphone size={12} /> Came from an ad
            </div>
            {c.referral.headline && <p className="text-violet-700">"{c.referral.headline}"</p>}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-2">
          <button className="btn-primary" onClick={save} disabled={busy}>
            <Save size={14} /> {busy ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
          <button className="btn-secondary" onClick={toggleOptOut} title="Opted-out contacts never receive broadcasts or follow-ups">
            {c.optedOut ? <UserCheck size={14} /> : <Ban size={14} />}
            {c.optedOut ? "Opt back in" : "Opt out"}
          </button>
          <button className="btn-secondary text-red-600 ml-auto" onClick={remove}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/20" />
      <div
        className="relative w-full max-w-md bg-white h-full shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
