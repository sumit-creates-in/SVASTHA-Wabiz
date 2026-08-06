import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Plus } from "lucide-react";
import { api } from "../lib/api";
import type { Template } from "../types";

const statusColor: Record<string, string> = {
  APPROVED: "bg-brand-100 text-brand-700",
  PENDING: "bg-amber-100 text-amber-700",
  REJECTED: "bg-red-100 text-red-700"
};

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", language: "en", category: "MARKETING", bodyText: "" });
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setTemplates(await api<Template[]>("/templates"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    setMsg("");
    try {
      const r = await api<{ synced: number }>("/templates/sync", { method: "POST" });
      setMsg(`Synced ${r.synced} templates from Meta.`);
      load();
    } catch (e: any) {
      setMsg(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      const r = await api<{ note: string }>("/templates", { method: "POST", body: form });
      setMsg(r.note);
      setShowNew(false);
      setForm({ name: "", language: "en", category: "MARKETING", bodyText: "" });
    } catch (err: any) {
      setMsg(`Create failed: ${err.message}`);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Templates</h1>
          <p className="text-sm text-slate-500">Meta-approved message templates for broadcasts</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={sync} disabled={syncing}>
            <RefreshCw size={15} className={syncing ? "animate-spin" : ""} /> Sync from Meta
          </button>
          <button className="btn-primary" onClick={() => setShowNew(!showNew)}>
            <Plus size={15} /> New template
          </button>
        </div>
      </div>

      {msg && <p className="mb-4 text-sm text-slate-600 bg-slate-100 rounded-lg px-4 py-2">{msg}</p>}

      {showNew && (
        <form onSubmit={create} className="card p-5 mb-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Name (lowercase_underscores)</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="label">Language</label>
              <select className="input" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                <option value="en">English</option>
                <option value="en_US">English (US)</option>
                <option value="hi">Hindi</option>
              </select>
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="MARKETING">Marketing</option>
                <option value="UTILITY">Utility</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Body (use {"{{1}}"}, {"{{2}}"} for variables)</label>
            <textarea className="input" rows={4} value={form.bodyText} onChange={(e) => setForm({ ...form, bodyText: e.target.value })} required />
          </div>
          <button className="btn-primary">Submit to Meta for approval</button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {templates.map((t) => (
          <div key={t._id} className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm">{t.name}</span>
              <span className={`text-xs rounded-full px-2 py-0.5 ${statusColor[t.status] || "bg-slate-100 text-slate-500"}`}>
                {t.status}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-2">{t.language} · {t.category}</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{t.bodyText || "(no body)"}</p>
          </div>
        ))}
        {templates.length === 0 && (
          <div className="card p-10 text-center text-slate-400 text-sm col-span-full">
            No templates yet — click "Sync from Meta" to import your approved templates.
          </div>
        )}
      </div>
    </div>
  );
}
