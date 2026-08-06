import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import { api } from "../lib/api";
import type { KnowledgeDoc } from "../types";

export default function Knowledge() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [editing, setEditing] = useState<Partial<KnowledgeDoc> | null>(null);

  const load = useCallback(async () => {
    setDocs(await api<KnowledgeDoc[]>("/knowledge"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (editing._id) {
      await api(`/knowledge/${editing._id}`, { method: "PATCH", body: { title: editing.title, content: editing.content } });
    } else {
      await api("/knowledge", { method: "POST", body: { title: editing.title, content: editing.content } });
    }
    setEditing(null);
    load();
  }

  async function toggle(d: KnowledgeDoc) {
    await api(`/knowledge/${d._id}`, { method: "PATCH", body: { enabled: !d.enabled } });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this document?")) return;
    await api(`/knowledge/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">AI Knowledge Base</h1>
          <p className="text-sm text-slate-500">
            Everything here is given to the AI so it can answer customer questions accurately — add your products, prices, policies, FAQs, hours.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setEditing({ title: "", content: "" })}>
          <Plus size={15} /> Add document
        </button>
      </div>

      {editing && (
        <form onSubmit={save} className="card p-5 mb-6 space-y-4">
          <div>
            <label className="label">Title</label>
            <input className="input" value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} required />
          </div>
          <div>
            <label className="label">Content</label>
            <textarea className="input font-mono text-xs" rows={10} value={editing.content || ""} onChange={(e) => setEditing({ ...editing, content: e.target.value })} required />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary">Save</button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {docs.map((d) => (
          <div key={d._id} className="card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="font-semibold">{d.title}</span>
                <button
                  onClick={() => toggle(d)}
                  className={`text-xs rounded-full px-2.5 py-0.5 ${d.enabled ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}
                >
                  {d.enabled ? "Active" : "Disabled"}
                </button>
              </div>
              <div className="flex gap-2">
                <button className="text-slate-400 hover:text-slate-700" onClick={() => setEditing(d)}><Pencil size={15} /></button>
                <button className="text-slate-400 hover:text-red-600" onClick={() => remove(d._id)}><Trash2 size={15} /></button>
              </div>
            </div>
            <p className="text-sm text-slate-600 mt-2 line-clamp-3 whitespace-pre-wrap">{d.content}</p>
          </div>
        ))}
        {docs.length === 0 && !editing && (
          <div className="card p-10 text-center text-slate-400 text-sm">
            No knowledge yet — the AI will answer from general knowledge only. Add your business info to make it accurate.
          </div>
        )}
      </div>
    </div>
  );
}
