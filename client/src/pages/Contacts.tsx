import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Upload, Search } from "lucide-react";
import { api } from "../lib/api";
import type { Contact } from "../types";

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ waId: "", name: "", tags: "" });

  const load = useCallback(async () => {
    setContacts(await api<Contact[]>(`/contacts?search=${encodeURIComponent(search)}`));
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function addContact(e: React.FormEvent) {
    e.preventDefault();
    await api("/contacts", {
      method: "POST",
      body: {
        waId: form.waId,
        name: form.name,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean)
      }
    });
    setForm({ waId: "", name: "", tags: "" });
    setShowAdd(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this contact?")) return;
    await api(`/contacts/${id}`, { method: "DELETE" });
    load();
  }

  async function importCsv(file: File) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
    const phoneIdx = header.findIndex((h) => ["phone", "waid", "number", "wa_id"].includes(h));
    const nameIdx = header.findIndex((h) => h === "name");
    const tagsIdx = header.findIndex((h) => h === "tags");
    if (phoneIdx === -1) {
      alert("CSV needs a 'phone' column (international format, digits only).");
      return;
    }
    const rows = lines.slice(1).map((l) => {
      const cols = l.split(",");
      return {
        waId: cols[phoneIdx]?.trim(),
        name: nameIdx >= 0 ? cols[nameIdx]?.trim() : "",
        tags: tagsIdx >= 0 ? (cols[tagsIdx] || "").split(";").map((t) => t.trim()).filter(Boolean) : []
      };
    });
    const res = await api<{ imported: number }>("/contacts/import", { method: "POST", body: rows });
    alert(`Imported ${res.imported} contacts.`);
    load();
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Contacts</h1>
          <p className="text-sm text-slate-500">{contacts.length} shown</p>
        </div>
        <div className="flex gap-2">
          <label className="btn-secondary cursor-pointer">
            <Upload size={15} /> Import CSV
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])}
            />
          </label>
          <button className="btn-primary" onClick={() => setShowAdd(!showAdd)}>
            <Plus size={15} /> Add contact
          </button>
        </div>
      </div>

      {showAdd && (
        <form onSubmit={addContact} className="card p-4 mb-5 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-40">
            <label className="label">Phone (intl, digits only)</label>
            <input className="input" placeholder="919876543210" value={form.waId} onChange={(e) => setForm({ ...form, waId: e.target.value })} required />
          </div>
          <div className="flex-1 min-w-40">
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="flex-1 min-w-40">
            <label className="label">Tags (comma-separated)</label>
            <input className="input" placeholder="customer, vip" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </div>
          <button className="btn-primary">Save</button>
        </form>
      )}

      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
        <input className="input pl-9" placeholder="Search by name or number…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Tags</th>
              <th className="px-4 py-3">Last seen</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c._id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{c.name || <span className="text-slate-400">—</span>}</td>
                <td className="px-4 py-3">+{c.waId}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <span key={t} className="bg-brand-100 text-brand-700 text-xs rounded-full px-2 py-0.5">{t}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {c.lastSeenAt ? new Date(c.lastSeenAt).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => remove(c._id)} className="text-slate-400 hover:text-red-600">
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No contacts yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
