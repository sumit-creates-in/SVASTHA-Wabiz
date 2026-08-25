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
                <input
                  className="input"
                  type="number"
                  value={s.aiMaxTokens}
                  onChange={(e) => setS({ ...s, aiMaxTokens: parseInt(e.target.value) || 500 })}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Switching provider needs the matching API key set on the server
              (<code className="bg-slate-100 px-1 rounded">ANTHROPIC_API_KEY</code> or{" "}
              <code className="bg-slate-100 px-1 rounded">OPENAI_API_KEY</code>).
            </p>
            <div>
              <label className="label">System prompt (the AI's personality &amp; rules)</label>
              <textarea
                className="input font-mono text-xs"
                rows={6}
                value={s.systemPrompt}
                onChange={(e) => setS({ ...s, systemPrompt: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Human-handoff keywords (comma-separated)</label>
              <input
                className="input"
                value={s.handoffKeywords.join(", ")}
                onChange={(e) => setS({ ...s, handoffKeywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })}
              />
            </div>
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
              checked={s.escalateWhenUnsure}
              onChange={(v) => setS({ ...s, escalateWhenUnsure: v })}
              label="Escalate instead of guessing"
              hint="When the answer isn't in the knowledge base, the AI hands the chat to a human rather than inventing an answer."
            />
            <Toggle
              checked={s.frustrationAutoHandoff}
              onChange={(v) => setS({ ...s, frustrationAutoHandoff: v })}
              label="Detect frustration and hand off automatically"
              hint="An annoyed customer is one tap from blocking you. The AI stops and flags the chat as at-risk."
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
            <div>
              <label className="label">Holding message when the AI escalates</label>
              <input
                className="input"
                value={s.escalationMessage}
                onChange={(e) => setS({ ...s, escalationMessage: e.target.value })}
              />
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

          {/* ── Svastha app integration ── */}
          <div className="card p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold">Svastha app — customer lookup</h2>
                <p className="text-xs text-slate-500 mt-1">
                  On each inbound message WABIZ asks your API who the sender is. The answer decides whether the AI
                  treats them as a lead or an existing customer, and their account details are given to the AI so
                  it can answer accurately instead of guessing.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-emerald-600"
                  checked={s.customerLookupEnabled}
                  onChange={(e) => setS({ ...s, customerLookupEnabled: e.target.checked })}
                />
                Enabled
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-3">
                <label className="label">Lookup URL — {"{{phone}}"} is replaced with the number</label>
                <input
                  className="input font-mono text-xs"
                  placeholder="https://api.svastha.app/v1/customers/lookup?phone={{phone}}"
                  value={s.customerLookupUrl}
                  onChange={(e) => setS({ ...s, customerLookupUrl: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Method</label>
                <select
                  className="input"
                  value={s.customerLookupMethod}
                  onChange={(e) => setS({ ...s, customerLookupMethod: e.target.value as any })}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label">Headers (one per line, Key: Value — put your API key here)</label>
              <textarea
                className="input font-mono text-xs"
                rows={2}
                placeholder="Authorization: Bearer YOUR_API_KEY"
                value={Object.entries(s.customerLookupHeaders || {})
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n")}
                onChange={(e) => {
                  const headers: Record<string, string> = {};
                  e.target.value.split("\n").forEach((line) => {
                    const idx = line.indexOf(":");
                    if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
                  });
                  setS({ ...s, customerLookupHeaders: headers });
                }}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="label">"Found" field path</label>
                <input
                  className="input font-mono text-xs"
                  placeholder="found"
                  value={s.customerFoundPath}
                  onChange={(e) => setS({ ...s, customerFoundPath: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Customer data path</label>
                <input
                  className="input font-mono text-xs"
                  placeholder="customer"
                  value={s.customerDataPath}
                  onChange={(e) => setS({ ...s, customerDataPath: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Cache (minutes)</label>
                <input
                  className="input"
                  type="number"
                  value={s.customerLookupCacheMinutes}
                  onChange={(e) => setS({ ...s, customerLookupCacheMinutes: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Expected response shape:{" "}
              <code className="bg-slate-100 px-1 rounded">
                {'{ "found": true, "customer": { "name": "...", "plan": "...", "status": "active" } }'}
              </code>
              . Everything under the data path is flattened and shown to the AI.
            </p>

            <LookupTester />
          </div>

          {/* ── Business hours ── */}
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
              <input className="input" value={s.outsideHoursMessage} onChange={(e) => setS({ ...s, outsideHoursMessage: e.target.value })} />
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

/** Fire a real lookup so you can confirm the mapping before going live. */
function LookupTester() {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ isCustomer: boolean; error?: string; fields: Record<string, string> } | null>(
    null
  );

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      setResult(
        await api<{ isCustomer: boolean; error?: string; fields: Record<string, string> }>(
          "/customer-lookup/test",
          { method: "POST", body: { phone } }
        )
      );
    } catch (e: any) {
      setResult({ isCustomer: false, error: e.message, fields: {} });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-slate-200 pt-4">
      <label className="label">Test the lookup</label>
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="919880024120"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <button type="button" className="btn-secondary shrink-0" onClick={run} disabled={!phone || busy}>
          {busy ? "Checking…" : "Run lookup"}
        </button>
      </div>
      {result && (
        <div className="mt-3 text-xs bg-slate-50 rounded-lg p-3">
          {result.error ? (
            <p className="text-red-600">{result.error}</p>
          ) : (
            <>
              <p className={result.isCustomer ? "text-emerald-700 font-medium" : "text-amber-700 font-medium"}>
                {result.isCustomer ? "Matched an existing customer" : "No match — would be treated as a lead"}
              </p>
              {Object.keys(result.fields).length > 0 && (
                <dl className="grid grid-cols-2 gap-1 mt-2">
                  {Object.entries(result.fields).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-slate-500">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </div>
      )}
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
