import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, User, Search, CheckCheck, Check, AlertCircle } from "lucide-react";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import type { Conversation, Message } from "../types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function StatusTick({ status }: { status: string }) {
  if (status === "failed") return <AlertCircle size={13} className="text-red-500" />;
  if (status === "read") return <CheckCheck size={13} className="text-sky-500" />;
  if (status === "delivered") return <CheckCheck size={13} className="text-slate-400" />;
  return <Check size={13} className="text-slate-400" />;
}

export default function Inbox() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const loadConversations = useCallback(async () => {
    setConversations(await api<Conversation[]>("/conversations"));
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const socket = getSocket();
    const onNew = (payload: { message: Message; conversation: Conversation }) => {
      loadConversations();
      if (payload.message.conversation === activeIdRef.current) {
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

  async function openConversation(id: string) {
    setActiveId(id);
    setMessages(await api<Message[]>(`/conversations/${id}/messages`));
    setConversations((prev) => prev.map((c) => (c._id === id ? { ...c, unreadCount: 0 } : c)));
  }

  async function sendMessage() {
    if (!draft.trim() || !activeId) return;
    const text = draft;
    setDraft("");
    const msg = await api<Message>(`/conversations/${activeId}/messages`, {
      method: "POST",
      body: { text }
    });
    setMessages((prev) => (prev.some((m) => m._id === msg._id) ? prev : [...prev, msg]));
  }

  async function toggleAI(conv: Conversation) {
    const updated = await api<Conversation>(`/conversations/${conv._id}`, {
      method: "PATCH",
      body: { aiEnabled: !conv.aiEnabled }
    });
    setConversations((prev) => prev.map((c) => (c._id === updated._id ? updated : c)));
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

  const active = conversations.find((c) => c._id === activeId) || null;
  const filtered = conversations.filter(
    (c) =>
      !search ||
      c.contact?.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.contact?.waId?.includes(search)
  );

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="w-80 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-3 border-b border-slate-200">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search chats…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="p-6 text-sm text-slate-400 text-center">No conversations yet. Messages from customers appear here.</p>
          )}
          {filtered.map((c) => (
            <button
              key={c._id}
              onClick={() => openConversation(c._id)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 ${
                activeId === c._id ? "bg-brand-50" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">
                  {c.contact?.name || c.contact?.waId}
                </span>
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
            </button>
          ))}
        </div>
      </div>

      {/* Chat pane */}
      {active ? (
        <div className="flex-1 flex flex-col min-w-0 bg-[#efeae2]">
          <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between">
            <div>
              <div className="font-semibold text-sm">{active.contact?.name || active.contact?.waId}</div>
              <div className="text-xs text-slate-500">+{active.contact?.waId}</div>
            </div>
            <button
              onClick={() => toggleAI(active)}
              className={`btn text-xs ${
                active.aiEnabled
                  ? "bg-brand-100 text-brand-700 hover:bg-brand-50"
                  : "bg-slate-200 text-slate-600 hover:bg-slate-100"
              }`}
              title="Toggle AI auto-reply for this chat"
            >
              <Bot size={15} /> AI {active.aiEnabled ? "ON" : "OFF"}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
            {messages.map((m) => {
              const mine = m.direction === "out";
              const isSystem = m.author === "system";
              if (isSystem)
                return (
                  <div key={m._id} className="text-center">
                    <span className="inline-block text-[11px] bg-amber-100 text-amber-800 rounded-full px-3 py-1">
                      {m.text}
                    </span>
                  </div>
                );
              return (
                <div key={m._id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[70%] rounded-xl px-3 py-2 text-sm shadow-sm ${
                      mine ? "bg-[#d9fdd3]" : "bg-white"
                    }`}
                  >
                    {mine && m.author === "ai" && (
                      <div className="flex items-center gap-1 text-[10px] font-semibold text-brand-700 mb-0.5">
                        <Bot size={11} /> AI
                      </div>
                    )}
                    {mine && m.author === "human" && (
                      <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 mb-0.5">
                        <User size={11} /> You
                      </div>
                    )}
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <span className="text-[10px] text-slate-400">
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {mine && <StatusTick status={m.status} />}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <div className="bg-white border-t border-slate-200 p-3 flex items-end gap-2">
            <button
              onClick={suggest}
              disabled={suggesting}
              className="btn-secondary shrink-0"
              title="Ask AI to draft a reply"
            >
              <Sparkles size={16} className={suggesting ? "animate-pulse" : ""} />
              {suggesting ? "Thinking…" : "AI draft"}
            </button>
            <textarea
              className="input resize-none"
              rows={draft.split("\n").length > 3 ? 4 : Math.max(1, draft.split("\n").length)}
              placeholder="Type a reply…"
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
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          Select a conversation to start
        </div>
      )}
    </div>
  );
}
