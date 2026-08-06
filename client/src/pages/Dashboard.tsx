import { useEffect, useState } from "react";
import { MessageSquare, Users, Bot, Inbox as InboxIcon } from "lucide-react";
import { api } from "../lib/api";
import type { AnalyticsOverview } from "../types";

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

  useEffect(() => {
    api<AnalyticsOverview>("/analytics/overview").then(setData).catch(() => {});
  }, []);

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
