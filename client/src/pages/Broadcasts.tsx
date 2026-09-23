import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Megaphone,
  Pause,
  Play,
  Copy,
  Trash2,
  Clock,
  Send,
  Eye,
  MessageCircle,
  Pencil,
  Square,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getSocket } from "../lib/socket";
import type { Broadcast } from "../types";

export const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-600" },
  scheduled: { label: "Scheduled", cls: "bg-sky-100 text-sky-700" },
  preparing: { label: "Preparing", cls: "bg-amber-100 text-amber-700" },
  running: { label: "Sending", cls: "bg-emerald-100 text-emerald-700" },
  paused: { label: "Paused", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Completed", cls: "bg-brand-100 text-brand-700" },
  failed: { label: "Failed", cls: "bg-red-100 text-red-700" },
  cancelled: { label: "Stopped", cls: "bg-slate-100 text-slate-500" },
};

const TABS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "draft", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Completed" },
];

interface Summary {
  campaigns: number;
  sent: number;
  readRate: number;
  replyRate: number;
  running: number;
  scheduled: number;
}

export function pct(part: number, whole: number): number {
  return whole ? Math.round((part / whole) * 100) : 0;
}

export default function Broadcasts() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canSend = can("broadcasts.send");
  const [items, setItems] = useState<Broadcast[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState("");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    const r = await api<{ items: Broadcast[]; summary: Summary }>("/broadcasts");
    setItems(r.items);
    setSummary(r.summary);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const socket = getSocket();
    const onUpdate = (p: { _id: string; status: string; stats: Broadcast["stats"] }) =>
      setItems((prev) => prev.map((b) => (b._id === p._id ? { ...b, status: p.status as any, stats: p.stats } : b)));
    socket.on("broadcast:update", onUpdate);
    const poll = setInterval(load, 15000);
    return () => {
      socket.off("broadcast:update", onUpdate);
      clearInterval(poll);
    };
  }, [load]);

  function flash(m: string) {
    setToast(m);
    setTimeout(() => setToast(""), 3000);
  }

  async function act(b: Broadcast, action: "pause" | "resume" | "cancel" | "duplicate" | "delete") {
    const confirmText: Record<string, string> = {
      cancel:
        b.status === "scheduled"
          ? `Unschedule "${b.name}"? It goes back to drafts.`
          : `Stop "${b.name}"? Messages already sent can't be recalled; the rest won't be sent.`,
      delete: `Delete "${b.name}" and its report? This can't be undone.`,
    };
    if (confirmText[action] && !confirm(confirmText[action])) return;
    try {
      if (action === "delete") await api(`/broadcasts/${b._id}`, { method: "DELETE" });
      else if (action === "duplicate") {
        const copy = await api<Broadcast>(`/broadcasts/${b._id}/duplicate`, { method: "POST" });
        navigate(`/broadcasts/${copy._id}/edit`);
        return;
      } else await api(`/broadcasts/${b._id}/${action}`, { method: "POST" });
      load();
    } catch (e: any) {
      flash(e.message);
    }
  }

  const filtered = items.filter((b) => {
    if (!tab) return true;
    if (tab === "active") return ["running", "preparing", "paused"].includes(b.status);
    if (tab === "completed") return ["completed", "cancelled", "failed"].includes(b.status);
    return b.status === tab;
  });

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Broadcasts</h1>
          <p className="text-sm text-slate-500">Send approved templates to the right people, and see exactly what happened.</p>
        </div>
        {canSend && (
          <button className="btn-primary" onClick={() => navigate("/broadcasts/new")}>
            <Plus size={15} /> New campaign
          </button>
        )}
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Kpi label="Campaigns (30 days)" value={summary.campaigns.toLocaleString()} />
          <Kpi label="Messages sent" value={summary.sent.toLocaleString()} />
          <Kpi label="Read rate" value={`${summary.readRate}%`} hint="of sent" />
          <Kpi label="Reply rate" value={`${summary.replyRate}%`} hint="of sent" />
        </div>
      )}

      <div className="flex gap-1.5 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-xs rounded-full px-3 py-1.5 font-medium ${
              tab === t.key ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t.label}
            {t.key === "active" && summary?.running ? ` (${summary.running})` : ""}
            {t.key === "scheduled" && summary?.scheduled ? ` (${summary.scheduled})` : ""}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((b) => {
          const s = b.stats || ({} as Broadcast["stats"]);
          const st = STATUS_STYLE[b.status] || STATUS_STYLE.draft;
          const editable = ["draft", "scheduled"].includes(b.status);
          const progress = s.total ? pct(s.total - (s.pending || 0), s.total) : 0;
          return (
            <div key={b._id} className="card p-5 hover:border-slate-300 transition-colors">
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2">
                    <Link to={editable ? `/broadcasts/${b._id}/edit` : `/broadcasts/${b._id}`} className="font-semibold hover:text-brand-700">
                      {b.name}
                    </Link>
                    <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium ${st.cls}`}>
                      {b.status === "running" && <span className="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1 animate-pulse" />}
                      {st.label}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {b.templateName}
                    {typeof b.number === "object" && b.number ? ` · from ${b.number.label}` : ""}
                    {b.status === "scheduled" && b.scheduledAt && (
                      <span className="text-sky-700">
                        {" "}
                        · <Clock size={11} className="inline" /> {new Date(b.scheduledAt).toLocaleString()}
                      </span>
                    )}
                    {b.startedAt && b.status !== "scheduled" && ` · ${new Date(b.startedAt).toLocaleString()}`}
                  </div>
                  {b.lastError && <div className="text-xs text-red-600 mt-1">{b.lastError}</div>}
                </div>

                {s.total > 0 && (
                  <div className="flex gap-5 text-center">
                    <Metric icon={<Send size={12} />} label="Sent" value={s.sent} of={s.total} />
                    <Metric icon={<Eye size={12} />} label="Read" value={s.read} of={s.sent} />
                    <Metric icon={<MessageCircle size={12} />} label="Replied" value={s.replied} of={s.sent} />
                    {s.failed > 0 && <Metric label="Failed" value={s.failed} of={s.total} danger />}
                  </div>
                )}

                <div className="flex items-center gap-1.5">
                  {canSend && editable && (
                    <IconBtn title="Edit" onClick={() => navigate(`/broadcasts/${b._id}/edit`)}>
                      <Pencil size={14} />
                    </IconBtn>
                  )}
                  {canSend && b.status === "running" && (
                    <IconBtn title="Pause" onClick={() => act(b, "pause")}>
                      <Pause size={14} />
                    </IconBtn>
                  )}
                  {canSend && b.status === "paused" && (
                    <IconBtn title="Resume" onClick={() => act(b, "resume")}>
                      <Play size={14} />
                    </IconBtn>
                  )}
                  {canSend && ["running", "paused", "scheduled"].includes(b.status) && (
                    <IconBtn title={b.status === "scheduled" ? "Unschedule" : "Stop"} onClick={() => act(b, "cancel")}>
                      <Square size={14} />
                    </IconBtn>
                  )}
                  {canSend && (
                    <IconBtn title="Duplicate" onClick={() => act(b, "duplicate")}>
                      <Copy size={14} />
                    </IconBtn>
                  )}
                  {canSend && !["running", "preparing"].includes(b.status) && (
                    <IconBtn title="Delete" onClick={() => act(b, "delete")} danger>
                      <Trash2 size={14} />
                    </IconBtn>
                  )}
                  {!editable && (
                    <Link to={`/broadcasts/${b._id}`} className="btn-secondary text-xs ml-1">
                      Report
                    </Link>
                  )}
                </div>
              </div>

              {["running", "paused", "preparing"].includes(b.status) && s.total > 0 && (
                <div className="mt-3">
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {(s.total - s.pending).toLocaleString()} of {s.total.toLocaleString()} processed
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {!loading && filtered.length === 0 && (
          <div className="card p-12 text-center">
            <Megaphone size={32} className="mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500 mb-4">{tab ? "Nothing here." : "No campaigns yet."}</p>
            {canSend && !tab && (
              <button className="btn-primary mx-auto" onClick={() => navigate("/broadcasts/new")}>
                <Plus size={15} /> Create your first campaign
              </button>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm rounded-lg px-4 py-2.5 shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-bold mt-0.5">
        {value}
        {hint && <span className="text-xs font-normal text-slate-400 ml-1">{hint}</span>}
      </div>
    </div>
  );
}

function Metric({ icon, label, value, of, danger }: { icon?: React.ReactNode; label: string; value: number; of: number; danger?: boolean }) {
  return (
    <div>
      <div className={`text-base font-bold ${danger ? "text-red-600" : ""}`}>{value.toLocaleString()}</div>
      <div className="text-[11px] text-slate-500 flex items-center gap-1 justify-center">
        {icon} {label} {!danger && of > 0 && <span className="text-slate-400">{pct(value, of)}%</span>}
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button title={title} onClick={onClick} className={`btn-secondary text-xs px-2.5 ${danger ? "hover:text-red-600" : ""}`}>
      {children}
    </button>
  );
}
