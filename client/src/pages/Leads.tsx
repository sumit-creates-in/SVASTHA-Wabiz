import { useCallback, useEffect, useState } from "react";
import { Target, LifeBuoy, Flame } from "lucide-react";
import { api } from "../lib/api";
import type { Lead, Ticket, Agent } from "../types";

const leadStatus: { key: Lead["status"]; label: string; cls: string }[] = [
  { key: "new", label: "New", cls: "bg-slate-100 text-slate-600" },
  { key: "qualified", label: "Qualified", cls: "bg-sky-100 text-sky-700" },
  { key: "call_booked", label: "Call booked", cls: "bg-indigo-100 text-indigo-700" },
  { key: "converted", label: "Converted", cls: "bg-emerald-100 text-emerald-700" },
  { key: "lost", label: "Lost", cls: "bg-red-100 text-red-600" }
];

const ticketStatus: Record<string, string> = {
  open: "bg-amber-100 text-amber-700",
  in_progress: "bg-sky-100 text-sky-700",
  resolved: "bg-emerald-100 text-emerald-700",
  closed: "bg-slate-100 text-slate-500"
};

const priorityColor: Record<string, string> = {
  urgent: "text-red-600",
  high: "text-amber-600",
  normal: "text-slate-500",
  low: "text-slate-400"
};

export default function Leads() {
  const [tab, setTab] = useState<"leads" | "tickets">("leads");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLeads(await api<Lead[]>(`/leads${filter ? `?status=${filter}` : ""}`));
    } catch {
      /* no permission */
    }
    try {
      setTickets(await api<Ticket[]>("/tickets"));
    } catch {
      /* no permission */
    }
  }, [filter]);

  useEffect(() => {
    load();
    api<Agent[]>("/agents").then(setAgents).catch(() => {});
  }, [load]);

  async function updateLead(id: string, body: Record<string, unknown>) {
    await api(`/leads/${id}`, { method: "PATCH", body });
    load();
  }
  async function updateTicket(id: string, body: Record<string, unknown>) {
    await api(`/tickets/${id}`, { method: "PATCH", body });
    load();
  }

  const openTickets = tickets.filter((t) => t.status === "open" || t.status === "in_progress").length;

  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="text-2xl font-bold mb-1">Leads &amp; Tickets</h1>
      <p className="text-sm text-slate-500 mb-6">Captured automatically by the AI from WhatsApp conversations</p>

      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setTab("leads")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium flex items-center gap-2 ${
            tab === "leads" ? "bg-brand-100 text-brand-700" : "border border-slate-200 text-slate-600"
          }`}
        >
          <Target size={14} /> Leads ({leads.length})
        </button>
        <button
          onClick={() => setTab("tickets")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium flex items-center gap-2 ${
            tab === "tickets" ? "bg-brand-100 text-brand-700" : "border border-slate-200 text-slate-600"
          }`}
        >
          <LifeBuoy size={14} /> Tickets ({openTickets} open)
        </button>
      </div>

      {tab === "leads" ? (
        <>
          <div className="flex gap-2 mb-4 flex-wrap">
            <button
              onClick={() => setFilter("")}
              className={`text-xs rounded-full px-3 py-1 ${!filter ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              All
            </button>
            {leadStatus.map((s) => (
              <button
                key={s.key}
                onClick={() => setFilter(s.key)}
                className={`text-xs rounded-full px-3 py-1 ${filter === s.key ? "bg-slate-800 text-white" : s.cls}`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {leads.map((l) => (
              <div key={l._id} className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{l.contact?.name || l.contact?.waId}</span>
                      {l.score >= 70 && (
                        <span className="text-xs text-orange-600 flex items-center gap-0.5">
                          <Flame size={12} /> hot
                        </span>
                      )}
                      <span className="text-xs text-slate-400">
                        {l.contact?.masked ? l.contact.waId : `+${l.contact?.waId}`}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 mt-0.5">{l.interest || "No interest recorded"}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {l.source} · {new Date(l.createdAt).toLocaleString()}
                      {l.number?.label && ` · ${l.number.label}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <div className="text-lg font-bold">{l.score}</div>
                      <div className="text-[10px] text-slate-400">score</div>
                    </div>
                    <select
                      className="input text-xs w-32 py-1"
                      value={l.status}
                      onChange={(e) => updateLead(l._id, { status: e.target.value })}
                    >
                      {leadStatus.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="input text-xs w-32 py-1"
                      value={l.assignedTo?._id || ""}
                      onChange={(e) => updateLead(l._id, { assignedTo: e.target.value || null })}
                    >
                      <option value="">Unassigned</option>
                      {agents.map((a) => (
                        <option key={a._id} value={a._id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {Object.keys(l.qualification || {}).length > 0 && (
                  <>
                    <button
                      className="text-xs text-brand-600 mt-3"
                      onClick={() => setExpanded(expanded === l._id ? null : l._id)}
                    >
                      {expanded === l._id ? "Hide" : "Show"} what the AI captured
                    </button>
                    {expanded === l._id && (
                      <dl className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs bg-slate-50 rounded-lg p-3">
                        {Object.entries(l.qualification).map(([k, v]) => (
                          <div key={k}>
                            <dt className="text-slate-500">{k.replace(/_/g, " ")}</dt>
                            <dd className="font-medium">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </>
                )}
              </div>
            ))}
            {leads.length === 0 && (
              <div className="card p-12 text-center text-slate-400">
                <Target size={26} className="mx-auto mb-2 text-slate-300" />
                No leads yet. They appear here automatically when an AI action with "Create a lead record" fires.
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <div key={t._id} className="card p-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-xs bg-slate-100 rounded px-1.5 py-0.5">{t.reference}</code>
                  <span className="font-semibold">{t.subject || "Support request"}</span>
                  <span className={`text-xs font-medium ${priorityColor[t.priority]}`}>{t.priority}</span>
                </div>
                <p className="text-sm text-slate-600 mt-1">{t.detail}</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  {t.contact?.name || t.contact?.waId} · {t.category} · {new Date(t.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs rounded-full px-2 py-0.5 ${ticketStatus[t.status]}`}>
                  {t.status.replace("_", " ")}
                </span>
                <select
                  className="input text-xs w-32 py-1"
                  value={t.status}
                  onChange={(e) => updateTicket(t._id, { status: e.target.value })}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
                <select
                  className="input text-xs w-32 py-1"
                  value={t.assignedTo?._id || ""}
                  onChange={(e) => updateTicket(t._id, { assignedTo: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {agents.map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          {tickets.length === 0 && (
            <div className="card p-12 text-center text-slate-400">
              <LifeBuoy size={26} className="mx-auto mb-2 text-slate-300" />
              No tickets yet. They're created automatically when an AI action with "Create a support ticket" fires.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
