import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  Plus,
  Trash2,
  Sparkles,
  FileText,
  MessageSquare,
  PlayCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { api } from "../lib/api";
import type { FollowUpSequence, FollowUpStep, FollowUpJob, Template, WabaNumber } from "../types";

function humanDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  if (h < 24) return `${h % 1 === 0 ? h : h.toFixed(1)} hours`;
  return `${(h / 24).toFixed(1)} days`;
}

const modeIcon = {
  ai: <Sparkles size={14} className="text-brand-600" />,
  text: <MessageSquare size={14} className="text-slate-500" />,
  template: <FileText size={14} className="text-violet-600" />,
};

const jobStatusCls: Record<string, string> = {
  pending: "bg-sky-100 text-sky-700",
  sent: "bg-emerald-100 text-emerald-700",
  skipped: "bg-slate-100 text-slate-500",
  cancelled: "bg-slate-100 text-slate-400",
  failed: "bg-red-100 text-red-600",
};

export default function FollowUps() {
  const [sequences, setSequences] = useState<FollowUpSequence[]>([]);
  const [jobs, setJobs] = useState<FollowUpJob[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [numbers, setNumbers] = useState<WabaNumber[]>([]);
  const [jobFilter, setJobFilter] = useState("pending");
  const [editing, setEditing] = useState<FollowUpSequence | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setSequences(await api<FollowUpSequence[]>("/followups"));
    setJobs(await api<FollowUpJob[]>(`/followup-jobs?status=${jobFilter}`));
  }, [jobFilter]);

  useEffect(() => {
    load();
    api<Template[]>("/templates").then(setTemplates).catch(() => {});
    api<WabaNumber[]>("/numbers").then(setNumbers).catch(() => {});
  }, [load]);

  async function toggle(s: FollowUpSequence) {
    await api(`/followups/${s._id}`, { method: "PATCH", body: { enabled: !s.enabled } });
    load();
  }

  async function runNow(j: FollowUpJob) {
    await api(`/followup-jobs/${j._id}/run-now`, { method: "POST" });
    setMsg("Queued to run within the next minute.");
    load();
  }

  async function cancelJob(j: FollowUpJob) {
    await api(`/followup-jobs/${j._id}/cancel`, { method: "POST" });
    load();
  }

  const approved = templates.filter((t) => t.status === "APPROVED");

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Follow-ups</h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            When a lead stops replying, the AI nudges them — picking up exactly where the conversation stopped.
            Nudges stop the moment they reply, book a call, or the AI judges that chasing would be unwelcome.
          </p>
        </div>
      </div>

      {msg && <p className="mb-4 text-sm text-slate-700 bg-slate-100 rounded-lg px-4 py-2">{msg}</p>}

      {/* Sequences */}
      <div className="space-y-4 mb-8">
        {sequences.map((s) => {
          const templateStep = s.steps.find((st) => st.mode === "template");
          const needsTemplate = templateStep && !templateStep.templateName;
          return (
            <div key={s._id} className="card p-5">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Clock size={16} className={s.enabled ? "text-brand-600" : "text-slate-300"} />
                    <span className="font-semibold">{s.name}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {s.audience === "lead" ? "New leads" : s.audience === "customer" ? "Existing customers" : "Everyone"}
                    {" · quiet "}
                    {s.quietHoursStart}–{s.quietHoursEnd} {s.timezone.split("/")[1]}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn-secondary text-xs" onClick={() => setEditing(s)}>
                    Edit steps
                  </button>
                  <button
                    onClick={() => toggle(s)}
                    className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                      s.enabled ? "bg-emerald-500" : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                        s.enabled ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {needsTemplate && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 flex items-start gap-2 mb-3">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    The 24h+ step has no template set, so it will be skipped. Once you have an approved
                    marketing template, sync it and pick it in Edit steps.
                  </span>
                </div>
              )}

              {/* Timeline */}
              <div className="flex flex-wrap gap-2 mb-4">
                {s.steps.map((st, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 text-xs"
                  >
                    {modeIcon[st.mode]}
                    <div>
                      <div className="font-medium">
                        {humanDelay(st.afterMinutes)} of silence
                        {st.afterMinutes >= 1440 && (
                          <span className="text-violet-600 ml-1">· template required</span>
                        )}
                      </div>
                      <div className="text-slate-400">
                        {st.mode === "ai"
                          ? "AI writes it"
                          : st.mode === "template"
                            ? st.templateName || "no template set"
                            : "fixed text"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-6 text-xs text-slate-500 border-t border-slate-100 pt-3">
                <span>{s.stats.scheduled} queued</span>
                <span className="text-emerald-600">{s.stats.sent} sent</span>
                <span className="text-sky-600">{s.stats.replied} replies won back</span>
                <span>{s.stats.skipped} skipped</span>
              </div>
            </div>
          );
        })}
        {sequences.length === 0 && (
          <div className="card p-10 text-center text-slate-400">
            No follow-up sequences yet. One is created automatically on first boot.
          </div>
        )}
      </div>

      {/* Queue */}
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-semibold">Nudge queue</h2>
        <div className="flex gap-1.5 ml-2">
          {["pending", "sent", "skipped", "failed"].map((s) => (
            <button
              key={s}
              onClick={() => setJobFilter(s)}
              className={`text-xs rounded-full px-3 py-1 capitalize ${
                jobFilter === s ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Step</th>
              <th className="px-4 py-3">{jobFilter === "pending" ? "Sends at" : "When"}</th>
              <th className="px-4 py-3">Message / reason</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j._id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <div className="font-medium">{j.contact?.name || "—"}</div>
                  <div className="text-xs text-slate-400">
                    {j.contact?.masked ? j.contact.waId : `+${j.contact?.waId || ""}`}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs bg-slate-100 rounded px-2 py-0.5">#{j.stepIndex + 1}</span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {new Date(jobFilter === "pending" ? j.runAt : j.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600 max-w-md">
                  <span className={`inline-block rounded-full px-2 py-0.5 mr-2 ${jobStatusCls[j.status]}`}>
                    {j.status}
                  </span>
                  {j.sentText || j.reason || "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {j.status === "pending" && (
                    <span className="flex gap-1.5 justify-end">
                      <button className="btn-secondary text-xs" onClick={() => runNow(j)} title="Send now">
                        <PlayCircle size={13} />
                      </button>
                      <button className="btn-secondary text-xs" onClick={() => cancelJob(j)} title="Cancel">
                        <XCircle size={13} />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  Nothing {jobFilter} right now
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <StepEditor
          sequence={editing}
          templates={approved}
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

function StepEditor({
  sequence,
  templates,
  numbers,
  onClose,
  onSaved,
}: {
  sequence: FollowUpSequence;
  templates: Template[];
  numbers: WabaNumber[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: sequence.name,
    audience: sequence.audience,
    steps: sequence.steps.map((s) => ({ ...s })),
    stopLabels: sequence.stopLabels.join(", "),
    skipWhenAiOff: sequence.skipWhenAiOff,
    quietHoursStart: sequence.quietHoursStart,
    quietHoursEnd: sequence.quietHoursEnd,
    numbers: Array.isArray(sequence.numbers)
      ? (sequence.numbers as any[]).map((n) => (typeof n === "string" ? n : n._id))
      : [],
  });
  const [busy, setBusy] = useState(false);

  function updateStep(i: number, patch: Partial<FollowUpStep>) {
    setForm((f) => ({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/followups/${sequence._id}`, {
        method: "PATCH",
        body: {
          ...form,
          stopLabels: form.stopLabels.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
      onSaved();
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
        <h2 className="text-lg font-bold">Edit follow-up sequence</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Applies to</label>
            <select
              className="input"
              value={form.audience}
              onChange={(e) => setForm({ ...form, audience: e.target.value as any })}
            >
              <option value="lead">New leads only</option>
              <option value="customer">Existing customers only</option>
              <option value="any">Everyone</option>
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Steps</label>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() =>
                setForm({ ...form, steps: [...form.steps, { afterMinutes: 240, mode: "ai" }] })
              }
            >
              <Plus size={12} /> Add step
            </button>
          </div>
          <div className="space-y-3">
            {form.steps.map((s, i) => {
              const outsideWindow = s.afterMinutes >= 1440;
              return (
                <div key={i} className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-4">
                      <label className="label">Send after (minutes of silence)</label>
                      <input
                        className="input text-xs"
                        type="number"
                        value={s.afterMinutes}
                        onChange={(e) => updateStep(i, { afterMinutes: Number(e.target.value) })}
                      />
                      <div className="text-[11px] text-slate-400 mt-0.5">{humanDelay(s.afterMinutes)}</div>
                    </div>
                    <div className="col-span-4">
                      <label className="label">Message type</label>
                      <select
                        className="input text-xs"
                        value={s.mode}
                        onChange={(e) => updateStep(i, { mode: e.target.value as any })}
                        disabled={outsideWindow}
                      >
                        <option value="ai">AI writes it</option>
                        <option value="text">Fixed text</option>
                        <option value="template">Approved template</option>
                      </select>
                      {outsideWindow && (
                        <div className="text-[11px] text-violet-600 mt-0.5">
                          Past 24h — template only
                        </div>
                      )}
                    </div>
                    <div className="col-span-3 text-xs text-slate-500 pt-5">{s.note}</div>
                    <button
                      type="button"
                      className="col-span-1 text-slate-400 hover:text-red-600 pt-5"
                      onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {s.mode === "text" && !outsideWindow && (
                    <textarea
                      className="input text-xs"
                      rows={2}
                      placeholder="Hi {{name}}, still thinking about the challenge?"
                      value={s.text || ""}
                      onChange={(e) => updateStep(i, { text: e.target.value })}
                    />
                  )}

                  {(s.mode === "template" || outsideWindow) && (
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        className="input text-xs"
                        value={s.templateName || ""}
                        onChange={(e) => updateStep(i, { templateName: e.target.value })}
                      >
                        <option value="">Select an approved template…</option>
                        {templates.map((t) => (
                          <option key={t._id} value={t.name}>
                            {t.name} ({t.language})
                          </option>
                        ))}
                      </select>
                      <input
                        className="input text-xs"
                        placeholder="Variables, separate with | — {{name}} works"
                        value={(s.templateParams || []).join(" | ")}
                        onChange={(e) =>
                          updateStep(i, {
                            templateParams: e.target.value.split("|").map((x) => x.trim()).filter(Boolean),
                          })
                        }
                      />
                      {templates.length === 0 && (
                        <p className="col-span-2 text-[11px] text-amber-600">
                          No approved templates yet. Sync them on the Templates page once Meta approves one.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Quiet hours start</label>
            <input
              className="input"
              type="time"
              value={form.quietHoursStart}
              onChange={(e) => setForm({ ...form, quietHoursStart: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Quiet hours end</label>
            <input
              className="input"
              type="time"
              value={form.quietHoursEnd}
              onChange={(e) => setForm({ ...form, quietHoursEnd: e.target.value })}
            />
          </div>
        </div>
        <p className="text-xs text-slate-400 -mt-2">
          Nudges due during quiet hours wait until the morning instead of arriving at midnight.
        </p>

        <div>
          <label className="label">Stop chasing when the chat has any of these labels</label>
          <input
            className="input"
            value={form.stopLabels}
            onChange={(e) => setForm({ ...form, stopLabels: e.target.value })}
          />
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 accent-emerald-600"
            checked={form.skipWhenAiOff}
            onChange={(e) => setForm({ ...form, skipWhenAiOff: e.target.checked })}
          />
          Don't send nudges when the AI is paused or a human has taken over the chat
        </label>

        <div>
          <label className="label">Limit to numbers (none = all)</label>
          <div className="flex flex-wrap gap-1.5">
            {numbers.map((n) => {
              const on = form.numbers.includes(n._id);
              return (
                <button
                  type="button"
                  key={n._id}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      numbers: on ? f.numbers.filter((x) => x !== n._id) : [...f.numbers, n._id],
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

        <div className="flex gap-2 sticky bottom-0 bg-white pt-3">
          <button className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save sequence"}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
