import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Pause,
  Play,
  Square,
  Copy,
  Download,
  Send,
  Search,
  AlertTriangle,
  Tag,
  MessageCircle,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getSocket } from "../lib/socket";
import { downloadFromApi, formatPhone } from "../lib/spreadsheet";
import { parseTemplate } from "../lib/templates";
import { STATUS_STYLE, pct } from "./Broadcasts";
import type { Broadcast, BroadcastRecipient, Template } from "../types";

interface Detail {
  broadcast: Broadcast;
  template?: Template;
  failures: { status: string; reason: string; count: number }[];
  readTimeline: { hour: string; count: number }[];
}

const RECIPIENT_TABS = [
  { key: "", label: "All" },
  { key: "pending", label: "Queued" },
  { key: "notRead", label: "Not read" },
  { key: "readNoReply", label: "Read, no reply" },
  { key: "replied", label: "Replied" },
  { key: "failed", label: "Failed" },
  { key: "skipped", label: "Skipped" },
];

const REC_STATUS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-500",
  sent: "bg-sky-100 text-sky-700",
  delivered: "bg-sky-100 text-sky-700",
  read: "bg-emerald-100 text-emerald-700",
  replied: "bg-violet-100 text-violet-700",
  failed: "bg-red-100 text-red-700",
  skipped: "bg-amber-100 text-amber-700",
};

export default function BroadcastReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canSend = can("broadcasts.send");
  const [d, setD] = useState<Detail | null>(null);
  const [recipients, setRecipients] = useState<{ items: BroadcastRecipient[]; total: number; page: number; pages: number } | null>(null);
  const [replies, setReplies] = useState<{ name?: string; waId: string; text: string; at: string; conversationId?: string }[]>([]);
  const [rTab, setRTab] = useState("");
  const [rSearch, setRSearch] = useState("");
  const [rPage, setRPage] = useState(1);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    try {
      setD(await api<Detail>(`/broadcasts/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  const loadRecipients = useCallback(async () => {
    const p = new URLSearchParams({ page: String(rPage) });
    if (rTab) p.set("status", rTab);
    if (rSearch) p.set("search", rSearch);
    setRecipients(await api(`/broadcasts/${id}/recipients?${p}`));
  }, [id, rTab, rSearch, rPage]);

  useEffect(() => {
    load();
    api<typeof replies>(`/broadcasts/${id}/replies`).then(setReplies).catch(() => {});
    const socket = getSocket();
    const onUpdate = (p: { _id: string; status: string; stats: Broadcast["stats"] }) => {
      if (p._id === id) setD((prev) => (prev ? { ...prev, broadcast: { ...prev.broadcast, status: p.status as any, stats: p.stats } } : prev));
    };
    socket.on("broadcast:update", onUpdate);
    const poll = setInterval(load, 20000);
    return () => {
      socket.off("broadcast:update", onUpdate);
      clearInterval(poll);
    };
  }, [id, load]);

  useEffect(() => {
    const t = setTimeout(() => loadRecipients().catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [loadRecipients]);
  useEffect(() => setRPage(1), [rTab, rSearch]);

  function flash(m: string) {
    setToast(m);
    setTimeout(() => setToast(""), 3500);
  }

  if (!d) return <div className="p-8 text-sm text-slate-400">{error || "Loading…"}</div>;
  const b = d.broadcast;
  const s = b.stats;
  const st = STATUS_STYLE[b.status] || STATUS_STYLE.draft;
  const parsed = parseTemplate(d.template);

  async function control(action: "pause" | "resume" | "cancel" | "duplicate") {
    if (action === "cancel" && !confirm("Stop this campaign? Messages already sent can't be recalled; the rest won't be sent.")) return;
    try {
      if (action === "duplicate") {
        const copy = await api<Broadcast>(`/broadcasts/${id}/duplicate`, { method: "POST" });
        navigate(`/broadcasts/${copy._id}/edit`);
        return;
      }
      await api(`/broadcasts/${id}/${action}`, { method: "POST" });
      load();
      loadRecipients();
    } catch (e: any) {
      flash(e.message);
    }
  }

  async function retarget(statuses: string[], label: string) {
    const draft = await api<Broadcast>(`/broadcasts/${id}/retarget`, { method: "POST", body: { statuses, label } });
    navigate(`/broadcasts/${draft._id}/edit`);
  }

  async function tagBucket(statuses: string[], suggested: string) {
    const tag = prompt("Tag these contacts as:", suggested);
    if (!tag) return;
    try {
      const r = await api<{ tagged: number }>(`/broadcasts/${id}/tag-recipients`, { method: "POST", body: { tag, statuses } });
      flash(`Tagged ${r.tagged.toLocaleString()} contacts "${tag}".`);
    } catch (e: any) {
      flash(e.message);
    }
  }

  const notRead = Math.max(0, s.sent - s.read);
  const readNoReply = Math.max(0, s.read - s.replied);
  const maxHour = Math.max(1, ...d.readTimeline.map((t) => t.count));

  return (
    <div className="h-full overflow-y-auto p-8">
      <button className="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-4" onClick={() => navigate("/broadcasts")}>
        <ArrowLeft size={15} /> All campaigns
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{b.name}</h1>
            <span className={`text-xs rounded-full px-2.5 py-0.5 font-medium ${st.cls}`}>{st.label}</span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {b.templateName}
            {typeof b.number === "object" && b.number ? ` · from ${b.number.label}` : ""}
            {b.startedAt && ` · started ${new Date(b.startedAt).toLocaleString()}`}
            {b.completedAt && ` · finished ${new Date(b.completedAt).toLocaleString()}`}
            {b.createdBy?.name && ` · by ${b.createdBy.name}`}
          </p>
          {b.description && <p className="text-sm text-slate-600 mt-1">{b.description}</p>}
        </div>
        {canSend && (
          <div className="flex gap-2">
            {b.status === "running" && (
              <button className="btn-secondary" onClick={() => control("pause")}>
                <Pause size={15} /> Pause
              </button>
            )}
            {b.status === "paused" && (
              <button className="btn-primary" onClick={() => control("resume")}>
                <Play size={15} /> Resume
              </button>
            )}
            {["running", "paused"].includes(b.status) && (
              <button className="btn-secondary" onClick={() => control("cancel")}>
                <Square size={15} /> Stop
              </button>
            )}
            <button className="btn-secondary" onClick={() => control("duplicate")}>
              <Copy size={15} /> Duplicate
            </button>
          </div>
        )}
      </div>

      {b.lastError && (
        <div className="mb-5 flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 text-sm rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {b.lastError}
        </div>
      )}

      {/* Progress while sending */}
      {["running", "paused", "preparing"].includes(b.status) && (
        <div className="card p-4 mb-5">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium">{b.status === "preparing" ? "Building the audience…" : b.status === "paused" ? "Paused" : "Sending…"}</span>
            <span className="text-slate-500">
              {(s.total - s.pending).toLocaleString()} / {s.total.toLocaleString()}
            </span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct(s.total - s.pending, s.total)}%` }} />
          </div>
        </div>
      )}

      {/* Funnel */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <FunnelCard label="Audience" value={s.total} />
        <FunnelCard label="Sent" value={s.sent} base={s.total} />
        <FunnelCard label="Delivered" value={s.delivered} base={s.sent} />
        <FunnelCard label="Read" value={s.read} base={s.sent} tone="emerald" />
        <FunnelCard label="Replied" value={s.replied} base={s.sent} tone="violet" />
        <FunnelCard label="Failed / skipped" value={s.failed + s.skipped} base={s.total} tone="red" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-6">
        {/* Next steps */}
        <div className="card p-5 xl:col-span-2">
          <h2 className="font-semibold mb-3">What next?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <NextStep
              title={`${notRead.toLocaleString()} didn't open it`}
              body="Send a follow-up with a different template or time of day."
              disabled={!canSend || notRead === 0}
              actionLabel="Follow up"
              icon={<RotateCcw size={14} />}
              onClick={() => retarget(["sent", "delivered"], "didn't open")}
            />
            <NextStep
              title={`${readNoReply.toLocaleString()} read, didn't reply`}
              body="Interested enough to open it. A nudge with a clear question often works."
              disabled={!canSend || readNoReply === 0}
              actionLabel="Nudge them"
              icon={<Send size={14} />}
              onClick={() => retarget(["read"], "read no reply")}
            />
            <NextStep
              title={`${s.replied.toLocaleString()} replied`}
              body="Your warmest leads. Tag them so the team can prioritise them."
              disabled={!can("contacts.edit") || s.replied === 0}
              actionLabel="Tag them"
              icon={<Tag size={14} />}
              onClick={() => tagBucket(["replied"], `replied-${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`)}
            />
          </div>
        </div>

        {/* Message */}
        <div className="card p-5">
          <h2 className="font-semibold mb-2">Message</h2>
          <div className="bg-[#efeae2] rounded-lg p-3">
            <div className="bg-white rounded-lg p-3 text-sm whitespace-pre-wrap">
              {parsed.headerText && <div className="font-bold mb-1">{parsed.headerText}</div>}
              {parsed.body || b.templateName}
              {parsed.footer && <div className="text-xs text-slate-400 mt-1">{parsed.footer}</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-6">
        {/* Failures */}
        <div className="card p-5">
          <h2 className="font-semibold mb-3">Why messages didn't go out</h2>
          {d.failures.length ? (
            <div className="space-y-2">
              {d.failures.map((f, i) => (
                <div key={i} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-slate-700">
                    <span className={`text-[10px] rounded px-1.5 py-0.5 mr-1.5 ${REC_STATUS[f.status]}`}>{f.status}</span>
                    {f.reason}
                  </span>
                  <span className="font-semibold shrink-0">{f.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Nothing failed. 🎉</p>
          )}
        </div>

        {/* When people read */}
        <div className="card p-5">
          <h2 className="font-semibold mb-3">When people read it</h2>
          {d.readTimeline.length ? (
            <>
              <div className="flex items-end gap-0.5 h-28">
                {d.readTimeline.map((t) => (
                  <div
                    key={t.hour}
                    className="flex-1 bg-emerald-400 rounded-t min-w-[3px]"
                    style={{ height: `${(t.count / maxHour) * 100}%` }}
                    title={`${new Date(t.hour).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit" })}: ${t.count} reads`}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>{new Date(d.readTimeline[0].hour).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit" })}</span>
                <span>{new Date(d.readTimeline[d.readTimeline.length - 1].hour).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit" })}</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">No reads yet.</p>
          )}
        </div>

        {/* Replies */}
        <div className="card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-1.5">
            <MessageCircle size={16} /> Latest replies
          </h2>
          {replies.length ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {replies.map((r, i) => (
                <Link
                  key={i}
                  to={r.conversationId ? `/inbox?conversation=${r.conversationId}` : "/inbox"}
                  className="block border border-slate-100 rounded-lg px-3 py-2 hover:bg-slate-50"
                >
                  <div className="text-xs font-medium">{r.name || formatPhone(r.waId, r.waId.includes("X"))}</div>
                  <div className="text-xs text-slate-500 truncate">{r.text || "—"}</div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No replies yet.</p>
          )}
        </div>
      </div>

      {/* Recipients */}
      <div className="card">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold mr-2">Recipients</h2>
          <div className="flex flex-wrap gap-1.5">
            {RECIPIENT_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setRTab(t.key)}
                className={`text-xs rounded-full px-3 py-1 ${rTab === t.key ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input className="input text-sm pl-8 py-1.5 w-52" placeholder="Name or number" value={rSearch} onChange={(e) => setRSearch(e.target.value)} />
          </div>
          <button
            className="btn-secondary text-xs"
            onClick={() =>
              downloadFromApi(`/broadcasts/${id}/recipients?format=csv${rTab ? `&status=${rTab}` : ""}`, `${b.name}-recipients.csv`).catch((e) => flash(e.message))
            }
          >
            <Download size={13} /> Export
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2.5">Contact</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Sent</th>
              <th className="px-4 py-2.5">Read</th>
              <th className="px-4 py-2.5">Replied</th>
              <th className="px-4 py-2.5">Note</th>
            </tr>
          </thead>
          <tbody>
            {recipients?.items.map((r) => (
              <tr key={r._id} className="border-t border-slate-100">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{r.name || "—"}</div>
                  <div className="text-xs text-slate-400 font-mono">{formatPhone(r.waId, r.waId?.includes("X"))}</div>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-[11px] rounded-full px-2 py-0.5 ${REC_STATUS[r.status] || ""}`}>{r.status === "pending" ? "queued" : r.status}</span>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{r.readAt ? new Date(r.readAt).toLocaleString() : "—"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{r.repliedAt ? new Date(r.repliedAt).toLocaleString() : "—"}</td>
                <td className="px-4 py-2.5 text-xs text-red-600 max-w-xs truncate" title={r.error}>
                  {r.error || ""}
                </td>
              </tr>
            ))}
            {recipients && recipients.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No recipients in this view
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {recipients && recipients.pages > 1 && (
          <div className="flex items-center justify-end gap-2 p-3 border-t border-slate-100 text-xs text-slate-500">
            {recipients.total.toLocaleString()} total
            <button className="btn-secondary text-xs py-1" disabled={rPage <= 1} onClick={() => setRPage(rPage - 1)}>
              <ChevronLeft size={14} />
            </button>
            Page {recipients.page} of {recipients.pages}
            <button className="btn-secondary text-xs py-1" disabled={rPage >= recipients.pages} onClick={() => setRPage(rPage + 1)}>
              <ChevronRight size={14} />
            </button>
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

function FunnelCard({ label, value, base, tone }: { label: string; value: number; base?: number; tone?: "emerald" | "violet" | "red" }) {
  const color = tone === "emerald" ? "text-emerald-700" : tone === "violet" ? "text-violet-700" : tone === "red" ? "text-red-600" : "";
  return (
    <div className="card p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value.toLocaleString()}</div>
      {base !== undefined && <div className="text-xs text-slate-400">{pct(value, base)}%</div>}
    </div>
  );
}

function NextStep({
  title,
  body,
  actionLabel,
  icon,
  onClick,
  disabled,
}: {
  title: string;
  body: string;
  actionLabel: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 flex flex-col">
      <div className="font-medium text-sm">{title}</div>
      <p className="text-xs text-slate-500 mt-1 flex-1">{body}</p>
      <button className="btn-secondary text-xs mt-3 self-start" onClick={onClick} disabled={disabled}>
        {icon} {actionLabel}
      </button>
    </div>
  );
}
