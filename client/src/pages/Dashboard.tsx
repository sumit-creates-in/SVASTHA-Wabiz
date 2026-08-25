import { useEffect, useState } from "react";
import { MessageSquare, Users, Bot, Inbox as InboxIcon, ShieldAlert, UserMinus } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { AnalyticsOverview, Alert as AlertItem } from "../types";

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

function Stat({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-5 flex items-start gap-4">
      <div className="bg-brand-100 text-brand-700 rounded-lg p-2.5">
        <Icon size={20} />
      </div>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-slate-500">{label}</div>
        {hint && <div className="text-xs text-slate-400 mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  useEffect(() => {
    api<AnalyticsOverview>("/analytics/overview").then(setData).catch(() => {});
    api<AlertItem[]>("/alerts?unacknowledged=true").then(setAlerts).catch(() => {});
  }, []);

  async function ack(id: string) {
    await api(`/alerts/${id}/ack`, { method: "POST" });
    setAlerts((prev) => prev.filter((a) => a._id !== id));
  }

  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    days.push(d.toISOString().slice(0, 10));
  }
  const counts = days.map((day) => {
    const inC = data?.byDay.find((b) => b._id.day === day && b._id.direction === "in")?.count || 0;
    const outC = data?.byDay.find((b) => b._id.day === day && b._id.direction === "out")?.count || 0;
    return { day, inC, outC };
  });
  const max = Math.max(1, ...counts.map((c) => c.inC + c.outC));

  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-sm text-slate-500 mb-6">Last 30 days at a glance</p>

      {/* Alerts — quality degradation, Meta throttling, policy events */}
      {alerts.length > 0 && (
        <div className="space-y-2 mb-6">
          {alerts.map((a) => (
            <div
              key={a._id}
              className={`rounded-xl border p-4 flex items-start gap-3 ${
                a.level === "critical"
                  ? "bg-red-50 border-red-200"
                  : a.level === "warning"
                  ? "bg-amber-50 border-amber-200"
                  : "bg-sky-50 border-sky-200"
              }`}
            >
              <ShieldAlert
                size={18}
                className={
                  a.level === "critical" ? "text-red-600" : a.level === "warning" ? "text-amber-600" : "text-sky-600"
                }
              />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{a.title}</div>
                <p className="text-xs text-slate-600 mt-0.5">{a.detail}</p>
                <p className="text-[11px] text-slate-400 mt-1">{new Date(a.createdAt).toLocaleString()}</p>
              </div>
              <button className="btn-secondary text-xs shrink-0" onClick={() => ack(a._id)}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <Stat icon={Users} label="Contacts" value={data?.contacts ?? "–"} />
        <Stat icon={InboxIcon} label="Open conversations" value={data?.openConvs ?? "–"} />
        <Stat
          icon={MessageSquare}
          label="Messages (30d)"
          value={data ? data.msgIn + data.msgOut : "–"}
          hint={data ? `${data.msgIn} in · ${data.msgOut} out` : undefined}
        />
        <Stat
          icon={Bot}
          label="AI automation rate"
          value={data ? `${data.automationRate}%` : "–"}
          hint={data ? `${data.aiReplies} AI replies` : undefined}
        />
        <Stat
          icon={ShieldAlert}
          label="Waiting on a human"
          value={data?.needsHuman ?? "–"}
          hint={data?.atRisk ? `${data.atRisk} at risk of blocking` : undefined}
        />
        <Stat
          icon={UserMinus}
          label="Opted out"
          value={data?.optedOut ?? "–"}
          hint={data?.escalations ? `${data.escalations} AI escalations` : undefined}
        />
      </div>

      {/* Failed sends — the earliest warning of a quality problem */}
      {!!data?.errors?.length && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold mb-1">Failed sends (30 days)</h2>
          <p className="text-xs text-slate-500 mb-4">
            Repeated failures here usually precede a quality downgrade. Code 131049 means Meta is deliberately
            withholding your marketing — reduce frequency.
          </p>
          <div className="space-y-2">
            {data.errors.map((e, i) => (
              <div key={i} className="flex items-start justify-between gap-4 text-sm border-b border-slate-100 pb-2 last:border-0">
                <div className="min-w-0">
                  <span className="font-medium">{e.message}</span>
                  {e.code && <span className="text-xs text-slate-400 ml-2">code {e.code}</span>}
                </div>
                <span className="font-bold text-red-600 shrink-0">{e.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Number health */}
      <div className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Number health</h2>
          <Link to="/numbers" className="text-sm text-brand-600 hover:underline">
            Manage numbers →
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(data?.numbers || []).map((n) => (
            <div key={n._id} className="border border-slate-200 rounded-lg p-4 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">{n.displayPhoneNumber || n.label}</div>
                <div className="text-xs text-slate-500">{n.label}</div>
              </div>
              <div className="text-right text-xs">
                <div className="flex items-center gap-1.5 justify-end">
                  <span className={`w-2 h-2 rounded-full ${qualityDot[n.qualityRating] || qualityDot.UNKNOWN}`} />
                  <span className="font-medium">{qualityLabel[n.qualityRating] || "Unknown"} quality</span>
                </div>
                <div className="text-slate-500 mt-0.5">
                  {n.messagingLimit} · {n.sentToday} sent today
                </div>
              </div>
            </div>
          ))}
          {(!data?.numbers || data.numbers.length === 0) && (
            <p className="text-sm text-slate-400 col-span-full">
              No numbers connected yet — <Link to="/numbers" className="text-brand-600 hover:underline">add one</Link>.
            </p>
          )}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold mb-4">Messages per day (14 days)</h2>
        <div className="flex items-end gap-1.5 h-40">
          {counts.map((c) => (
            <div key={c.day} className="flex-1 flex flex-col justify-end gap-px" title={`${c.day}: ${c.inC} in / ${c.outC} out`}>
              <div className="bg-brand-600 rounded-t" style={{ height: `${(c.outC / max) * 100}%` }} />
              <div className="bg-brand-100 rounded-b" style={{ height: `${(c.inC / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 mt-2">
          <span>{counts[0]?.day.slice(5)}</span>
          <span>{counts[counts.length - 1]?.day.slice(5)}</span>
        </div>
        <div className="flex gap-4 mt-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-brand-600 rounded-sm inline-block" /> Sent</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-brand-100 rounded-sm inline-block" /> Received</span>
        </div>
      </div>
    </div>
  );
}
