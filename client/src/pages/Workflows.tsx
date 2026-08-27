import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Copy,
  Check,
  Trash2,
  Send,
  BarChart3,
  MoreVertical,
  RefreshCw,
  CheckCircle2,
  XCircle,
  X,
  Pencil
} from "lucide-react";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import type { Workflow, WabaNumber, Template, WorkflowEvent } from "../types";

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden w-28 mt-1">
      <div className={`h-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

export default function Workflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [numbers, setNumbers] = useState<WabaNumber[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState<Workflow | null>(null);
  const [editWorkflow, setEditWorkflow] = useState<Workflow | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [verifiedFilter, setVerifiedFilter] = useState("");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    setWorkflows(await api<Workflow[]>("/workflows"));
  }, []);

  useEffect(() => {
    load();
    api<WabaNumber[]>("/numbers").then(setNumbers).catch(() => { });
    api<Template[]>("/templates").then(setTemplates).catch(() => { });
    const socket = getSocket();
    const onUpdate = () => load();
    socket.on("workflow:update", onUpdate);
    return () => {
      socket.off("workflow:update", onUpdate);
    };
  }, [load]);

  async function toggle(w: Workflow) {
    await api(`/workflows/${w._id}`, { method: "PATCH", body: { enabled: !w.enabled } });
    load();
  }

  async function remove(w: Workflow) {
    if (!confirm(`Delete workflow "${w.name}"?`)) return;
    await api(`/workflows/${w._id}`, { method: "DELETE" });
    load();
  }

  function hookUrl(w: Workflow) {
    return `${window.location.origin}/api/hooks/${w.key}`;
  }

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(""), 1500);
  }

  const filtered = workflows.filter((w) => {
    if (statusFilter === "on" && !w.enabled) return false;
    if (statusFilter === "off" && w.enabled) return false;
    if (verifiedFilter === "yes" && !w.verified) return false;
    if (verifiedFilter === "no" && w.verified) return false;
    if (search && !w.name.toLowerCase().includes(search.toLowerCase()) && !w.templateName.includes(search))
      return false;
    return true;
  });

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Webhook Workflows</h1>
          <p className="text-sm text-slate-500">
            Send an approved template automatically when a customer signs up, registers, books or pays.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setShowReport(true)}>
            <BarChart3 size={15} /> Workflow report
          </button>
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            <Plus size={15} /> Create
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <select className="input max-w-48" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Any status</option>
          <option value="on">Enabled</option>
          <option value="off">Disabled</option>
        </select>
        <select className="input max-w-48" value={verifiedFilter} onChange={(e) => setVerifiedFilter(e.target.value)}>
          <option value="">Any verification</option>
          <option value="yes">Verified</option>
          <option value="no">Not verified</option>
        </select>
        <input
          className="input max-w-64"
          placeholder="Search workflows…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead className="bg-slate-50 text-left text-[11px] text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 w-10">#</th>
              <th className="px-4 py-3">Workflow</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Verified</th>
              <th className="px-4 py-3">Targeted</th>
              <th className="px-4 py-3">Processed</th>
              <th className="px-4 py-3">Delivered</th>
              <th className="px-4 py-3">Opened</th>
              <th className="px-4 py-3">Failed</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((w, i) => (
              <tr key={w._id} className="border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-4 py-4 text-slate-400">{i + 1}</td>
                <td className="px-4 py-4">
                  <button className="font-semibold text-left hover:text-brand-700" onClick={() => setDetail(w)}>
                    {w.name}
                  </button>
                  <div className="text-xs text-slate-500">Template: {w.templateName}</div>
                </td>
                <td className="px-4 py-4">
                  <button
                    onClick={() => toggle(w)}
                    className={`w-11 h-6 rounded-full transition-colors relative ${w.enabled ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    title={w.enabled ? "Enabled" : "Disabled"}
                  >
                    <span
                      className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${w.enabled ? "left-[22px]" : "left-0.5"
                        }`}
                    />
                  </button>
                </td>
                <td className="px-4 py-4">
                  {w.verified ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium">
                      <CheckCircle2 size={14} /> Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-slate-400 text-xs">
                      <XCircle size={14} /> No
                    </span>
                  )}
                </td>
                <td className="px-4 py-4 font-semibold text-sky-600">{w.stats.targeted}</td>
                <td className="px-4 py-4">
                  <div className="text-xs">Sent ({pct(w.stats.sent, w.stats.targeted)}%)</div>
                  <div className="text-xs text-slate-500">
                    {w.stats.sent}/{w.stats.targeted}
                  </div>
                  <Bar value={pct(w.stats.sent, w.stats.targeted)} color="bg-sky-500" />
                </td>
                <td className="px-4 py-4">
                  <div className="text-xs">Delivered ({pct(w.stats.delivered, w.stats.sent)}%)</div>
                  <div className="text-xs text-slate-500">
                    {w.stats.delivered}/{w.stats.sent}
                  </div>
                  <Bar value={pct(w.stats.delivered, w.stats.sent)} color="bg-emerald-500" />
                </td>
                <td className="px-4 py-4">
                  <div className="text-xs">Opened ({pct(w.stats.read, w.stats.delivered)}%)</div>
                  <div className="text-xs text-slate-500">
                    {w.stats.read}/{w.stats.delivered}
                  </div>
                  <Bar value={pct(w.stats.read, w.stats.delivered)} color="bg-amber-500" />
                </td>
                <td className="px-4 py-4">
                  <div className="text-xs text-red-600">{w.stats.failed} failed</div>
                  {!!w.stats.skipped && <div className="text-xs text-slate-400">{w.stats.skipped} skipped</div>}
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      className="btn-secondary text-xs"
                      title="Copy webhook URL"
                      onClick={() => copy(w.secret ? `${hookUrl(w)}?secret=${w.secret}` : hookUrl(w), w._id)}
                    >
                      {copied === w._id ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                    </button>
                    <button className="btn-secondary text-xs" title="Edit" onClick={() => setEditWorkflow(w)}>
                      <Pencil size={13} />
                    </button>
                    <button className="btn-secondary text-xs" title="Details" onClick={() => setDetail(w)}>
                      <MoreVertical size={13} />
                    </button>
                    <button className="btn-secondary text-xs" title="Delete" onClick={() => remove(w)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-slate-400">
                  No workflows yet. Create one to send a template when a customer registers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <WorkflowForm
          numbers={numbers}
          templates={templates}
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            load();
          }}
        />
      )}
      {editWorkflow && (
        <EditWorkflowForm
          workflow={editWorkflow}
          numbers={numbers}
          templates={templates}
          onClose={() => setEditWorkflow(null)}
          onSaved={() => {
            setEditWorkflow(null);
            load();
          }}
        />
      )}
      {detail && (
        <WorkflowDetail
          workflow={detail}
          onClose={() => setDetail(null)}
          onChanged={() => {
            load();
          }}
        />
      )}
      {showReport && <ReportModal onClose={() => setShowReport(false)} />}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-6 z-50" onClick={onClose}>
      <div
        className={`card w-full ${wide ? "max-w-4xl" : "max-w-2xl"} max-h-[86vh] overflow-y-auto p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function WorkflowForm({
  numbers,
  templates,
  onClose,
  onSaved
}: {
  numbers: WabaNumber[];
  templates: Template[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    number: numbers[0]?._id || "",
    templateName: "",
    templateLanguage: "en",
    bodyParams: "",
    headerParams: "",
    phoneField: "phone",
    nameField: "name",
    addTags: "",
    addLabels: "",
    dedupe: "none",
    delayMinutes: 0
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Match by name + language so the exact approved translation is used
  const selected = templates.find(
    (t) => t.name === form.templateName && t.language === form.templateLanguage
  ) ?? templates.find((t) => t.name === form.templateName);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!form.templateName) { setError("Please select a template."); setBusy(false); return; }
      await api("/workflows", {
        method: "POST",
        body: {
          ...form,
          bodyParams: form.bodyParams ? form.bodyParams.split("|").map((p) => p.trim()) : [],
          headerParams: form.headerParams ? form.headerParams.split("|").map((p) => p.trim()) : [],
          addTags: form.addTags.split(",").map((t) => t.trim()).filter(Boolean),
          addLabels: form.addLabels.split(",").map((t) => t.trim()).filter(Boolean),
          delayMinutes: Number(form.delayMinutes) || 0
        }
      });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Create webhook workflow" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Workflow name</label>
            <input
              className="input"
              placeholder="Course reg msg to cust"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Send from number</label>
            <select className="input" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} required>
              <option value="">Select number…</option>
              {numbers.map((n) => (
                <option key={n._id} value={n._id}>
                  {n.label} · {n.displayPhoneNumber} [{n.purpose}]
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">Any number can send AUTHENTICATION / OTP templates regardless of purpose.</p>
          </div>
        </div>

        <div>
          <label className="label">Approved template</label>
          <select
            className="input"
            value={`${form.templateName}||${form.templateLanguage}`}
            onChange={(e) => {
              const [tName, tLang] = e.target.value.split("||");
              setForm({ ...form, templateName: tName, templateLanguage: tLang });
            }}
            required
          >
            <option value="">Select template…</option>
            {templates
              .filter((t) => t.status === "APPROVED")
              .map((t) => (
                <option key={t._id} value={`${t.name}||${t.language}`}>
                  {t.name} ({t.language}) · {t.category}
                </option>
              ))}
          </select>
          {selected && (
            <p className="text-xs text-slate-500 mt-1 bg-slate-50 rounded-lg p-2 whitespace-pre-wrap">
              {selected.bodyText}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Phone field in the payload</label>
            <input className="input" value={form.phoneField} onChange={(e) => setForm({ ...form, phoneField: e.target.value })} />
            <p className="text-xs text-slate-400 mt-1">Dot paths work: customer.phone</p>
          </div>
          <div>
            <label className="label">Name field in the payload</label>
            <input className="input" value={form.nameField} onChange={(e) => setForm({ ...form, nameField: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="label">Body variables — separate with | , reference payload fields with {"{{field}}"}</label>
          <input
            className="input font-mono text-xs"
            placeholder="{{name}} | {{course.title}} | {{start_date}}"
            value={form.bodyParams}
            onChange={(e) => setForm({ ...form, bodyParams: e.target.value })}
          />
          {selected && selected.variableCount > 0 && (
            <p className="text-xs text-amber-600 mt-1">
              This template expects {selected.variableCount} variable{selected.variableCount > 1 ? "s" : ""}.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Send only once?</label>
            <select className="input" value={form.dedupe} onChange={(e) => setForm({ ...form, dedupe: e.target.value })}>
              <option value="none">Every time</option>
              <option value="once_per_contact">Once per contact</option>
              <option value="once_per_day">Once per contact per day</option>
            </select>
          </div>
          <div>
            <label className="label">Delay (minutes)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={form.delayMinutes}
              onChange={(e) => setForm({ ...form, delayMinutes: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Tag the contact</label>
            <input className="input" placeholder="course-signup" value={form.addTags} onChange={(e) => setForm({ ...form, addTags: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="label">Label the chat (helps lead management)</label>
          <input className="input" placeholder="Lead, Course-Reg" value={form.addLabels} onChange={(e) => setForm({ ...form, addLabels: e.target.value })} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create workflow"}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditWorkflowForm({
  workflow,
  numbers,
  templates,
  onClose,
  onSaved
}: {
  workflow: Workflow;
  numbers: WabaNumber[];
  templates: Template[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const numberId = typeof workflow.number === "string" ? workflow.number : workflow.number._id;
  const [form, setForm] = useState({
    name: workflow.name,
    description: workflow.description || "",
    number: numberId,
    templateName: workflow.templateName,
    templateLanguage: workflow.templateLanguage,
    bodyParams: (workflow.bodyParams || []).join(" | "),
    headerParams: (workflow.headerParams || []).join(" | "),
    phoneField: workflow.phoneField,
    nameField: workflow.nameField || "",
    addTags: (workflow.addTags || []).join(", "),
    addLabels: (workflow.addLabels || []).join(", "),
    dedupe: workflow.dedupe,
    delayMinutes: workflow.delayMinutes ?? 0
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selected =
    templates.find((t) => t.name === form.templateName && t.language === form.templateLanguage) ??
    templates.find((t) => t.name === form.templateName);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!form.templateName) { setError("Please select a template."); setBusy(false); return; }
      await api(`/workflows/${workflow._id}`, {
        method: "PATCH",
        body: {
          ...form,
          bodyParams: form.bodyParams ? form.bodyParams.split("|").map((p) => p.trim()) : [],
          headerParams: form.headerParams ? form.headerParams.split("|").map((p) => p.trim()) : [],
          addTags: form.addTags.split(",").map((t) => t.trim()).filter(Boolean),
          addLabels: form.addLabels.split(",").map((t) => t.trim()).filter(Boolean),
          delayMinutes: Number(form.delayMinutes) || 0
        }
      });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit — ${workflow.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Workflow name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Send from number</label>
            <select
              className="input"
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
              required
            >
              <option value="">Select number…</option>
              {numbers.map((n) => (
                <option key={n._id} value={n._id}>
                  {n.label} · {n.displayPhoneNumber} [{n.purpose}]
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">Any number can send AUTHENTICATION / OTP templates regardless of purpose.</p>
          </div>
        </div>

        <div>
          <label className="label">Approved template</label>
          <select
            className="input"
            value={`${form.templateName}||${form.templateLanguage}`}
            onChange={(e) => {
              const [tName, tLang] = e.target.value.split("||");
              setForm({ ...form, templateName: tName, templateLanguage: tLang });
            }}
            required
          >
            <option value="">Select template…</option>
            {templates
              .filter((t) => t.status === "APPROVED")
              .map((t) => (
                <option key={t._id} value={`${t.name}||${t.language}`}>
                  {t.name} ({t.language}) · {t.category}
                </option>
              ))}
          </select>
          {selected && (
            <p className="text-xs text-slate-500 mt-1 bg-slate-50 rounded-lg p-2 whitespace-pre-wrap">
              {selected.bodyText}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Phone field in the payload</label>
            <input
              className="input"
              value={form.phoneField}
              onChange={(e) => setForm({ ...form, phoneField: e.target.value })}
            />
            <p className="text-xs text-slate-400 mt-1">Dot paths work: customer.phone</p>
          </div>
          <div>
            <label className="label">Name field in the payload</label>
            <input
              className="input"
              value={form.nameField}
              onChange={(e) => setForm({ ...form, nameField: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="label">Body variables — separate with | , reference payload fields with {"{{field}}"}</label>
          <input
            className="input font-mono text-xs"
            placeholder="{{name}} | {{course.title}} | {{start_date}}"
            value={form.bodyParams}
            onChange={(e) => setForm({ ...form, bodyParams: e.target.value })}
          />
          {selected && selected.variableCount > 0 && (
            <p className="text-xs text-amber-600 mt-1">
              This template expects {selected.variableCount} variable{selected.variableCount > 1 ? "s" : ""}.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Send only once?</label>
            <select
              className="input"
              value={form.dedupe}
              onChange={(e) => setForm({ ...form, dedupe: e.target.value as 'none' | 'once_per_contact' | 'once_per_day' })}
            >
              <option value="none">Every time</option>
              <option value="once_per_contact">Once per contact</option>
              <option value="once_per_day">Once per contact per day</option>
            </select>
          </div>
          <div>
            <label className="label">Delay (minutes)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={form.delayMinutes}
              onChange={(e) => setForm({ ...form, delayMinutes: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Tag the contact</label>
            <input
              className="input"
              placeholder="course-signup"
              value={form.addTags}
              onChange={(e) => setForm({ ...form, addTags: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="label">Label the chat (helps lead management)</label>
          <input
            className="input"
            placeholder="Lead, Course-Reg"
            value={form.addLabels}
            onChange={(e) => setForm({ ...form, addLabels: e.target.value })}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}


function WorkflowDetail({
  workflow,
  onClose,
  onChanged
}: {
  workflow: Workflow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [events, setEvents] = useState<WorkflowEvent[]>([]);

  // Build initial test payload from actual workflow fields
  function buildInitialPayload(): string {
    const obj: Record<string, string> = {};
    if (workflow.phoneField) obj[workflow.phoneField] = "918604157036";
    if (workflow.nameField) obj[workflow.nameField] = "Sachin Gupta";
    // add a placeholder for each body variable like {{otp_code}}
    // skip pure numeric keys like {{1}} — those are template slot numbers, not payload fields
    (workflow.bodyParams || []).forEach((p) => {
      const matches = p.match(/\{\{\s*([\w.]+)\s*\}\}/g) || [];
      matches.forEach((m) => {
        const key = m.replace(/\{\{\s*|\s*\}\}/g, "");
        if (key && /\D/.test(key) && !(key in obj)) obj[key] = `<${key}>`;
      });
    });
    return JSON.stringify(obj, null, 2);
  }

  const [testPayload, setTestPayload] = useState(() => buildInitialPayload());
  const [testResult, setTestResult] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const url = `${window.location.origin}/api/hooks/${workflow.key}`;

  const loadEvents = useCallback(async () => {
    setEvents(await api<WorkflowEvent[]>(`/workflows/${workflow._id}/events`));
  }, [workflow._id]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  async function runTest() {
    setBusy(true);
    setTestResult("");
    try {
      const parsed = JSON.parse(testPayload);
      const r = await api<{ status: string; reason?: string }>(`/workflows/${workflow._id}/test`, {
        method: "POST",
        body: parsed
      });
      setTestResult(`${r.status}${r.reason ? ` — ${r.reason}` : ""}`);
      loadEvents();
      onChanged();
    } catch (e: any) {
      setTestResult(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const curlPayload: Record<string, string> = {};
  if (workflow.phoneField) curlPayload[workflow.phoneField] = "919876543210";
  if (workflow.nameField) curlPayload[workflow.nameField] = "Asha";
  (workflow.bodyParams || []).forEach((p) => {
    const matches = p.match(/\{\{\s*([\w.]+)\s*\}\}/g) || [];
    matches.forEach((m) => {
      const key = m.replace(/\{\{\s*|\s*\}\}/g, "");
      // skip pure numeric keys like {{1}} — those are template slot numbers, not payload fields
      if (key && /\D/.test(key) && !(key in curlPayload)) curlPayload[key] = `<${key}>`;
    });
  });
  const curl = workflow.secret
    ? `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'x-svastha-secret: ${workflow.secret}' \\\n  -d '${JSON.stringify(curlPayload)}'`
    : `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(curlPayload)}'`;

  return (
    <Modal title={workflow.name} onClose={onClose} wide>
      <div className="space-y-5">
        <div>
          <label className="label">Webhook URL — point your website / app / Zapier here</label>
          <div className="flex gap-2">
            <input className="input font-mono text-xs" readOnly value={url} />
            <button className="btn-secondary shrink-0" onClick={() => navigator.clipboard.writeText(url)}>
              <Copy size={14} />
            </button>
          </div>
          <label className="label mt-3">Secret <span className="text-slate-400 font-normal">(optional — send as header x-svastha-secret or ?secret=)</span></label>
          <div className="flex gap-2">
            <input
              className="input font-mono text-xs"
              readOnly
              value={workflow.secret || ""}
              placeholder="No secret — endpoint is public"
            />
            {workflow.secret ? (
              <>
                <button
                  className="btn-secondary shrink-0"
                  title="Rotate secret"
                  onClick={async () => {
                    if (!confirm("Rotate the secret? Existing integrations will stop working until updated.")) return;
                    await api(`/workflows/${workflow._id}/rotate-secret`, { method: "POST" });
                    onChanged();
                    onClose();
                  }}
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  className="btn-secondary shrink-0 text-red-500 hover:text-red-600"
                  title="Remove secret (make public)"
                  onClick={async () => {
                    if (!confirm("Remove secret? The endpoint will become public — anyone with the URL can trigger it.")) return;
                    await api(`/workflows/${workflow._id}/rotate-secret`, { method: "POST", body: JSON.stringify({ clear: true }) });
                    onChanged();
                    onClose();
                  }}
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <button
                className="btn-secondary shrink-0"
                title="Generate a secret"
                onClick={async () => {
                  await api(`/workflows/${workflow._id}/rotate-secret`, { method: "POST" });
                  onChanged();
                  onClose();
                }}
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="label">Example request</label>
          <pre className="bg-slate-900 text-slate-100 text-xs rounded-lg p-4 overflow-x-auto">{curl}</pre>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Test payload</label>
            <textarea
              className="input font-mono text-xs"
              rows={6}
              value={testPayload}
              onChange={(e) => setTestPayload(e.target.value)}
            />
            <button className="btn-primary mt-2" onClick={runTest} disabled={busy}>
              <Send size={14} /> {busy ? "Sending…" : "Send test"}
            </button>
            {testResult && <p className="text-sm mt-2 text-slate-600">Result: {testResult}</p>}
          </div>
          <div>
            <label className="label">Recent events</label>
            <div className="border border-slate-200 rounded-lg max-h-60 overflow-y-auto divide-y divide-slate-100">
              {events.map((e) => (
                <div key={e._id} className="px-3 py-2 text-xs flex items-center justify-between gap-2">
                  <span className="font-mono">{e.waId || "—"}</span>
                  <span
                    className={
                      ["sent", "delivered", "read"].includes(e.status)
                        ? "text-emerald-600"
                        : e.status === "failed"
                          ? "text-red-600"
                          : "text-slate-400"
                    }
                  >
                    {e.status}
                    {e.error ? ` · ${e.error}` : ""}
                  </span>
                </div>
              ))}
              {events.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-400">No events yet</p>}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ReportModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ totals: any; recent: WorkflowEvent[] } | null>(null);
  useEffect(() => {
    api<{ totals: any; recent: WorkflowEvent[] }>("/workflows-report").then(setData).catch(() => { });
  }, []);
  return (
    <Modal title="Workflow report" onClose={onClose} wide>
      {!data ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["Targeted", data.totals.targeted],
              ["Sent", data.totals.sent],
              ["Delivered", data.totals.delivered],
              ["Opened", data.totals.read],
              ["Failed", data.totals.failed],
              ["Skipped", data.totals.skipped]
            ].map(([label, val]) => (
              <div key={String(label)} className="bg-slate-50 rounded-lg p-4">
                <div className="text-2xl font-bold">{String(val)}</div>
                <div className="text-xs text-slate-500">{String(label)}</div>
              </div>
            ))}
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-2">Recent events</h3>
            <div className="border border-slate-200 rounded-lg max-h-80 overflow-y-auto divide-y divide-slate-100">
              {data.recent.map((e) => (
                <div key={e._id} className="px-4 py-2 text-xs flex justify-between">
                  <span>
                    <span className="font-medium">{e.workflow?.name || "—"}</span>{" "}
                    <span className="font-mono text-slate-500">{e.waId}</span>
                  </span>
                  <span className="text-slate-500">
                    {e.status} · {new Date(e.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
