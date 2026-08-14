import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Settings } from "../types";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Settings>("/settings").then(setS).catch(() => { });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    setBusy(true);
    try {
      await api("/settings", { method: "PATCH", body: s });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <div className="p-8 text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="h-full overflow-y-auto p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <form onSubmit={save} className="space-y-6">
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold">General</h2>
          <div>
            <label className="label">Business name</label>
            <input className="input" value={s.businessName} onChange={(e) => setS({ ...s, businessName: e.target.value })} />
          </div>
        </div>

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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Provider</label>
              <select
                className="input"
                value={s.aiProvider}
                onChange={(e) => {
                  const p = e.target.value as "claude" | "openai";
                  setS({ ...s, aiProvider: p, aiModel: p === "claude" ? "claude-sonnet-5" : "gpt-4o-mini" });
                }}
              >
                <option value="claude">Claude (Anthropic)</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <div>
              <label className="label">Model</label>
              <input className="input" value={s.aiModel} onChange={(e) => setS({ ...s, aiModel: e.target.value })} />
            </div>
            <div>
              <label className="label">Max reply tokens</label>
              <input className="input" type="number" value={s.aiMaxTokens} onChange={(e) => setS({ ...s, aiMaxTokens: parseInt(e.target.value) || 500 })} />
            </div>
          </div>
          <div>
            <label className="label">System prompt (the AI's personality & rules)</label>
            <textarea className="input font-mono text-xs" rows={6} value={s.systemPrompt} onChange={(e) => setS({ ...s, systemPrompt: e.target.value })} />
          </div>
          <div>
            <label className="label">Human-handoff keywords (comma-separated — pauses AI when a customer says these)</label>
            <input
              className="input"
              value={s.handoffKeywords.join(", ")}
              onChange={(e) => setS({ ...s, handoffKeywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })}
            />
          </div>
        </div>

        {/* ── Quality & compliance ── */}
        <div className="card p-6 space-y-4">
          <div>
            <h2 className="font-semibold">Quality &amp; compliance</h2>
            <p className="text-xs text-slate-500 mt-1">
              These limits protect your numbers' quality rating. Meta downgrades numbers that get blocked or
              reported, which cuts your messaging limit.
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
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 accent-emerald-600"
              checked={s.blockSendOnRedQuality}
              onChange={(e) => setS({ ...s, blockSendOnRedQuality: e.target.checked })}
            />
            Automatically pause marketing sends when a number's quality drops to RED
          </label>
          <div>
            <label className="label">Opt-out keywords (customer messages that stop everything)</label>
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

        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Business hours</h2>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={s.businessHours.enabled}
                onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, enabled: e.target.checked } })}
                className="w-4 h-4 accent-emerald-600"
              />
              Enabled
            </label>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Start</label>
              <input className="input" type="time" value={s.businessHours.start} onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, start: e.target.value } })} />
            </div>
            <div>
              <label className="label">End</label>
              <input className="input" type="time" value={s.businessHours.end} onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, end: e.target.value } })} />
            </div>
            <div>
              <label className="label">Timezone</label>
              <input className="input" value={s.businessHours.timezone} onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, timezone: e.target.value } })} />
            </div>
          </div>
          <div>
            <label className="label">Outside-hours auto message (optional)</label>
            <input className="input" placeholder="We're closed right now — we'll reply in the morning!" value={s.outsideHoursMessage} onChange={(e) => setS({ ...s, outsideHoursMessage: e.target.value })} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
          {saved && <span className="text-sm text-brand-600">Saved ✓</span>}
        </div>
      </form>
    </div>
  );
}
