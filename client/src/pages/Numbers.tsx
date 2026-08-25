import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  RefreshCw,
  Settings2,
  ChevronUp,
  ChevronDown,
  Ban,
  CheckCircle2,
  Trash2,
  Bot,
  Search,
  Radio,
  AlertTriangle,
  Link2
} from "lucide-react";
import { api } from "../lib/api";
import type { WabaNumber, DiscoveredNumber, SubscriptionStatus, QualitySnapshot } from "../types";

const qualityDot: Record<string, string> = {
  GREEN: "bg-emerald-500",
  YELLOW: "bg-amber-500",
  RED: "bg-red-500",
  UNKNOWN: "bg-slate-300"
};
const qualityLabel: Record<string, string> = {
  GREEN: "High",
  YELLOW: "Medium",
  RED: "Low",
  UNKNOWN: "Unknown"
};

function fmtDate(iso?: string) {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleString([], { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function Numbers() {
  const [numbers, setNumbers] = useState<WabaNumber[]>([]);
  const [subs, setSubs] = useState<Record<string, SubscriptionStatus>>({});
  const [subBusy, setSubBusy] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "disconnected">("all");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [manage, setManage] = useState<WabaNumber | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setNumbers(await api<WabaNumber[]>("/numbers"));
  }, []);

  const loadSubs = useCallback(async () => {
    try {
      setSubs(await api<Record<string, SubscriptionStatus>>("/numbers/subscription-status"));
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    load();
    loadSubs();
  }, [load, loadSubs]);

  async function subscribe(n: WabaNumber) {
    setSubBusy(n._id);
    setMsg("");
    try {
      await api(`/numbers/${n._id}/subscribe`, { method: "POST" });
      await loadSubs();
      setMsg(`Subscribed to ${n.displayPhoneNumber || n.label}. Webhooks should start arriving immediately.`);
    } catch (e: any) {
      setMsg(`Subscribe failed: ${e.message}`);
    } finally {
      setSubBusy("");
    }
  }

  async function syncAll() {
    setSyncing(true);
    try {
      await api("/numbers/sync-all", { method: "POST" });
      await load();
      await loadSubs();
      setMsg("Health refreshed from Meta.");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function toggleEnabled(n: WabaNumber) {
    await api(`/numbers/${n._id}`, { method: "PATCH", body: { enabled: !n.enabled } });
    load();
  }

  async function remove(n: WabaNumber) {
    if (!confirm(`Remove ${n.displayPhoneNumber || n.label}? Chat history is kept.`)) return;
    await api(`/numbers/${n._id}`, { method: "DELETE" });
    load();
  }

  // group by business account
  const visible = numbers.filter((n) => {
    if (filter === "active" && !n.enabled) return false;
    if (filter === "disconnected" && n.enabled) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      n.label.toLowerCase().includes(s) ||
      n.businessAccountId.includes(search) ||
      n.displayPhoneNumber.includes(search)
    );
  });
  const groups = visible.reduce<Record<string, WabaNumber[]>>((acc, n) => {
    (acc[n.businessAccountId] ||= []).push(n);
    return acc;
  }, {});

  const activeCount = numbers.filter((n) => n.enabled).length;

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">WhatsApp Numbers</h1>
          <p className="text-sm text-slate-500">Health, quality rating and messaging limits, live from Meta</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={syncAll} disabled={syncing}>
            <RefreshCw size={15} className={syncing ? "animate-spin" : ""} /> Refresh health
          </button>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={15} /> Add number
          </button>
        </div>
      </div>

      {msg && <p className="mb-4 text-sm text-slate-600 bg-slate-100 rounded-lg px-4 py-2">{msg}</p>}

      {/* Filter bar */}
      <div className="card p-3 mb-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          {(
            [
              ["all", `All (${numbers.length})`],
              ["active", `Active (${activeCount})`],
              ["disconnected", `Disabled (${numbers.length - activeCount})`]
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                filter === k ? "bg-brand-100 text-brand-700" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-52">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search by name, number or Business Account ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {Object.keys(groups).length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-slate-500 mb-1">No numbers connected yet.</p>
          <p className="text-sm text-slate-400 mb-4">
            Add your WhatsApp Business Account ID and phone number ID from the Meta dashboard.
          </p>
          <button className="btn-primary mx-auto" onClick={() => setShowAdd(true)}>
            <Plus size={15} /> Add your first number
          </button>
        </div>
      )}

      <div className="space-y-5">
        {Object.entries(groups).map(([wabaId, list]) => {
          const isCollapsed = collapsed[wabaId];
          return (
            <div key={wabaId} className="card overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 bg-slate-50/60 border-b border-slate-200">
                <div>
                  <div className="font-semibold">{list[0].label.split(" - ")[0] || "Business Account"}</div>
                  <div className="text-xs text-slate-500">Business Account ID: {wabaId}</div>
                </div>
                <button
                  className="btn-secondary text-xs"
                  onClick={() => setCollapsed({ ...collapsed, [wabaId]: !isCollapsed })}
                >
                  {isCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                </button>
              </div>

              {!isCollapsed && (
                <div className="p-4">
                  <div className="flex items-center gap-2 px-2 pb-3">
                    <span className="text-sm font-medium">Phone Numbers</span>
                    <span className="bg-slate-100 text-slate-600 rounded-md text-xs px-2 py-0.5">{list.length}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-left text-[11px] text-slate-500 uppercase tracking-wide border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 font-medium">Phone Number</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Quality</th>
                        <th className="px-3 py-2 font-medium">Messaging Limit</th>
                        <th className="px-3 py-2 font-medium">Webhook</th>
                        <th className="px-3 py-2 font-medium">Chats</th>
                        <th className="px-3 py-2 font-medium">Last Sync</th>
                        <th className="px-3 py-2 font-medium">Name Status</th>
                        <th className="px-3 py-2 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((n) => (
                        <tr key={n._id} className="border-b border-slate-100 last:border-0">
                          <td className="px-3 py-4">
                            <div className="flex items-center gap-3">
                              <span className="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                                WA
                              </span>
                              <div>
                                <div className="font-medium">{n.displayPhoneNumber || "—"}</div>
                                <div className="text-xs text-slate-500">{n.verifiedName || n.label}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-4">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${n.enabled ? "bg-emerald-500" : "bg-slate-300"}`} />
                              <span className={n.enabled ? "text-slate-800" : "text-slate-400"}>
                                {n.enabled ? "Active" : "Disabled"}
                              </span>
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">{n.status}</div>
                          </td>
                          <td className="px-3 py-4">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${qualityDot[n.qualityRating] || qualityDot.UNKNOWN}`} />
                              {qualityLabel[n.qualityRating] || "Unknown"}
                            </div>
                          </td>
                          <td className="px-3 py-4">
                            <div>{n.messagingLimit}</div>
                            <div className="text-xs text-slate-400">{n.phoneNumberId}</div>
                          </td>
                          <td className="px-3 py-4">
                            {subs[n._id]?.subscribed ? (
                              <>
                                <span className="inline-flex items-center gap-1.5 text-emerald-600 font-medium">
                                  <Radio size={13} /> Subscribed
                                </span>
                                <div className="text-xs text-slate-400 mt-0.5">
                                  {n.lastWebhookAt ? `Last event ${fmtDate(n.lastWebhookAt)}` : "No events yet"}
                                </div>
                              </>
                            ) : (
                              <>
                                <span className="inline-flex items-center gap-1.5 text-red-600 font-medium">
                                  <AlertTriangle size={13} /> Not subscribed
                                </span>
                                <button
                                  className="btn-primary text-[11px] py-1 px-2 mt-1"
                                  disabled={subBusy === n._id}
                                  onClick={() => subscribe(n)}
                                >
                                  {subBusy === n._id ? "Subscribing…" : "Subscribe now"}
                                </button>
                              </>
                            )}
                            {!!subs[n._id]?.otherApps?.length && (
                              <div
                                className="text-xs text-amber-600 mt-1 flex items-center gap-1"
                                title={subs[n._id].otherApps.map((a) => a.name).join(", ")}
                              >
                                <Link2 size={11} />
                                {subs[n._id].otherApps.length} other app
                                {subs[n._id].otherApps.length > 1 ? "s" : ""}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-4">
                            {n.conversations ?? 0}
                            {!!n.unread && <span className="ml-1 text-xs text-brand-600">({n.unread} unread)</span>}
                          </td>
                          <td className="px-3 py-4 text-slate-600">
                            {fmtDate(n.lastSyncAt)}
                            {n.lastSyncError && (
                              <div className="text-xs text-red-500 max-w-40 truncate" title={n.lastSyncError}>
                                {n.lastSyncError}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-4">
                            <span
                              className={`text-xs rounded-full px-2 py-0.5 ${
                                n.nameStatus === "APPROVED"
                                  ? "bg-brand-100 text-brand-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {n.nameStatus}
                            </span>
                            {n.aiEnabled && (
                              <span className="ml-1 inline-flex items-center gap-1 text-xs text-brand-600">
                                <Bot size={12} /> AI
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <button className="btn-secondary text-xs" onClick={() => setManage(n)}>
                                <Settings2 size={13} /> Manage
                              </button>
                              <button
                                className="btn-secondary text-xs"
                                title={n.enabled ? "Disable" : "Enable"}
                                onClick={() => toggleEnabled(n)}
                              >
                                {n.enabled ? <Ban size={13} className="text-red-500" /> : <CheckCircle2 size={13} className="text-emerald-600" />}
                              </button>
                              <button className="btn-secondary text-xs" onClick={() => remove(n)}>
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAdd && <AddNumberModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {manage && (
        <ManageNumberModal
          number={manage}
          sub={subs[manage._id]}
          onSubscribe={() => subscribe(manage)}
          onClose={() => setManage(null)}
          onSaved={() => {
            setManage(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-6 z-50" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function AddNumberModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [wabaId, setWabaId] = useState("");
  const [token, setToken] = useState("");
  const [found, setFound] = useState<DiscoveredNumber[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [manualId, setManualId] = useState("");

  async function discover() {
    setBusy(true);
    setError("");
    try {
      setFound(await api<DiscoveredNumber[]>("/numbers/discover", {
        method: "POST",
        body: { businessAccountId: wabaId, token: token || undefined }
      }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function add(phoneNumberId: string, name: string) {
    setBusy(true);
    setError("");
    try {
      await api("/numbers", {
        method: "POST",
        body: {
          label: label || name || "WhatsApp number",
          businessAccountId: wabaId,
          phoneNumberId,
          tokenOverride: token || undefined
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
    <Modal title="Add WhatsApp number" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label">WhatsApp Business Account ID (WABA ID)</label>
          <input className="input" value={wabaId} onChange={(e) => setWabaId(e.target.value)} placeholder="1309418444346521" />
        </div>
        <div>
          <label className="label">Access token (optional — leave blank to use the app-wide token)</label>
          <input className="input" value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAG…" />
          <p className="text-xs text-slate-400 mt-1">
            Needed only if this number sits under a different Meta app or system user.
          </p>
        </div>
        <div>
          <label className="label">Friendly label</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Svastha - Marketing" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary" onClick={discover} disabled={!wabaId || busy}>
          {busy ? "Checking…" : "Find numbers on this account"}
        </button>

        {found && (
          <div className="border-t border-slate-200 pt-4 space-y-2">
            {found.length === 0 && <p className="text-sm text-slate-500">No phone numbers found on that account.</p>}
            {found.map((f) => (
              <div key={f.phoneNumberId} className="flex items-center justify-between border border-slate-200 rounded-lg px-4 py-3">
                <div>
                  <div className="font-medium text-sm">{f.displayPhoneNumber}</div>
                  <div className="text-xs text-slate-500">
                    {f.verifiedName} · quality {f.qualityRating || "—"} · {f.messagingLimit || "—"}
                  </div>
                </div>
                {f.alreadyAdded ? (
                  <span className="text-xs text-slate-400">Already added</span>
                ) : (
                  <button className="btn-primary text-xs" disabled={busy} onClick={() => add(f.phoneNumberId, f.verifiedName)}>
                    Add
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-slate-200 pt-4">
          <label className="label">…or add by Phone Number ID directly</label>
          <div className="flex gap-2">
            <input className="input" value={manualId} onChange={(e) => setManualId(e.target.value)} placeholder="1045391581985063" />
            <button className="btn-secondary shrink-0" disabled={!manualId || !wabaId || busy} onClick={() => add(manualId, "")}>
              Add
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ManageNumberModal({
  number,
  sub,
  onSubscribe,
  onClose,
  onSaved
}: {
  number: WabaNumber;
  sub?: SubscriptionStatus;
  onSubscribe: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    label: number.label,
    purpose: number.purpose,
    aiEnabled: number.aiEnabled,
    systemPromptOverride: number.systemPromptOverride || ""
  });
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<QualitySnapshot[]>([]);

  useEffect(() => {
    api<QualitySnapshot[]>(`/numbers/${number._id}/quality-history`)
      .then((h) => setHistory(h.filter((x) => x.changed).slice(-8).reverse()))
      .catch(() => {});
  }, [number._id]);

  async function save() {
    setBusy(true);
    try {
      await api(`/numbers/${number._id}`, { method: "PATCH", body: form });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Manage ${number.displayPhoneNumber || number.label}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xs text-slate-500">Quality rating</div>
            <div className="font-semibold">{qualityLabel[number.qualityRating] || "Unknown"}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xs text-slate-500">Messaging limit</div>
            <div className="font-semibold">{number.messagingLimit}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xs text-slate-500">Sent today</div>
            <div className="font-semibold">{number.sentToday}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xs text-slate-500">Throughput</div>
            <div className="font-semibold">{number.throughputLevel || "—"}</div>
          </div>
        </div>

        {/* Webhook delivery diagnostics */}
        <div className="border border-slate-200 rounded-lg p-4">
          <h3 className="font-semibold text-sm mb-2">Webhook delivery</h3>
          {sub?.error ? (
            <p className="text-xs text-red-600">Couldn't read subscriptions: {sub.error}</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className={`text-sm font-medium ${sub?.subscribed ? "text-emerald-600" : "text-red-600"}`}>
                  {sub?.subscribed
                    ? "This app is subscribed to the Business Account"
                    : "This app is NOT subscribed — no webhooks will arrive"}
                </span>
                {!sub?.subscribed && (
                  <button className="btn-primary text-xs shrink-0" onClick={onSubscribe}>
                    Subscribe
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500 mb-2">
                Last event received: {number.lastWebhookAt ? fmtDate(number.lastWebhookAt) : "never"}
              </p>
              {!!sub?.apps?.length && (
                <div>
                  <div className="text-xs text-slate-500 mb-1">Apps receiving this account's webhooks:</div>
                  <ul className="text-xs space-y-1">
                    {sub.apps.map((a) => (
                      <li key={a.id} className="flex items-center gap-2">
                        <span className={a.id === sub.appId ? "font-semibold text-emerald-700" : "text-slate-600"}>
                          {a.name}
                        </span>
                        <span className="text-slate-400">{a.id}</span>
                        {a.id === sub.appId && <span className="text-emerald-600">← this app</span>}
                      </li>
                    ))}
                  </ul>
                  {!!sub.otherApps.length && (
                    <p className="text-xs text-amber-600 mt-2">
                      Other apps are also subscribed and will receive the same messages. Remove them in Business
                      Settings → WhatsApp Accounts → Apps to avoid duplicate replies.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {history.length > 0 && (
          <div className="border border-slate-200 rounded-lg p-4">
            <h3 className="font-semibold text-sm mb-2">Quality history</h3>
            <ul className="text-xs space-y-1.5">
              {history.map((h) => (
                <li key={h._id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${qualityDot[h.qualityRating] || qualityDot.UNKNOWN}`} />
                    {qualityLabel[h.qualityRating] || h.qualityRating} · {h.messagingLimit}
                  </span>
                  <span className="text-slate-400">{fmtDate(h.createdAt)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500 mt-2">
              A drop here almost always traces back to a broadcast in the preceding 24-48 hours.
            </p>
          </div>
        )}

        {number.lastSyncError && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-3">{number.lastSyncError}</p>
        )}

        <div>
          <label className="label">Label</label>
          <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </div>
        <div>
          <label className="label">Purpose</label>
          <select className="input" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value as any })}>
            <option value="mixed">Mixed</option>
            <option value="marketing">Marketing</option>
            <option value="support">Support</option>
            <option value="otp">OTP / transactional (AI never markets here)</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 accent-emerald-600"
            checked={form.aiEnabled}
            onChange={(e) => setForm({ ...form, aiEnabled: e.target.checked })}
          />
          AI auto-reply enabled on this number
        </label>
        <div>
          <label className="label">System prompt override (optional — blank uses the global prompt)</label>
          <textarea
            className="input font-mono text-xs"
            rows={5}
            value={form.systemPromptOverride}
            onChange={(e) => setForm({ ...form, systemPromptOverride: e.target.value })}
          />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
