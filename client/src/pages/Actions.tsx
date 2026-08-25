import { useCallback, useEffect, useState } from "react";
import { Plus, Zap, Trash2, Pencil, PlayCircle, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../lib/api";
import type { AiAction, ActionField, ActionRun, WabaNumber } from "../types";

const audienceLabel: Record<string, string> = {
  any: "Everyone",
  lead: "New leads only",
  customer: "Existing customers only"
};

export default function Actions() {
  const [actions, setActions] = useState<AiAction[]>([]);
  const [runs, setRuns] = useState<ActionRun[]>([]);
  const [numbers, setNumbers] = useState<WabaNumber[]>([]);
  const [editing, setEditing] = useState<AiAction | "new" | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setActions(await api<AiAction[]>("/actions"));
    setRuns(await api<ActionRun[]>("/action-runs"));
  }, []);

  useEffect(() => {
    load();
    api<WabaNumber[]>("/numbers").then(setNumbers).catch(() => {});
  }, [load]);

  async function toggle(a: AiAction) {
    await api(`/actions/${a._id}`, { method: "PATCH", body: { enabled: !a.enabled } });
    load();
  }

  async function remove(a: AiAction) {
    if (!confirm(`Delete the "${a.displayName}" action?`)) return;
    await api(`/actions/${a._id}`, { method: "DELETE" });
    load();
  }

  async function retry(r: ActionRun) {
    setMsg("");
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/action-runs/${r._id}/retry`, { method: "POST" });
      setMsg(res.ok ? "Retry succeeded." : `Retry failed: ${res.error}`);
      load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">AI Actions</h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            Things the AI can <em>do</em>, not just say. When a customer's message matches an action, the AI
            collects the details it needs, posts them to your webhook, and confirms — using your wording, only
            after the webhook actually succeeded.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setEditing("new")}>
          <Plus size={15} /> New action
        </button>
      </div>

      {msg && <p className="mb-4 text-sm text-slate-700 bg-slate-100 rounded-lg px-4 py-2">{msg}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {actions.map((a) => (
          <div key={a._id} className="card p-5">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Zap size={15} className={a.enabled ? "text-brand-600" : "text-slate-300"} />
                  <span className="font-semibold">{a.displayName}</span>
                </div>
                <code className="text-[11px] text-slate-400">{a.name}</code>
              </div>
              <button
                onClick={() => toggle(a)}
                className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                  a.enabled ? "bg-emerald-500" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                    a.enabled ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>

            <p className="text-sm text-slate-600 mb-3 line-clamp-2">{a.description}</p>

            <div className="flex flex-wrap gap-1.5 mb-3 text-[11px]">
              <span className="bg-slate-100 text-slate-600 rounded px-2 py-0.5">{audienceLabel[a.audience]}</span>
              {a.createsLead && <span className="bg-sky-100 text-sky-700 rounded px-2 py-0.5">Creates lead</span>}
              {a.createsTicket && <span className="bg-violet-100 text-violet-700 rounded px-2 py-0.5">Creates ticket</span>}
              {a.handoffAfter && <span className="bg-amber-100 text-amber-700 rounded px-2 py-0.5">Hands to human</span>}
              <span className="bg-slate-100 text-slate-600 rounded px-2 py-0.5">{a.fields.length} fields</span>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-3">
              <span>
                {a.stats.triggered} triggered · <span className="text-emerald-600">{a.stats.succeeded} ok</span>
                {!!a.stats.failed && <> · <span className="text-red-600">{a.stats.failed} failed</span></>}
              </span>
              <span className="flex gap-1.5">
                <button className="btn-secondary text-xs" onClick={() => setEditing(a)}>
                  <Pencil size={12} />
                </button>
                <button className="btn-secondary text-xs" onClick={() => remove(a)}>
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
          </div>
        ))}

        {actions.length === 0 && (
          <div className="card p-10 text-center text-slate-400 col-span-full">
            <Zap size={26} className="mx-auto mb-2 text-slate-300" />
            <p className="mb-3">No actions yet — the AI can only talk, not act.</p>
            <button className="btn-primary mx-auto" onClick={() => setEditing("new")}>
              <Plus size={15} /> Create your first action
            </button>
          </div>
        )}
      </div>

      <h2 className="font-semibold mb-3">Recent runs</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Captured</th>
              <th className="px-4 py-3">Result</th>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r._id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">{r.actionName}</td>
                <td className="px-4 py-3">
                  {r.contact?.name || "—"}
                  <div className="text-xs text-slate-400">{r.contact?.waId}</div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate">
                  {Object.entries(r.input || {})
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </td>
                <td className="px-4 py-3">
                  {r.status === "succeeded" ? (
                    <span className="text-emerald-600 text-xs flex items-center gap-1">
                      <CheckCircle2 size={13} /> Sent{r.responseStatus ? ` (${r.responseStatus})` : ""}
                    </span>
                  ) : (
                    <span className="text-red-600 text-xs flex items-center gap-1" title={r.error}>
                      <XCircle size={13} /> {r.error?.slice(0, 40) || "Failed"}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  {r.status === "failed" && (
                    <button className="btn-secondary text-xs" onClick={() => retry(r)}>
                      <RefreshCw size={12} /> Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No action runs yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <ActionModal
          action={editing === "new" ? null : editing}
          numbers={numbers}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

const BLANK_FIELD: ActionField = {
  key: "",
  label: "",
  description: "",
  type: "string",
  required: true,
  options: []
};

function ActionModal({
  action,
  numbers,
  onClose,
  onSaved
}: {
  action: AiAction | null;
  numbers: WabaNumber[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: action?.name || "",
    displayName: action?.displayName || "",
    description: action?.description || "",
    triggerExamples: (action?.triggerExamples || []).join("\n"),
    audience: action?.audience || "any",
    enabled: action?.enabled ?? true,
    numbers: Array.isArray(action?.numbers)
      ? (action!.numbers as any[]).map((n) => (typeof n === "string" ? n : n._id))
      : [],
    fields: action?.fields?.length ? action.fields : [{ ...BLANK_FIELD }],
    webhookUrl: action?.webhookUrl || "",
    webhookMethod: action?.webhookMethod || "POST",
    webhookSecret: action?.webhookSecret || "",
    payloadTemplate: action?.payloadTemplate || "",
    confirmationMessage: action?.confirmationMessage || "",
    addTags: (action?.addTags || []).join(", "),
    addLabels: (action?.addLabels || []).join(", "),
    createsLead: action?.createsLead ?? false,
    createsTicket: action?.createsTicket ?? false,
    handoffAfter: action?.handoffAfter ?? false
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updateField(i: number, patch: Partial<ActionField>) {
    setForm((f) => ({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = {
      ...form,
      triggerExamples: form.triggerExamples.split("\n").map((s) => s.trim()).filter(Boolean),
      addTags: form.addTags.split(",").map((s) => s.trim()).filter(Boolean),
      addLabels: form.addLabels.split(",").map((s) => s.trim()).filter(Boolean),
      fields: form.fields
        .filter((f) => f.key.trim())
        .map((f) => ({ ...f, key: f.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_") }))
    };
    try {
      if (action) await api(`/actions/${action._id}`, { method: "PATCH", body });
      else await api("/actions", { method: "POST", body });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-6 z-50" onClick={onClose}>
      <form
        onSubmit={save}
        className="card w-full max-w-3xl max-h-[88vh] overflow-y-auto p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">{action ? `Edit ${action.displayName}` : "New AI action"}</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Display name</label>
            <input
              className="input"
              placeholder="Book a sales call"
              value={form.displayName}
              onChange={(e) =>
                setForm({
                  ...form,
                  displayName: e.target.value,
                  name: action ? form.name : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_")
                })
              }
              required
            />
          </div>
          <div>
            <label className="label">Machine name (the AI sees this)</label>
            <input
              className="input font-mono text-xs"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              disabled={!!action}
              required
            />
          </div>
        </div>

        <div>
          <label className="label">When should the AI use this? (most important field)</label>
          <textarea
            className="input"
            rows={3}
            placeholder="Use when someone shows interest in the Ultimate 21 Day Weight Loss Challenge and wants to know more, join, or speak to someone about it."
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            required
          />
        </div>

        <div>
          <label className="label">Example customer messages (one per line)</label>
          <textarea
            className="input text-xs"
            rows={3}
            placeholder={"I want to know more about the Ultimate 21 day weight loss challenge\nHow do I join the 21 day programme?\nTell me about your weight loss plan"}
            value={form.triggerExamples}
            onChange={(e) => setForm({ ...form, triggerExamples: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Who can trigger it</label>
            <select
              className="input"
              value={form.audience}
              onChange={(e) => setForm({ ...form, audience: e.target.value as any })}
            >
              <option value="any">Everyone</option>
              <option value="lead">New leads only (not existing customers)</option>
              <option value="customer">Existing customers only</option>
            </select>
          </div>
          <div>
            <label className="label">Limit to numbers (none = all)</label>
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {numbers.map((n) => {
                const on = form.numbers.includes(n._id);
                return (
                  <button
                    type="button"
                    key={n._id}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        numbers: on ? f.numbers.filter((x) => x !== n._id) : [...f.numbers, n._id]
                      }))
                    }
                    className={`text-[11px] rounded-full px-2.5 py-1 border ${
                      on ? "bg-brand-100 border-brand-300 text-brand-700" : "border-slate-200 text-slate-600"
                    }`}
                  >
                    {n.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Fields to collect */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Information the AI must collect</label>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setForm({ ...form, fields: [...form.fields, { ...BLANK_FIELD }] })}
            >
              <Plus size={12} /> Add field
            </button>
          </div>
          <div className="space-y-2">
            {form.fields.map((f, i) => (
              <div key={i} className="border border-slate-200 rounded-lg p-3 grid grid-cols-12 gap-2 items-start">
                <input
                  className="input col-span-3 text-xs"
                  placeholder="key (e.g. preferred_time)"
                  value={f.key}
                  onChange={(e) => updateField(i, { key: e.target.value })}
                />
                <input
                  className="input col-span-5 text-xs"
                  placeholder="What to ask for — the AI reads this"
                  value={f.description}
                  onChange={(e) => updateField(i, { description: e.target.value })}
                />
                <select
                  className="input col-span-2 text-xs"
                  value={f.type}
                  onChange={(e) => updateField(i, { type: e.target.value as any })}
                >
                  <option value="string">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date/time</option>
                  <option value="enum">Choice</option>
                  <option value="boolean">Yes/no</option>
                </select>
                <label className="col-span-1 flex items-center gap-1 text-xs pt-2">
                  <input
                    type="checkbox"
                    className="accent-emerald-600"
                    checked={f.required}
                    onChange={(e) => updateField(i, { required: e.target.checked })}
                  />
                  Req
                </label>
                <button
                  type="button"
                  className="col-span-1 text-slate-400 hover:text-red-600 pt-2"
                  onClick={() => setForm({ ...form, fields: form.fields.filter((_, j) => j !== i) })}
                >
                  <Trash2 size={14} />
                </button>
                {f.type === "enum" && (
                  <input
                    className="input col-span-12 text-xs"
                    placeholder="Options, comma-separated"
                    value={(f.options || []).join(", ")}
                    onChange={(e) =>
                      updateField(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                    }
                  />
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            The AI asks for anything missing before firing, one or two questions at a time.
          </p>
        </div>

        {/* Webhook */}
        <div className="border-t border-slate-200 pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-3">
              <label className="label">Webhook URL</label>
              <input
                className="input font-mono text-xs"
                placeholder="https://api.svastha.app/hooks/sales-call"
                value={form.webhookUrl}
                onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Method</label>
              <select
                className="input"
                value={form.webhookMethod}
                onChange={(e) => setForm({ ...form, webhookMethod: e.target.value as any })}
              >
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Secret (sent as x-svastha-secret)</label>
            <input
              className="input font-mono text-xs"
              value={form.webhookSecret}
              onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Custom payload template (optional JSON — blank sends the standard envelope)</label>
            <textarea
              className="input font-mono text-xs"
              rows={3}
              placeholder={'{"phone":"{{phone}}","name":"{{name}}","slot":"{{preferred_time}}"}'}
              value={form.payloadTemplate}
              onChange={(e) => setForm({ ...form, payloadTemplate: e.target.value })}
            />
          </div>
        </div>

        {/* After firing */}
        <div className="border-t border-slate-200 pt-4 space-y-4">
          <div>
            <label className="label">Confirmation sent to the customer (only after the webhook succeeds)</label>
            <textarea
              className="input"
              rows={3}
              placeholder="Thanks {{name}}! Your call is booked for {{preferred_time}}. Our coach will call you on this number."
              value={form.confirmationMessage}
              onChange={(e) => setForm({ ...form, confirmationMessage: e.target.value })}
              required
            />
            <p className="text-xs text-slate-400 mt-1">
              Use {"{{field_key}}"}, {"{{name}}"} or {"{{ticketReference}}"}.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label">Tag the contact</label>
              <input className="input" value={form.addTags} onChange={(e) => setForm({ ...form, addTags: e.target.value })} />
            </div>
            <div>
              <label className="label">Label the chat</label>
              <input className="input" value={form.addLabels} onChange={(e) => setForm({ ...form, addLabels: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["createsLead", "Create a lead record"],
                ["createsTicket", "Create a support ticket"],
                ["handoffAfter", "Hand to a human afterwards"]
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-emerald-600"
                  checked={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 sticky bottom-0 bg-white pt-3">
          <button className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : action ? "Save changes" : "Create action"}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {action && (
            <span className="text-xs text-slate-400 self-center ml-auto flex items-center gap-1">
              <PlayCircle size={13} /> Test it by messaging the number
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
