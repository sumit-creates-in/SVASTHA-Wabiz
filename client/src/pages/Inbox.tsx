import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Send,
  Sparkles,
  User,
  Search,
  CheckCheck,
  Check,
  AlertCircle,
  X,
  Clock,
  Tag,
  FileText,
  Pause,
  Play,
  Wand2,
  StickyNote,
  Filter
} from "lucide-react";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import type { Conversation, Message, WabaNumber, Agent, Template } from "../types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function countdown(ms: number): string {
  if (ms <= 0) return "closed";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m left`;
}

function StatusTick({ status }: { status: string }) {
  if (status === "failed") return <AlertCircle size={13} className="text-red-500" />;
  if (status === "read") return <CheckCheck size={13} className="text-sky-500" />;
  if (status === "delivered") return <CheckCheck size={13} className="text-slate-400" />;
  return <Check size={13} className="text-slate-400" />;
}

const authorBadge: Record<string, { label: string; cls: string }> = {
  ai: { label: "AI", cls: "text-brand-700" },
  human: { label: "You", cls: "text-slate-500" },
  workflow: { label: "Workflow", cls: "text-indigo-600" },
  broadcast: { label: "Broadcast", cls: "text-amber-600" }
};

export default function Inbox() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [numbers, setNumbers] = useState<WabaNumber[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ number: "", status: "", label: "", assigned: "", unread: "" });
  const [showFilters, setShowFilters] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [sendError, setSendError] = useState("");
  const [showTemplate, setShowTemplate] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [insight, setInsight] = useState<{ intent: string; urgency: string; summary: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const loadConversations = useCallback(async () => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    if (search) params.set("search", search);
    setConversations(await api<Conversation[]>(`/conversations?${params.toString()}`));
  }, [filters, search]);

  useEffect(() => {
    const t = setTimeout(loadConversations, 200);
    return () => clearTimeout(t);
  }, [loadConversations]);

  useEffect(() => {
    api<WabaNumber[]>("/numbers").then(setNumbers).catch(() => {});
    api<Agent[]>("/agents").then(setAgents).catch(() => {});
    api<string[]>("/labels").then(setLabels).catch(() => {});
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onNew = (payload: { message: Message }) => {
      loadConversations();
      if (payload.message?.conversation === activeIdRef.current) {
        setMessages((prev) =>
          prev.some((m) => m._id === payload.message._id) ? prev : [...prev, payload.message]
        );
      }
    };
    const onConvUpdate = () => loadConversations();
    const onStatus = (p: { messageId: string; status: string }) => {
      setMessages((prev) => prev.map((m) => (m._id === p.messageId ? { ...m, status: p.status } : m)));
    };
    socket.on("message:new", onNew);
    socket.on("conversation:update", onConvUpdate);
    socket.on("message:status", onStatus);
    return () => {
      socket.off("message:new", onNew);
      socket.off("conversation:update", onConvUpdate);
      socket.off("message:status", onStatus);
    };
  }, [loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const active = conversations.find((c) => c._id === activeId) || null;

  async function openConversation(id: string) {
    setActiveId(id);
    setSendError("");
    setInsight(null);
    setMessages(await api<Message[]>(`/conversations/${id}/messages`));
    const conv = conversations.find((c) => c._id === id);
    setNoteDraft(conv?.note || "");
    setConversations((prev) => prev.map((c) => (c._id === id ? { ...c, unreadCount: 0 } : c)));
  }

  async function patchConversation(body: Record<string, unknown>) {
    if (!activeId) return;
    const updated = await api<Conversation>(`/conversations/${activeId}`, { method: "PATCH", body });
    setConversations((prev) => prev.map((c) => (c._id === updated._id ? updated : c)));
  }

  async function sendMessage() {
    if (!draft.trim() || !activeId) return;
    const text = draft;
    setSendError("");
    try {
      const msg = await api<Message>(`/conversations/${activeId}/messages`, {
        method: "POST",
        body: { text }
      });
      setDraft("");
      setMessages((prev) => (prev.some((m) => m._id === msg._id) ? prev : [...prev, msg]));
    } catch (e: any) {
      setSendError(e.message);
    }
  }

  async function suggest() {
    if (!activeId) return;
    setSuggesting(true);
    try {
      const { text } = await api<{ text: string }>(`/conversations/${activeId}/suggest`, { method: "POST" });
      if (text) setDraft(text);
    } finally {
      setSuggesting(false);
    }
  }

  async function classify() {
    if (!activeId) return;
    const r = await api<any>(`/conversations/${activeId}/classify`, { method: "POST" });
    if (r && r.intent) setInsight(r);
    loadConversations();
  }

  async function addLabel() {
    if (!newLabel.trim() || !active) return;
    await patchConversation({ labels: Array.from(new Set([...active.labels, newLabel.trim()])) });
    setNewLabel("");
    api<string[]>("/labels").then(setLabels).catch(() => {});
  }

  const windowOpen = active?.insideWindow;

  return (
    <div className="flex h-full">
      {/* ── Conversation list ── */}
      <div className="w-80 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-3 border-b border-slate-200 space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                className="input pl-9"
                placeholder="Search chats…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              className={`btn-secondary px-3 ${showFilters ? "bg-brand-100 border-brand-200" : ""}`}
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter size={15} />
            </button>
          </div>
          {showFilters && (
            <div className="space-y-2 pt-1">
              <select
                className="input text-xs"
                value={filters.number}
                onChange={(e) => setFilters({ ...filters, number: e.target.value })}
              >
                <option value="">All numbers</option>
                {numbers.map((n) => (
                  <option key={n._id} value={n._id}>
                    {n.label} · {n.displayPhoneNumber}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="input text-xs"
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                >
                  <option value="">Any status</option>
                  <option value="open">Open</option>
                  <option value="pending">Pending</option>
                  <option value="closed">Closed</option>
                </select>
                <select
                  className="input text-xs"
                  value={filters.assigned}
                  onChange={(e) => setFilters({ ...filters, assigned: e.target.value })}
                >
                  <option value="">Anyone</option>
                  <option value="me">Assigned to me</option>
                  <option value="unassigned">Unassigned</option>
                </select>
              </div>
              <select
                className="input text-xs"
                value={filters.label}
                onChange={(e) => setFilters({ ...filters, label: e.target.value })}
              >
                <option value="">All labels</option>
                {labels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-emerald-600"
                  checked={filters.unread === "true"}
                  onChange={(e) => setFilters({ ...filters, unread: e.target.checked ? "true" : "" })}
                />
                Unread only
              </label>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="p-6 text-sm text-slate-400 text-center">No conversations match.</p>
          )}
          {conversations.map((c) => (
            <button
              key={c._id}
              onClick={() => openConversation(c._id)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 ${
                activeId === c._id ? "bg-brand-50" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">{c.contact?.name || c.contact?.waId}</span>
                <span className="text-[11px] text-slate-400 shrink-0">{timeAgo(c.lastMessageAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-xs text-slate-500 truncate">{c.lastMessagePreview}</span>
                <span className="flex items-center gap-1 shrink-0">
                  {c.aiEnabled && <Bot size={13} className="text-brand-600" />}
                  {c.unreadCount > 0 && (
                    <span className="bg-brand-600 text-white text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                      {c.unreadCount}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                <span className="text-[10px] text-slate-400">{c.number?.label}</span>
                {c.labels.slice(0, 3).map((l) => (
                  <span key={l} className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
                    {l}
                  </span>
                ))}
                {c.assignedTo && (
                  <span className="text-[10px] bg-indigo-50 text-indigo-600 rounded px-1.5 py-0.5">
                    {c.assignedTo.name}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Chat pane ── */}
      {active ? (
        <>
          <div className="flex-1 flex flex-col min-w-0 bg-[#efeae2]">
            <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">{active.contact?.name || active.contact?.waId}</div>
                <div className="text-xs text-slate-500">
                  +{active.contact?.waId} · via {active.number?.label}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs rounded-full px-2.5 py-1 font-medium ${
                    windowOpen ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}
                  title="WhatsApp only allows free-form replies within 24h of the customer's last message"
                >
                  <Clock size={12} className="inline mr-1" />
                  {windowOpen ? countdown(active.windowRemainingMs || 0) : "24h window closed"}
                </span>
                <select
                  className="input text-xs w-28 py-1"
                  value={active.status}
                  onChange={(e) => patchConversation({ status: e.target.value })}
                >
                  <option value="open">Open</option>
                  <option value="pending">Pending</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
              {messages.map((m) => {
                const mine = m.direction === "out";
                if (m.author === "system")
                  return (
                    <div key={m._id} className="text-center">
                      <span className="inline-block text-[11px] bg-amber-100 text-amber-800 rounded-full px-3 py-1">
                        {m.text}
                      </span>
                    </div>
                  );
                const badge = authorBadge[m.author];
                return (
                  <div key={m._id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[70%] rounded-xl px-3 py-2 text-sm shadow-sm ${
                        mine ? "bg-[#d9fdd3]" : "bg-white"
                      }`}
                    >
                      {mine && badge && (
                        <div className={`flex items-center gap-1 text-[10px] font-semibold mb-0.5 ${badge.cls}`}>
                          {m.author === "ai" ? <Bot size={11} /> : m.author === "human" ? <User size={11} /> : <FileText size={11} />}
                          {badge.label}
                          {m.type === "template" && " · template"}
                        </div>
                      )}
                      <p className="whitespace-pre-wrap break-words">{m.text}</p>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <span className="text-[10px] text-slate-400">
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {mine && <StatusTick status={m.status} />}
                      </div>
                      {m.error && <p className="text-[10px] text-red-500 mt-0.5">{m.error}</p>}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {sendError && (
              <div className="bg-amber-50 border-t border-amber-200 px-4 py-2 text-xs text-amber-800 flex items-center justify-between gap-3">
                <span>{sendError}</span>
                <button className="btn-secondary text-xs py-1" onClick={() => setShowTemplate(true)}>
                  <FileText size={12} /> Send template instead
                </button>
              </div>
            )}

            <div className="bg-white border-t border-slate-200 p-3 flex items-end gap-2">
              <button onClick={suggest} disabled={suggesting} className="btn-secondary shrink-0" title="Ask AI to draft a reply">
                <Sparkles size={16} className={suggesting ? "animate-pulse" : ""} />
                {suggesting ? "Thinking…" : "AI draft"}
              </button>
              <button className="btn-secondary shrink-0" onClick={() => setShowTemplate(true)} title="Send an approved template">
                <FileText size={16} />
              </button>
              <textarea
                className="input resize-none"
                rows={Math.min(4, Math.max(1, draft.split("\n").length))}
                placeholder={windowOpen ? "Type a reply…" : "24h window closed — send an approved template"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
              <button onClick={sendMessage} className="btn-primary shrink-0" disabled={!draft.trim()}>
                <Send size={16} />
              </button>
            </div>
          </div>

          {/* ── Chat actions rail ── */}
          <aside className="w-72 shrink-0 border-l border-slate-200 bg-white overflow-y-auto">
            <div className="px-4 py-3 border-b border-slate-200">
              <h3 className="font-semibold text-sm">Chat Actions</h3>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <QuickAction
                  active={!active.botPaused}
                  icon={active.botPaused ? <Play size={17} /> : <Pause size={17} />}
                  label={active.botPaused ? "Resume bot" : "Pause bot"}
                  onClick={() => patchConversation({ botPaused: !active.botPaused })}
                />
                <QuickAction
                  active={active.aiEnabled}
                  icon={<Bot size={17} />}
                  label={active.aiEnabled ? "Pause AI" : "Enable AI"}
                  onClick={() => patchConversation({ aiEnabled: !active.aiEnabled })}
                />
                <QuickAction active={false} icon={<Wand2 size={17} />} label="Analyse" onClick={classify} />
              </div>

              {insight && (
                <div className="bg-indigo-50 rounded-lg p-3 text-xs space-y-1">
                  <div className="font-semibold text-indigo-800">
                    {insight.intent} · {insight.urgency} urgency
                  </div>
                  <p className="text-indigo-700">{insight.summary}</p>
                </div>
              )}

              <section>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Customer</h4>
                <dl className="text-xs space-y-1.5">
                  <Row label="Phone" value={`+${active.contact?.waId}`} />
                  <Row label="Email" value={active.contact?.email || "Not set"} />
                  <Row label="Last seen" value={active.contact?.lastSeenAt ? new Date(active.contact.lastSeenAt).toLocaleString() : "—"} />
                  <Row label="Number" value={`${active.number?.label} (${active.number?.displayPhoneNumber})`} />
                  <Row label="Opted out" value={active.contact?.optedOut ? "Yes" : "No"} />
                  <Row label="Tags" value={active.contact?.tags?.join(", ") || "—"} />
                </dl>
              </section>

              <section>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Messaging window</h4>
                <div
                  className={`rounded-lg px-3 py-2 text-xs font-medium ${
                    windowOpen ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {windowOpen
                    ? `Inside 24h window · ${countdown(active.windowRemainingMs || 0)}`
                    : "Closed — only approved templates can be sent"}
                </div>
              </section>

              <section>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Assigned agent</h4>
                <select
                  className="input text-xs"
                  value={active.assignedTo?._id || ""}
                  onChange={(e) => patchConversation({ assignedTo: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {agents.map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.name} ({a.role})
                    </option>
                  ))}
                </select>
              </section>

              <section>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  <Tag size={12} className="inline mr-1" /> Labels
                </h4>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {active.labels.map((l) => (
                    <span key={l} className="inline-flex items-center gap-1 bg-brand-100 text-brand-700 text-xs rounded-full px-2 py-0.5">
                      {l}
                      <button
                        onClick={() => patchConversation({ labels: active.labels.filter((x) => x !== l) })}
                        className="hover:text-brand-900"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  {active.labels.length === 0 && <span className="text-xs text-slate-400">No labels</span>}
                </div>
                <input
                  className="input text-xs"
                  placeholder="Type a label and press Enter"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLabel();
                    }
                  }}
                  list="existing-labels"
                />
                <datalist id="existing-labels">
                  {labels.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </section>

              <section>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  <StickyNote size={12} className="inline mr-1" /> Internal note
                </h4>
                <textarea
                  className="input text-xs"
                  rows={3}
                  placeholder="Only your team sees this"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onBlur={() => noteDraft !== active.note && patchConversation({ note: noteDraft })}
                />
              </section>
            </div>
          </aside>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          Select a conversation to start
        </div>
      )}

      {showTemplate && active && (
        <TemplateModal
          conversationId={active._id}
          onClose={() => setShowTemplate(false)}
          onSent={(msg) => {
            setShowTemplate(false);
            setSendError("");
            setMessages((prev) => [...prev, msg]);
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500 shrink-0">{label}</dt>
      <dd className="text-slate-800 text-right truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
  active
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 py-2 rounded-lg hover:bg-slate-50 transition-colors"
    >
      <span
        className={`w-10 h-10 rounded-full border-2 flex items-center justify-center ${
          active ? "border-brand-500 text-brand-600" : "border-slate-200 text-slate-400"
        }`}
      >
        {icon}
      </span>
      <span className="text-[10px] text-slate-600 text-center leading-tight">{label}</span>
    </button>
  );
}

function TemplateModal({
  conversationId,
  onClose,
  onSent
}: {
  conversationId: string;
  onClose: () => void;
  onSent: (m: Message) => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Template[]>("/templates")
      .then((t) => setTemplates(t.filter((x) => x.status === "APPROVED")))
      .catch(() => {});
  }, []);

  async function send() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const msg = await api<Message>(`/conversations/${conversationId}/template`, {
        method: "POST",
        body: { templateName: selected.name, language: selected.language, bodyParams: params }
      });
      onSent(msg);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-6 z-50" onClick={onClose}>
      <div className="card w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Send approved template</h2>
        <select
          className="input"
          value={selected?._id || ""}
          onChange={(e) => {
            const t = templates.find((x) => x._id === e.target.value) || null;
            setSelected(t);
            setParams(new Array(t?.variableCount || 0).fill(""));
          }}
        >
          <option value="">Select template…</option>
          {templates.map((t) => (
            <option key={t._id} value={t._id}>
              {t.name} ({t.language})
            </option>
          ))}
        </select>
        {selected && (
          <>
            <p className="text-sm bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{selected.bodyText}</p>
            {params.map((p, i) => (
              <div key={i}>
                <label className="label">Variable {`{{${i + 1}}}`}</label>
                <input
                  className="input"
                  value={p}
                  onChange={(e) => setParams(params.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </div>
            ))}
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button className="btn-primary" onClick={send} disabled={!selected || busy}>
            {busy ? "Sending…" : "Send"}
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
