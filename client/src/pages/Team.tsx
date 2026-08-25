import { useCallback, useEffect, useState } from "react";
import { UserPlus, EyeOff, Eye, Trash2, Pencil, ShieldCheck, Check } from "lucide-react";
import { api } from "../lib/api";
import type { TeamMember, PermissionDef, WabaNumber } from "../types";

const roleColor: Record<string, string> = {
  admin: "bg-indigo-100 text-indigo-700",
  manager: "bg-sky-100 text-sky-700",
  agent: "bg-slate-100 text-slate-600"
};

export default function Team() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [permissions, setPermissions] = useState<PermissionDef[]>([]);
  const [presets, setPresets] = useState<Record<string, string[]>>({});
  const [numbers, setNumbers] = useState<WabaNumber[]>([]);
  const [editing, setEditing] = useState<TeamMember | "new" | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setMembers(await api<TeamMember[]>("/team"));
  }, []);

  useEffect(() => {
    load();
    api<{ permissions: PermissionDef[]; presets: Record<string, string[]> }>("/team/permissions")
      .then((d) => {
        setPermissions(d.permissions);
        setPresets(d.presets);
      })
      .catch(() => {});
    api<WabaNumber[]>("/numbers").then(setNumbers).catch(() => {});
  }, [load]);

  async function toggleActive(m: TeamMember) {
    try {
      await api(`/team/${m._id}`, { method: "PATCH", body: { active: !m.active } });
      load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function toggleMask(m: TeamMember) {
    await api(`/team/${m._id}`, { method: "PATCH", body: { maskPhoneNumbers: !m.maskPhoneNumbers } });
    load();
  }

  async function remove(m: TeamMember) {
    if (!confirm(`Remove ${m.name}? They lose access immediately.`)) return;
    try {
      await api(`/team/${m._id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Team</h1>
          <p className="text-sm text-slate-500">
            Control what each person can see and do. Permissions are enforced on the server, not just hidden in
            the interface.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setEditing("new")}>
          <UserPlus size={15} /> Add team member
        </button>
      </div>

      {msg && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{msg}</p>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Numbers</th>
              <th className="px-4 py-3">Permissions</th>
              <th className="px-4 py-3">Phone masking</th>
              <th className="px-4 py-3">Last login</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m._id} className={`border-t border-slate-100 ${!m.active ? "opacity-50" : ""}`}>
                <td className="px-4 py-4">
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-slate-500">{m.email}</div>
                </td>
                <td className="px-4 py-4">
                  <span className={`text-xs rounded-full px-2 py-0.5 capitalize ${roleColor[m.role]}`}>
                    {m.role}
                  </span>
                  {!m.active && <div className="text-[11px] text-red-500 mt-1">Disabled</div>}
                </td>
                <td className="px-4 py-4 text-xs">
                  {m.allowedNumbers?.length
                    ? m.allowedNumbers.map((n) => n.label).join(", ")
                    : <span className="text-slate-400">All numbers</span>}
                </td>
                <td className="px-4 py-4">
                  {m.role === "admin" ? (
                    <span className="text-xs text-indigo-600 flex items-center gap-1">
                      <ShieldCheck size={13} /> Full access
                    </span>
                  ) : (
                    <span className="text-xs text-slate-600">
                      {m.effectivePermissions?.length || 0} of {permissions.length}
                    </span>
                  )}
                </td>
                <td className="px-4 py-4">
                  <button
                    onClick={() => toggleMask(m)}
                    className={`inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 ${
                      m.maskPhoneNumbers
                        ? "bg-amber-100 text-amber-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                    title="Toggle phone number masking"
                  >
                    {m.maskPhoneNumbers ? <EyeOff size={12} /> : <Eye size={12} />}
                    {m.maskPhoneNumbers ? "Masked" : "Full number"}
                  </button>
                </td>
                <td className="px-4 py-4 text-xs text-slate-500">
                  {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString() : "Never"}
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center justify-end gap-1.5">
                    <button className="btn-secondary text-xs" onClick={() => setEditing(m)}>
                      <Pencil size={13} />
                    </button>
                    <button className="btn-secondary text-xs" onClick={() => toggleActive(m)}>
                      {m.active ? "Disable" : "Enable"}
                    </button>
                    <button className="btn-secondary text-xs" onClick={() => remove(m)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                  No team members yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 card p-5 bg-slate-50/60">
        <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <EyeOff size={15} /> About phone masking
        </h3>
        <p className="text-sm text-slate-600">
          With masking on, that person sees only the last four digits — <code className="bg-white px-1 rounded">XXXXXXXX4120</code> — everywhere
          in the app: inbox, contacts, leads and tickets. Phone numbers written inside message text are redacted
          too. The masking happens on the server, so the full number is never sent to their browser and can't be
          recovered from developer tools.
        </p>
      </div>

      {editing && (
        <MemberModal
          member={editing === "new" ? null : editing}
          permissions={permissions}
          presets={presets}
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

function MemberModal({
  member,
  permissions,
  presets,
  numbers,
  onClose,
  onSaved
}: {
  member: TeamMember | null;
  permissions: PermissionDef[];
  presets: Record<string, string[]>;
  numbers: WabaNumber[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: member?.name || "",
    email: member?.email || "",
    password: "",
    role: member?.role || "agent",
    permissions: member?.permissions || presets.agent || [],
    allowedNumbers: member?.allowedNumbers?.map((n) => n._id) || [],
    maskPhoneNumbers: member?.maskPhoneNumbers || false
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const groups = Array.from(new Set(permissions.map((p) => p.group)));

  function togglePerm(key: string) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((p) => p !== key)
        : [...f.permissions, key]
    }));
  }

  function applyPreset(role: string) {
    setForm((f) => ({ ...f, role: role as any, permissions: presets[role] || [] }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (member) {
        const body: Record<string, unknown> = {
          name: form.name,
          role: form.role,
          permissions: form.permissions,
          allowedNumbers: form.allowedNumbers,
          maskPhoneNumbers: form.maskPhoneNumbers
        };
        if (form.password) body.password = form.password;
        await api(`/team/${member._id}`, { method: "PATCH", body });
      } else {
        await api("/team", { method: "POST", body: form });
      }
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
        <h2 className="text-lg font-bold">{member ? `Edit ${member.name}` : "Add team member"}</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              disabled={!!member}
              required
            />
          </div>
          <div>
            <label className="label">{member ? "New password (leave blank to keep)" : "Password"}</label>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!member}
              minLength={6}
            />
          </div>
          <div>
            <label className="label">Role preset</label>
            <select className="input" value={form.role} onChange={(e) => applyPreset(e.target.value)}>
              <option value="agent">Agent — inbox and leads</option>
              <option value="manager">Manager — everything except team &amp; settings</option>
              <option value="admin">Admin — full access</option>
            </select>
          </div>
        </div>

        {/* Number scoping */}
        <div>
          <label className="label">WhatsApp numbers they can see</label>
          <div className="flex flex-wrap gap-2">
            {numbers.map((n) => {
              const on = form.allowedNumbers.includes(n._id);
              return (
                <button
                  type="button"
                  key={n._id}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      allowedNumbers: on
                        ? f.allowedNumbers.filter((x) => x !== n._id)
                        : [...f.allowedNumbers, n._id]
                    }))
                  }
                  className={`text-xs rounded-full px-3 py-1.5 border transition-colors ${
                    on ? "bg-brand-100 border-brand-300 text-brand-700" : "border-slate-200 text-slate-600"
                  }`}
                >
                  {on && <Check size={11} className="inline mr-1" />}
                  {n.label} · {n.displayPhoneNumber}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Select none to give access to all numbers, including any added later.
          </p>
        </div>

        {/* Masking */}
        <label className="flex items-start gap-3 cursor-pointer bg-amber-50 border border-amber-200 rounded-lg p-3">
          <input
            type="checkbox"
            className="w-4 h-4 accent-amber-600 mt-0.5"
            checked={form.maskPhoneNumbers}
            onChange={(e) => setForm({ ...form, maskPhoneNumbers: e.target.checked })}
          />
          <span>
            <span className="text-sm font-medium">Mask customer phone numbers</span>
            <span className="block text-xs text-slate-600 mt-0.5">
              They'll see only the last 4 digits everywhere, and phone numbers inside message text are redacted.
              Enforced server-side.
            </span>
          </span>
        </label>

        {/* Permission matrix */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Permissions</label>
            {form.role === "admin" && (
              <span className="text-xs text-indigo-600">Admins always have every permission</span>
            )}
          </div>
          <div className={`space-y-4 ${form.role === "admin" ? "opacity-40 pointer-events-none" : ""}`}>
            {groups.map((g) => (
              <div key={g}>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{g}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {permissions
                    .filter((p) => p.group === g)
                    .map((p) => (
                      <label key={p.key} className="flex items-start gap-2 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-emerald-600 mt-0.5 shrink-0"
                          checked={form.permissions.includes(p.key)}
                          onChange={() => togglePerm(p.key)}
                        />
                        <span>
                          {p.label}
                          <span className="block text-[11px] text-slate-400">{p.description}</span>
                        </span>
                      </label>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 sticky bottom-0 bg-white pt-3">
          <button className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : member ? "Save changes" : "Create member"}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
