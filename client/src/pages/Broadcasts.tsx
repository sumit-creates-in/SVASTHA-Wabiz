import { useCallback, useEffect, useState } from "react";
import { Plus, Send, XCircle, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import type { Broadcast, Template } from "../types";

const statusColor: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  scheduled: "bg-sky-100 text-sky-700",
  running: "bg-amber-100 text-amber-700",
  completed: "bg-brand-100 text-brand-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500"
};

export default function Broadcasts() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    name: "",
    templateName: "",
    templateLanguage: "en",
    bodyParams: "",
    audienceTags: "",
    scheduledAt: ""
  });

  const load = useCallback(async () => {
    setBroadcasts(await api<Broadcast[]>("/broadcasts"));
  }, []);

  useEffect(() => {
    load();
    api<Template[]>("/templates").then(setTemplates).catch(() => {});
    const socket = getSocket();
    const onUpdate = () => load();
    socket.on("broadcast:update", onUpdate);
    const poll = setInterval(load, 10000);
    return () => {
      socket.off("broadcast:update", onUpdate);
      clearInterval(poll);
    };
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const tpl = templates.find((t) => t.name === form.templateName);
    await api("/broadcasts", {
      method: "POST",
      body: {
        name: form.name,
        templateName: form.templateName,
        templateLanguage: tpl?.language || form.templateLanguage,
        bodyParams: form.bodyParams ? form.bodyParams.split("|").map((p) => p.trim()) : [],
        audienceTags: form.audienceTags ? form.audienceTags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        scheduledAt: form.scheduledAt || undefined
      }
    });
    setShowNew(false);
    setForm({ name: "", templateName: "", templateLanguage: "en", bodyParams: "", audienceTags: "", scheduledAt: "" });
    load();
  }

  async function sendNow(id: string) {
    if (!confirm("Send this broadcast now?")) return;
    await api(`/broadcasts/${id}/send`, { method: "POST" });
    load();
  }

  async function cancel(id: string) {
    await api(`/broadcasts/${id}/cancel`, { method: "POST" });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this broadcast?")) return;
    await api(`/broadcasts/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Broadcasts</h1>
          <p className="text-sm text-slate-500">Send approved templates to contact segments</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(!showNew)}>
          <Plus size={15} /> New broadcast
        </button>
      </div>

      {showNew && (
        <form onSubmit={create} className="card p-5 mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Campaign name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="label">Template (approved on Meta)</label>
            <select className="input" value={form.templateName} onChange={(e) => setForm({ ...form, templateName: e.target.value })} required>
              <option value="">Select template…</option>
              {templates.filter((t) => t.status === "APPROVED").map((t) => (
                <option key={t._id} value={t.name}>{t.name} ({t.language})</option>
              ))}
            </select>
            {templates.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">No templates — sync them on the Templates page first.</p>
            )}
          </div>
          <div>
            <label className="label">Body variables (separate with | — use {"{{name}}"} for contact name)</label>
            <input className="input" placeholder="{{name}} | 20% OFF" value={form.bodyParams} onChange={(e) => setForm({ ...form, bodyParams: e.target.value })} />
          </div>
          <div>
            <label className="label">Audience tags (comma-sep, empty = everyone)</label>
            <input className="input" placeholder="customer, vip" value={form.audienceTags} onChange={(e) => setForm({ ...form, audienceTags: e.target.value })} />
          </div>
          <div>
            <label className="label">Schedule (optional)</label>
            <input className="input" type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
          </div>
          <div className="flex items-end">
            <button className="btn-primary">{form.scheduledAt ? "Schedule" : "Save draft"}</button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {broadcasts.map((b) => (
          <div key={b._id} className="card p-5 flex items-center gap-6">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{b.name}</span>
                <span className={`text-xs rounded-full px-2 py-0.5 ${statusColor[b.status] || ""}`}>{b.status}</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Template: {b.templateName} · Audience: {b.audienceTags.length ? b.audienceTags.join(", ") : "everyone"}
                {b.scheduledAt && ` · Scheduled: ${new Date(b.scheduledAt).toLocaleString()}`}
              </div>
            </div>
            <div className="flex gap-5 text-center text-xs text-slate-500">
              <div><div className="text-base font-bold text-slate-800">{b.stats.total}</div>total</div>
              <div><div className="text-base font-bold text-slate-800">{b.stats.sent}</div>sent</div>
              <div><div className="text-base font-bold text-slate-800">{b.stats.delivered}</div>delivered</div>
              <div><div className="text-base font-bold text-slate-800">{b.stats.read}</div>read</div>
              <div><div className="text-base font-bold text-red-600">{b.stats.failed}</div>failed</div>
            </div>
            <div className="flex gap-2">
              {(b.status === "draft" || b.status === "scheduled") && (
                <>
                  <button className="btn-primary text-xs" onClick={() => sendNow(b._id)}><Send size={13} /> Send now</button>
                  <button className="btn-secondary text-xs" onClick={() => remove(b._id)}><Trash2 size={13} /></button>
                </>
              )}
              {b.status === "running" && (
                <button className="btn-secondary text-xs" onClick={() => cancel(b._id)}><XCircle size={13} /> Stop</button>
              )}
            </div>
          </div>
        ))}
        {broadcasts.length === 0 && (
          <div className="card p-10 text-center text-slate-400 text-sm">No broadcasts yet</div>
        )}
      </div>
    </div>
  );
}
