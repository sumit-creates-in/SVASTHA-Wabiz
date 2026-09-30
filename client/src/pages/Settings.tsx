import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import type { Settings } from "../types";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const original = useRef<string>("");

  useEffect(() => {
    api<Settings>("/settings")
      .then((data) => {
        setS(data);
        original.current = JSON.stringify(data);
      })
      .catch((e) => setError(e.message));
  }, []);

  const dirty = !!s && JSON.stringify(s) !== original.current;

  // Don't let unsaved changes disappear silently on navigation/refresh.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!s) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api<Settings>("/settings", { method: "PATCH", body: s });
      setS(updated);
      original.current = JSON.stringify(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <div className="p-8 text-slate-400 text-sm">{error || "Loading…"}</div>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-8 max-w-3xl pb-32">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        <form onSubmit={save} className="space-y-6">
          <div className="card p-6 space-y-4">
            <h2 className="font-semibold">General</h2>
            <div>
              <label className="label">Business name</label>
              <input className="input" value={s.businessName} onChange={(e) => setS({ ...s, businessName: e.target.value })} />
            </div>
          </div>

          {/* ── AI auto-reply ── */}
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">AI auto-reply</h2>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={s.aiGlobalEnabled}
                  onChange={(e) => setS({ ...s, aiGlobalEnabled: e.target.checked })}
                  className="w-4 h-4 accent-emerald-600"
                />
                Enabled globally
              </label>
            </div>
            <OneMindNote />
          </div>

          {/* ── AI safety ── */}
          <div className="card p-6 space-y-4">
            <div className="flex items-start gap-3">
              <ShieldCheck size={20} className="text-brand-600 mt-0.5 shrink-0" />
              <div>
                <h2 className="font-semibold">AI safety review</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Every AI reply is checked before it's sent. These rules exist because blocks and reports — not
                  message volume — are what drive a number's quality rating down.
                </p>
              </div>
            </div>

            <Toggle
              checked={s.frustrationAutoHandoff}
              onChange={(v) => setS({ ...s, frustrationAutoHandoff: v })}
              label="Label frustrated customers as at-risk"
              hint="Adds an at-risk label in the inbox. Whether a support call is raised is decided by One Mind."
            />
            <Toggle
              checked={s.blockPromoWhenNotAsked}
              onChange={(v) => setS({ ...s, blockPromoWhenNotAsked: v })}
              label="Block promotional language the customer didn't ask for"
              hint="Unsolicited selling inside a support chat is the most common cause of reports."
            />
            <Toggle
              checked={s.conservativeOnYellowQuality}
              onChange={(v) => setS({ ...s, conservativeOnYellowQuality: v })}
              label="Caution mode when quality drops to YELLOW"
              hint="Shorter, strictly factual replies and no promotional content until the rating recovers."
            />
            <Toggle
              checked={s.autoPauseMarketingOnDegrade}
              onChange={(v) => setS({ ...s, autoPauseMarketingOnDegrade: v })}
              label="Cancel running broadcasts if a number goes RED"
              hint="Stops the bleeding before Meta cuts your messaging tier."
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Max links per reply</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={s.maxLinksPerReply}
                  onChange={(e) => setS({ ...s, maxLinksPerReply: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>

          {/* ── Quality & compliance ── */}
          <div className="card p-6 space-y-4">
            <div>
              <h2 className="font-semibold">Quality &amp; compliance limits</h2>
              <p className="text-xs text-slate-500 mt-1">
                Hard limits enforced on every outbound message.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Max AI replies per chat per hour</label>
                <input
                  className="input"
                  type="number"
                  value={s.maxAiRepliesPerHour}
                  onChange={(e) => setS({ ...s, maxAiRepliesPerHour: parseInt(e.target.value) || 20 })}
                />
              </div>
              <div>
                <label className="label">Max reply length (characters)</label>
                <input
                  className="input"
                  type="number"
                  value={s.maxReplyChars}
                  onChange={(e) => setS({ ...s, maxReplyChars: parseInt(e.target.value) || 900 })}
                />
              </div>
              <div>
                <label className="label">Max marketing messages per contact per day</label>
                <input
                  className="input"
                  type="number"
                  value={s.maxMarketingPerContactPerDay}
                  onChange={(e) => setS({ ...s, maxMarketingPerContactPerDay: parseInt(e.target.value) || 2 })}
                />
              </div>
              <div>
                <label className="label">Pause AI after a human replies (minutes)</label>
                <input
                  className="input"
                  type="number"
                  value={s.pauseAiAfterHumanReplyMinutes}
                  onChange={(e) => setS({ ...s, pauseAiAfterHumanReplyMinutes: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <Toggle
              checked={s.blockSendOnRedQuality}
              onChange={(v) => setS({ ...s, blockSendOnRedQuality: v })}
              label="Pause marketing sends when quality is RED"
            />
            <div>
              <label className="label">Opt-out keywords</label>
              <input
                className="input"
                value={s.optOutKeywords.join(", ")}
                onChange={(e) => setS({ ...s, optOutKeywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })}
              />
            </div>
            <div>
              <label className="label">Opt-out confirmation message</label>
              <input className="input" value={s.optOutReply} onChange={(e) => setS({ ...s, optOutReply: e.target.value })} />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </div>

      {/* Sticky save bar — nothing is stored until you press this */}
      <div
        className={`fixed bottom-0 left-60 right-0 border-t px-8 py-3 flex items-center justify-between transition-colors ${
          dirty ? "bg-amber-50 border-amber-200" : "bg-white border-slate-200"
        }`}
      >
        <span className="text-sm flex items-center gap-2">
          {dirty ? (
            <>
              <AlertTriangle size={15} className="text-amber-600" />
              <span className="text-amber-800 font-medium">Unsaved changes</span>
            </>
          ) : saved ? (
            <span className="text-brand-600 font-medium">Saved ✓</span>
          ) : (
            <span className="text-slate-400">All changes saved</span>
          )}
        </span>
        <button className="btn-primary" onClick={() => save()} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}

/** Where replies come from. Read-only: nothing about the AI is set in this app. */
function OneMindNote() {
  const [st, setSt] = useState<{ configured: boolean; version: string | null; lastError: string | null } | null>(null);
  useEffect(() => {
    api<{ configured: boolean; version: string | null; lastError: string | null }>("/one-mind").then(setSt).catch(() => {});
  }, []);
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
      <p className="font-medium">Replies come from One Mind{st?.version ? ` — version ${st.version}` : ""}.</p>
      <p className="text-xs mt-1">
        What the bot knows, how it speaks, which AI it uses, call bookings and support call-backs are all managed in the
        CRM → Bots → Brain (super admin only). Nothing about the AI is stored or edited in Wabiz.
      </p>
      {st && !st.configured && <p className="text-xs mt-1 text-red-700">One Mind is not connected — the bot cannot reply.</p>}
      {st?.lastError && <p className="text-xs mt-1 text-amber-700">Last problem reaching One Mind: {st.lastError}</p>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        className="w-4 h-4 accent-emerald-600 mt-0.5 shrink-0"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-slate-500 mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}
