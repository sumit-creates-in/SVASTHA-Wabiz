import { useEffect, useState } from "react";
import { X, Pencil, Trash2, Check, Tag } from "lucide-react";
import { api } from "../../lib/api";

export default function TagManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setTags(await api<{ tag: string; count: number }[]>("/contacts/tags"));
  }
  useEffect(() => {
    load();
  }, []);

  async function rename(from: string) {
    if (!newName.trim() || newName.trim() === from) {
      setEditing(null);
      return;
    }
    try {
      await api("/contacts/tags/rename", { method: "POST", body: { from, to: newName.trim() } });
      setEditing(null);
      await load();
      onChanged();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function remove(tag: string, count: number) {
    if (!confirm(`Remove the tag "${tag}" from ${count} contact${count === 1 ? "" : "s"}? The contacts themselves are kept.`))
      return;
    await api("/contacts/tags/delete", { method: "POST", body: { tag } });
    await load();
    onChanged();
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-bold flex items-center gap-2">
            <Tag size={17} /> Manage tags
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
          {tags.map((t) => (
            <div key={t.tag} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-50">
              {editing === t.tag ? (
                <>
                  <input
                    className="input text-sm py-1 flex-1"
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename(t.tag);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <button className="text-emerald-600" onClick={() => rename(t.tag)}>
                    <Check size={16} />
                  </button>
                </>
              ) : (
                <>
                  <span className="bg-brand-100 text-brand-700 text-xs rounded-full px-2.5 py-1">{t.tag}</span>
                  <span className="text-xs text-slate-400 flex-1">{t.count.toLocaleString()} contacts</span>
                  <button
                    className="text-slate-400 hover:text-slate-700"
                    title="Rename (or merge into another tag)"
                    onClick={() => {
                      setEditing(t.tag);
                      setNewName(t.tag);
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button className="text-slate-400 hover:text-red-600" onClick={() => remove(t.tag, t.count)}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
          {!tags.length && <p className="text-sm text-slate-400 text-center py-8">No tags yet.</p>}
        </div>
        <p className="px-6 py-3 border-t border-slate-200 text-xs text-slate-500">
          Tip: rename a tag to one that already exists to merge them.
        </p>
      </div>
    </div>
  );
}
