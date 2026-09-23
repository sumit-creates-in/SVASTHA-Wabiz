import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Users,
  MessageSquare,
  Rocket,
  AlertTriangle,
  CheckCircle2,
  Send,
  Save,
  X,
  Info,
  Clock,
  Gauge,
  Target,
} from "lucide-react";
import { api } from "../lib/api";
import {
  parseTemplate,
  defaultVariables,
  sampleValue,
  fill,
  SOURCE_LABELS,
} from "../lib/templates";
import WhatsAppPreview from "../components/broadcasts/WhatsAppPreview";
import type {
  AudienceEstimate,
  Broadcast,
  BroadcastAudience,
  BroadcastVariable,
  Contact,
  Template,
  WabaNumber,
} from "../types";

const EMPTY_AUDIENCE: BroadcastAudience = {
  includeTags: [],
  tagMatch: "any",
  excludeTags: [],
  contactType: "",
  activeWithinDays: 0,
  skipRecentlyBroadcastDays: 3,
  contactIds: [],
  retargetStatuses: [],
};

const RETARGET_OPTIONS = [
  { key: "notRead", label: "Didn't open it", statuses: ["sent", "delivered"] },
  { key: "readNoReply", label: "Opened but didn't reply", statuses: ["read"] },
  { key: "replied", label: "Replied", statuses: ["replied"] },
  { key: "failed", label: "Failed to receive it", statuses: ["failed"] },
];

const SPEEDS = [
  { key: "safe", label: "Gentle", detail: "~30 per minute. Best for new numbers or a first send to an old list." },
  { key: "normal", label: "Standard", detail: "~90 per minute. Good default for most campaigns." },
  { key: "fast", label: "Fast", detail: "Up to ~240 per minute, if your messaging tier allows it." },
] as const;

const STEPS = [
  { label: "Audience", icon: Users },
  { label: "Message", icon: MessageSquare },
  { label: "Review & send", icon: Rocket },
];

interface Draft {
  name: string;
  description: string;
  number: string;
  templateName: string;
  templateLanguage: string;
  templateCategory: string;
  bodyVariables: BroadcastVariable[];
  headerVariables: BroadcastVariable[];
  buttonVariable?: BroadcastVariable;
  headerMedia: { type: "image" | "video" | "document"; link: string; filename?: string };
  audience: BroadcastAudience;
  speed: "safe" | "normal" | "fast";
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BroadcastBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const [step, setStep] = useState(0);
  const [savedId, setSavedId] = useState<string | undefined>(id);
  const [draft, setDraft] = useState<Draft>({
    name: "",
    description: "",
    number: "",
    templateName: "",
    templateLanguage: "en",
    templateCategory: "",
    bodyVariables: [],
    headerVariables: [],
    headerMedia: { type: "image", link: "" },
    // Arriving from the Contacts page with a selection or a tag filter.
    audience: {
      ...EMPTY_AUDIENCE,
      contactIds: query.get("contacts")?.split(",").filter(Boolean) || [],
      includeTags: query.get("tag") ? [query.get("tag")!] : [],
    },
    speed: "normal",
  });

  const [templates, setTemplates] = useState<Template[]>([]);
  const [numbers, setNumbers] = useState<WabaNumber[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [pastCampaigns, setPastCampaigns] = useState<Broadcast[]>([]);
  const [samples, setSamples] = useState<Contact[]>([]);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [estimate, setEstimate] = useState<AudienceEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  const [when, setWhen] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(new Date(Date.now() + 3600000)));
  const [testPhone, setTestPhone] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(!id);

  // ── Load reference data (and the draft when editing) ──
  useEffect(() => {
    api<Template[]>("/templates").then((t) => setTemplates(t.filter((x) => x.status === "APPROVED"))).catch(() => {});
    api<WabaNumber[]>("/numbers").then(setNumbers).catch(() => {});
    api<{ tag: string; count: number }[]>("/contacts/tags").then(setTags).catch(() => {});
    api<{ items: Broadcast[] }>("/broadcasts")
      .then((r) => setPastCampaigns(r.items.filter((b) => b.stats?.sent > 0)))
      .catch(() => {});
    api<{ items: Contact[] }>("/contacts?limit=25&sort=lastSeenAt&status=active")
      .then((r) => setSamples(r.items.filter((c) => c.name)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    api<{ broadcast: Broadcast }>(`/broadcasts/${id}`)
      .then(({ broadcast: b }) => {
        if (!["draft", "scheduled"].includes(b.status)) {
          navigate(`/broadcasts/${id}`, { replace: true });
          return;
        }
        const aud = b.audience || EMPTY_AUDIENCE;
        setDraft({
          name: b.name,
          description: b.description || "",
          number: typeof b.number === "object" ? b.number?._id || "" : b.number || "",
          templateName: b.templateName,
          templateLanguage: b.templateLanguage,
          templateCategory: b.templateCategory || "",
          bodyVariables: b.bodyVariables?.length
            ? b.bodyVariables
            : (b.bodyParams || []).map((p) => ({ source: "static" as const, value: p, fallback: "" })),
          headerVariables: b.headerVariables || [],
          buttonVariable: b.buttonVariable,
          headerMedia: b.headerMedia || { type: "image", link: "" },
          audience: {
            ...EMPTY_AUDIENCE,
            ...aud,
            includeTags: aud.includeTags?.length ? aud.includeTags : b.audienceTags || [],
            retargetBroadcast:
              typeof aud.retargetBroadcast === "object" ? aud.retargetBroadcast?._id : aud.retargetBroadcast,
          },
          speed: b.speed || "normal",
        });
        if (b.scheduledAt) {
          setWhen("later");
          setScheduledAt(toLocalInput(new Date(b.scheduledAt)));
        }
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [id, navigate]);

  // ── Live audience estimate ──
  useEffect(() => {
    if (!loaded) return;
    setEstimating(true);
    const t = setTimeout(() => {
      api<AudienceEstimate>("/broadcasts/estimate", {
        method: "POST",
        body: { audience: draft.audience, number: draft.number || undefined },
      })
        .then(setEstimate)
        .catch(() => {})
        .finally(() => setEstimating(false));
    }, 400);
    return () => clearTimeout(t);
  }, [draft.audience, draft.number, loaded]);

  const template = useMemo(
    () =>
      templates.find((t) => t.name === draft.templateName && t.language === draft.templateLanguage) ||
      templates.find((t) => t.name === draft.templateName) ||
      null,
    [templates, draft.templateName, draft.templateLanguage],
  );
  const parsed = useMemo(() => (template ? parseTemplate(template) : null), [template]);

  const attributeKeys = useMemo(() => {
    const keys = new Set<string>();
    samples.forEach((c) => Object.keys(c.attributes || {}).forEach((k) => keys.add(k)));
    return Array.from(keys).sort();
  }, [samples]);

  const sample = samples[sampleIdx] || { name: "Asha Rao", waId: "919876543210", attributes: {} };
  const bodyValues = draft.bodyVariables.map((v) => sampleValue(v, sample));
  const headerValues = draft.headerVariables.map((v) => sampleValue(v, sample));
  const previewBody = parsed ? fill(parsed.body, bodyValues) : "";
  const previewHeader = parsed ? fill(parsed.headerText, headerValues) : "";
  const businessName =
    numbers.find((n) => n._id === draft.number)?.verifiedName || numbers[0]?.verifiedName || "SVASTHA";

  function set<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }
  function setAud<K extends keyof BroadcastAudience>(k: K, v: BroadcastAudience[K]) {
    setDraft((d) => ({ ...d, audience: { ...d.audience, [k]: v } }));
  }

  function chooseTemplate(key: string) {
    const [name, language] = key.split("|");
    const t = templates.find((x) => x.name === name && x.language === language);
    const p = parseTemplate(t);
    setDraft((d) => ({
      ...d,
      templateName: name,
      templateLanguage: language,
      templateCategory: t?.category || "",
      bodyVariables: defaultVariables(p.bodyVarCount),
      headerVariables: Array.from({ length: p.headerVarCount }, () => ({ source: "static" as const, value: "", fallback: "" })),
      buttonVariable: p.hasDynamicUrlButton ? { source: "static", value: "", fallback: "" } : undefined,
      headerMedia: {
        type: p.headerFormat === "VIDEO" ? "video" : p.headerFormat === "DOCUMENT" ? "document" : "image",
        link: p.sampleHeaderUrl || "",
      },
    }));
  }

  // ── Validation per step ──
  const audienceProblem = estimate && estimate.total === 0 ? "Nobody matches this audience yet." : "";
  const messageProblem = (() => {
    if (!draft.templateName) return "Choose a template.";
    const bad = draft.bodyVariables.findIndex((v) => (v.source === "static" ? !v.value.trim() : !v.fallback.trim()));
    if (bad >= 0)
      return draft.bodyVariables[bad].source === "static"
        ? `Fill in the text for {{${bad + 1}}}.`
        : `Add a fallback for {{${bad + 1}}} — used when a contact is missing that detail.`;
    if (parsed && !["NONE", "TEXT"].includes(parsed.headerFormat) && !draft.headerMedia.link.trim())
      return `This template needs a ${parsed.headerFormat.toLowerCase()} — paste a public link to it.`;
    if (draft.buttonVariable && !draft.buttonVariable.value.trim() && draft.buttonVariable.source === "static")
      return "Fill in the link ending for the button.";
    return "";
  })();

  function payload() {
    const needsMedia = parsed && !["NONE", "TEXT"].includes(parsed.headerFormat);
    return {
      ...draft,
      name: draft.name.trim() || `${draft.templateName || "Campaign"} — ${new Date().toLocaleDateString()}`,
      number: draft.number || undefined,
      headerMedia: needsMedia ? draft.headerMedia : undefined,
      audience: { ...draft.audience, retargetBroadcast: draft.audience.retargetBroadcast || undefined },
      scheduledAt: when === "later" ? new Date(scheduledAt).toISOString() : undefined,
    };
  }

  async function save(): Promise<string | undefined> {
    setError("");
    try {
      if (savedId) {
        await api(`/broadcasts/${savedId}`, { method: "PATCH", body: payload() });
        return savedId;
      }
      const b = await api<Broadcast>("/broadcasts", { method: "POST", body: payload() });
      setSavedId(b._id);
      return b._id;
    } catch (e: any) {
      setError(e.message);
      return undefined;
    }
  }

  async function saveDraft() {
    setBusy(true);
    const idSaved = await save();
    setBusy(false);
    if (idSaved) navigate("/broadcasts");
  }

  async function launch() {
    const count = estimate?.total || 0;
    const msg =
      when === "later"
        ? `Schedule this campaign for ${new Date(scheduledAt).toLocaleString()}?`
        : `Send "${draft.templateName}" to ${count.toLocaleString()} people now?`;
    if (!confirm(msg)) return;
    setBusy(true);
    const idSaved = await save();
    if (!idSaved) {
      setBusy(false);
      return;
    }
    try {
      await api(`/broadcasts/${idSaved}/launch`, {
        method: "POST",
        body: { scheduledAt: when === "later" ? new Date(scheduledAt).toISOString() : undefined },
      });
      navigate(`/broadcasts/${idSaved}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTestMsg("");
    try {
      const r = await api<{ sentTo: string }>("/broadcasts/test", {
        method: "POST",
        body: { ...payload(), phone: testPhone, defaultCountryCode: localStorage.getItem("svastha_default_cc") || "91" },
      });
      setTestMsg(`✓ Test sent to ${r.sentTo} — check the phone.`);
    } catch (e: any) {
      setTestMsg(`✗ ${e.message}`);
    }
  }

  if (!loaded) return <div className="p-8 text-sm text-slate-400">{error || "Loading…"}</div>;

  const canNext = step === 0 ? !audienceProblem : step === 1 ? !messageProblem : true;

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="border-b border-slate-200 bg-white px-8 py-4 flex items-center gap-4">
        <button className="text-slate-400 hover:text-slate-700" onClick={() => navigate("/broadcasts")}>
          <X size={20} />
        </button>
        <input
          className="text-lg font-bold bg-transparent outline-none flex-1 min-w-0 placeholder:text-slate-300"
          placeholder="Name this campaign, e.g. 21-Day Challenge — October batch"
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
        />
        <div className="hidden md:flex items-center gap-1">
          {STEPS.map((s, i) => (
            <button
              key={s.label}
              onClick={() => (i < step || canNext) && setStep(i)}
              className={`flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1.5 ${
                i === step ? "bg-brand-100 text-brand-700" : i < step ? "text-brand-700" : "text-slate-400"
              }`}
            >
              {i < step ? <CheckCircle2 size={14} /> : <s.icon size={14} />} {s.label}
            </button>
          ))}
        </div>
        <button className="btn-secondary" onClick={saveDraft} disabled={busy}>
          <Save size={15} /> Save draft
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* Form */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-2xl space-y-6">
            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}

            {/* ── Step 1: Audience ── */}
            {step === 0 && (
              <>
                {draft.audience.contactIds.length > 0 && (
                  <div className="card p-4 flex items-center justify-between gap-3 border-brand-300 bg-brand-50">
                    <span className="text-sm">
                      <strong>{draft.audience.contactIds.length.toLocaleString()} contacts</strong> you selected on the
                      Contacts page. The filters below narrow this list further.
                    </span>
                    <button className="btn-secondary text-xs" onClick={() => setAud("contactIds", [])}>
                      <X size={13} /> Clear selection
                    </button>
                  </div>
                )}
                <Section title="Who should receive this?" icon={<Users size={16} />}>
                  <div>
                    <label className="label">Contacts tagged with</label>
                    <TagPicker all={tags} value={draft.audience.includeTags} onChange={(v) => setAud("includeTags", v)} placeholder="Any tag — leave empty for everyone" />
                    {draft.audience.includeTags.length > 1 && (
                      <div className="flex gap-3 mt-2 text-sm">
                        {(["any", "all"] as const).map((m) => (
                          <label key={m} className="flex items-center gap-1.5 cursor-pointer">
                            <input type="radio" className="accent-emerald-600" checked={draft.audience.tagMatch === m} onChange={() => setAud("tagMatch", m)} />
                            {m === "any" ? "Any of these tags" : "All of these tags"}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="label">But not tagged with</label>
                    <TagPicker all={tags} value={draft.audience.excludeTags} onChange={(v) => setAud("excludeTags", v)} placeholder="e.g. customer, do-not-disturb" />
                  </div>
                  <div>
                    <label className="label">Contact type</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        ["", "Everyone"],
                        ["lead", "Leads only"],
                        ["customer", "Customers only"],
                        ["fromAd", "Came from an ad"],
                      ].map(([k, l]) => (
                        <Chip key={k} active={draft.audience.contactType === k} onClick={() => setAud("contactType", k as any)}>
                          {l}
                        </Chip>
                      ))}
                    </div>
                  </div>
                </Section>

                <Section title="Engagement filters" icon={<Target size={16} />}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Only people who messaged us in the last</label>
                      <select className="input" value={draft.audience.activeWithinDays} onChange={(e) => setAud("activeWithinDays", Number(e.target.value))}>
                        <option value={0}>Any time (no limit)</option>
                        <option value={1}>24 hours</option>
                        <option value={7}>7 days</option>
                        <option value={30}>30 days</option>
                        <option value={90}>90 days</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Skip people who got a broadcast in the last</label>
                      <select
                        className="input"
                        value={draft.audience.skipRecentlyBroadcastDays}
                        onChange={(e) => setAud("skipRecentlyBroadcastDays", Number(e.target.value))}
                      >
                        <option value={0}>Don't skip anyone</option>
                        <option value={1}>1 day</option>
                        <option value={3}>3 days (recommended)</option>
                        <option value={7}>7 days</option>
                        <option value={14}>14 days</option>
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 flex gap-1.5">
                    <Info size={13} className="shrink-0 mt-0.5" />
                    Messaging the same people too often is the main reason numbers get blocked and downgraded.
                  </p>
                </Section>

                <Section title="Follow up on an earlier campaign (optional)" icon={<Send size={16} />}>
                  <select
                    className="input"
                    value={(draft.audience.retargetBroadcast as string) || ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        audience: {
                          ...d.audience,
                          retargetBroadcast: e.target.value || undefined,
                          retargetStatuses: e.target.value ? d.audience.retargetStatuses.length ? d.audience.retargetStatuses : ["sent", "delivered"] : [],
                        },
                      }))
                    }
                  >
                    <option value="">No — not a follow-up</option>
                    {pastCampaigns.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name} ({c.stats.sent.toLocaleString()} sent)
                      </option>
                    ))}
                  </select>
                  {draft.audience.retargetBroadcast && (
                    <div className="flex flex-wrap gap-2">
                      {RETARGET_OPTIONS.map((o) => {
                        const on = o.statuses.every((s) => draft.audience.retargetStatuses.includes(s));
                        return (
                          <Chip
                            key={o.key}
                            active={on}
                            onClick={() =>
                              setAud(
                                "retargetStatuses",
                                on
                                  ? draft.audience.retargetStatuses.filter((s) => !o.statuses.includes(s))
                                  : Array.from(new Set([...draft.audience.retargetStatuses, ...o.statuses])),
                              )
                            }
                          >
                            {o.label}
                          </Chip>
                        );
                      })}
                    </div>
                  )}
                </Section>
              </>
            )}

            {/* ── Step 2: Message ── */}
            {step === 1 && (
              <>
                <Section title="Template" icon={<MessageSquare size={16} />}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Send from</label>
                      <select className="input" value={draft.number} onChange={(e) => set("number", e.target.value)}>
                        <option value="">First active number</option>
                        {numbers.map((n) => (
                          <option key={n._id} value={n._id}>
                            {n.label} · {n.displayPhoneNumber}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Approved template</label>
                      <select
                        className="input"
                        value={draft.templateName ? `${draft.templateName}|${draft.templateLanguage}` : ""}
                        onChange={(e) => e.target.value && chooseTemplate(e.target.value)}
                      >
                        <option value="">Choose a template…</option>
                        {templates.map((t) => (
                          <option key={t._id} value={`${t.name}|${t.language}`}>
                            {t.name} · {t.language} · {t.category.toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {!templates.length && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                      No approved templates yet. Go to Templates → Sync from Meta.
                    </p>
                  )}
                  {template?.category === "MARKETING" && (
                    <p className="text-xs text-slate-500">
                      Marketing templates are charged per delivered message by Meta and count towards each contact's
                      daily marketing limit.
                    </p>
                  )}
                </Section>

                {parsed && !["NONE", "TEXT"].includes(parsed.headerFormat) && (
                  <Section title={`Header ${parsed.headerFormat.toLowerCase()}`} icon={<Info size={16} />}>
                    <input
                      className="input font-mono text-xs"
                      placeholder={`https://… public link to the ${parsed.headerFormat.toLowerCase()}`}
                      value={draft.headerMedia.link}
                      onChange={(e) => set("headerMedia", { ...draft.headerMedia, link: e.target.value })}
                    />
                    {parsed.headerFormat === "DOCUMENT" && (
                      <input
                        className="input text-sm"
                        placeholder="File name shown to the customer, e.g. 21-Day-Plan.pdf"
                        value={draft.headerMedia.filename || ""}
                        onChange={(e) => set("headerMedia", { ...draft.headerMedia, filename: e.target.value })}
                      />
                    )}
                    <p className="text-xs text-slate-500">The link must be publicly reachable — Meta downloads it once per send.</p>
                  </Section>
                )}

                {(draft.headerVariables.length > 0 || draft.bodyVariables.length > 0 || draft.buttonVariable) && (
                  <Section title="Personalise the message" icon={<Users size={16} />}>
                    {draft.headerVariables.map((v, i) => (
                      <VariableRow
                        key={`h${i}`}
                        label={`Header {{${i + 1}}}`}
                        v={v}
                        attributeKeys={attributeKeys}
                        onChange={(nv) => set("headerVariables", draft.headerVariables.map((x, j) => (j === i ? nv : x)))}
                      />
                    ))}
                    {draft.bodyVariables.map((v, i) => (
                      <VariableRow
                        key={`b${i}`}
                        label={`{{${i + 1}}}`}
                        v={v}
                        attributeKeys={attributeKeys}
                        onChange={(nv) => set("bodyVariables", draft.bodyVariables.map((x, j) => (j === i ? nv : x)))}
                      />
                    ))}
                    {draft.buttonVariable && (
                      <VariableRow
                        label="Button link ending"
                        v={draft.buttonVariable}
                        attributeKeys={attributeKeys}
                        onChange={(nv) => set("buttonVariable", nv)}
                      />
                    )}
                  </Section>
                )}

                <Section title="Send yourself a test" icon={<Send size={16} />}>
                  <div className="flex gap-2">
                    <input className="input" placeholder="Your WhatsApp number" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
                    <button className="btn-secondary shrink-0" onClick={sendTest} disabled={!testPhone || !draft.templateName || !!messageProblem}>
                      <Send size={14} /> Send test
                    </button>
                  </div>
                  {testMsg && <p className={`text-sm ${testMsg.startsWith("✓") ? "text-emerald-700" : "text-red-600"}`}>{testMsg}</p>}
                  <p className="text-xs text-slate-500">Always worth doing — it's the only way to see exactly how media and buttons render.</p>
                </Section>
              </>
            )}

            {/* ── Step 3: Review ── */}
            {step === 2 && (
              <>
                <Section title="When to send" icon={<Clock size={16} />}>
                  <div className="flex gap-2">
                    <Chip active={when === "now"} onClick={() => setWhen("now")}>
                      Send now
                    </Chip>
                    <Chip active={when === "later"} onClick={() => setWhen("later")}>
                      Schedule for later
                    </Chip>
                  </div>
                  {when === "later" && (
                    <div>
                      <input type="datetime-local" className="input w-auto" value={scheduledAt} min={toLocalInput(new Date())} onChange={(e) => setScheduledAt(e.target.value)} />
                      <p className="text-xs text-slate-500 mt-1">Your local time. Late morning and early evening usually get the best read rates.</p>
                    </div>
                  )}
                </Section>

                <Section title="Sending speed" icon={<Gauge size={16} />}>
                  <div className="space-y-2">
                    {SPEEDS.map((s) => (
                      <label key={s.key} className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer ${draft.speed === s.key ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
                        <input type="radio" className="mt-1 accent-emerald-600" checked={draft.speed === s.key} onChange={() => set("speed", s.key)} />
                        <span>
                          <span className="font-medium text-sm">{s.label}</span>
                          <span className="block text-xs text-slate-500">{s.detail}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </Section>

                <Section title="Summary" icon={<CheckCircle2 size={16} />}>
                  <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                    <dt className="text-slate-500">Recipients</dt>
                    <dd className="font-semibold">{estimate ? estimate.total.toLocaleString() : "…"} people</dd>
                    <dt className="text-slate-500">Template</dt>
                    <dd>{draft.templateName || "—"}</dd>
                    <dt className="text-slate-500">From</dt>
                    <dd>{numbers.find((n) => n._id === draft.number)?.label || numbers[0]?.label || "—"}</dd>
                    <dt className="text-slate-500">Audience</dt>
                    <dd className="text-slate-700">{describeAudience(draft.audience, pastCampaigns)}</dd>
                    <dt className="text-slate-500">Estimated time</dt>
                    <dd>{estimate ? estimateDuration(estimate.total, draft.speed) : "—"}</dd>
                  </dl>
                  <div>
                    <label className="label">Internal notes (optional)</label>
                    <textarea className="input text-sm" rows={2} placeholder="What's this campaign for?" value={draft.description} onChange={(e) => set("description", e.target.value)} />
                  </div>
                </Section>
              </>
            )}
          </div>
        </div>

        {/* Right rail: audience + preview */}
        <aside className="w-[360px] shrink-0 border-l border-slate-200 bg-slate-50 overflow-y-auto p-6 space-y-5 hidden lg:block">
          <div className="card p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Will be sent to</div>
            <div className={`text-3xl font-bold ${estimating ? "opacity-40" : ""}`}>
              {estimate ? estimate.total.toLocaleString() : "…"}
              <span className="text-sm font-normal text-slate-500 ml-1">people</span>
            </div>
            {estimate && (estimate.excludedOptedOut > 0 || estimate.excludedInvalid > 0 || estimate.excludedRecent > 0) && (
              <div className="text-xs text-slate-500 mt-2 space-y-0.5">
                {estimate.excludedOptedOut > 0 && <div>− {estimate.excludedOptedOut.toLocaleString()} opted out</div>}
                {estimate.excludedRecent > 0 && <div>− {estimate.excludedRecent.toLocaleString()} messaged recently</div>}
                {estimate.excludedInvalid > 0 && <div>− {estimate.excludedInvalid.toLocaleString()} invalid numbers</div>}
              </div>
            )}
            {estimate?.warnings.map((w, i) => (
              <div key={i} className="mt-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 flex gap-1.5">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {w}
              </div>
            ))}
          </div>

          <div>
            <WhatsAppPreview
              parsed={parsed}
              headerText={previewHeader}
              body={previewBody}
              mediaUrl={draft.headerMedia.link}
              businessName={businessName}
              contactName={parsed ? sample.name : undefined}
            />
            {parsed && samples.length > 1 && (
              <div className="flex items-center justify-center gap-2 mt-3 text-xs text-slate-500">
                Preview as
                <select className="input w-auto text-xs py-1" value={sampleIdx} onChange={(e) => setSampleIdx(Number(e.target.value))}>
                  {samples.slice(0, 15).map((c, i) => (
                    <option key={c._id} value={i}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Footer nav */}
      <div className="border-t border-slate-200 bg-white px-8 py-3 flex items-center justify-between">
        <div>
          {step > 0 && (
            <button className="btn-secondary" onClick={() => setStep(step - 1)}>
              <ArrowLeft size={15} /> Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {(step === 0 ? audienceProblem : step === 1 ? messageProblem : "") && (
            <span className="text-xs text-amber-700">{step === 0 ? audienceProblem : messageProblem}</span>
          )}
          {step < 2 ? (
            <button className="btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
              Continue <ArrowRight size={15} />
            </button>
          ) : (
            <button className="btn-primary" onClick={launch} disabled={busy || !estimate?.total || !!messageProblem}>
              <Rocket size={15} />
              {busy ? "Working…" : when === "later" ? "Schedule campaign" : `Send to ${estimate?.total.toLocaleString() || 0} people`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers & small components ──────────────────────────

function estimateDuration(total: number, speed: string): string {
  const perMin = speed === "safe" ? 30 : speed === "fast" ? 240 : 90;
  const mins = Math.ceil(total / perMin);
  if (mins < 2) return "About a minute";
  if (mins < 60) return `About ${mins} minutes`;
  return `About ${(mins / 60).toFixed(1)} hours`;
}

function describeAudience(a: BroadcastAudience, past: Broadcast[]): string {
  const parts: string[] = [];
  if (a.retargetBroadcast) {
    const name = past.find((p) => p._id === a.retargetBroadcast)?.name || "an earlier campaign";
    const what = RETARGET_OPTIONS.filter((o) => o.statuses.every((s) => a.retargetStatuses.includes(s))).map((o) => o.label.toLowerCase());
    parts.push(`people from "${name}" who ${what.join(" or ") || "received it"}`);
  }
  if (a.includeTags.length) parts.push(`tagged ${a.includeTags.join(a.tagMatch === "all" ? " and " : " or ")}`);
  if (a.excludeTags.length) parts.push(`not tagged ${a.excludeTags.join(", ")}`);
  if (a.contactType) parts.push({ lead: "leads only", customer: "customers only", fromAd: "from ads" }[a.contactType]);
  if (a.activeWithinDays) parts.push(`active in the last ${a.activeWithinDays} days`);
  if (a.skipRecentlyBroadcastDays) parts.push(`skipping anyone messaged in the last ${a.skipRecentlyBroadcastDays} days`);
  return parts.length ? parts.join("; ") : "All contacts who haven't opted out";
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-5 space-y-4">
      <h3 className="font-semibold text-sm flex items-center gap-2 text-slate-700">
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm rounded-full px-3.5 py-1.5 border transition-colors ${
        active ? "bg-brand-600 border-brand-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function TagPicker({
  all,
  value,
  onChange,
  placeholder,
}: {
  all: { tag: string; count: number }[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const options = all.filter((t) => !value.includes(t.tag) && t.tag.toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  return (
    <div className="relative">
      <div className="input flex flex-wrap gap-1.5 items-center min-h-[42px] cursor-text" onClick={() => setOpen(true)}>
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 bg-brand-100 text-brand-700 text-xs rounded-full px-2.5 py-1">
            {t}
            <button type="button" onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== t)); }}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[120px] outline-none text-sm bg-transparent"
          placeholder={value.length ? "" : placeholder}
          value={q}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {open && options.length > 0 && (
        <div className="absolute z-20 mt-1 w-full card p-1 max-h-56 overflow-y-auto shadow-lg">
          {options.map((t) => (
            <button
              type="button"
              key={t.tag}
              className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-slate-50 flex justify-between"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange([...value, t.tag]);
                setQ("");
              }}
            >
              {t.tag} <span className="text-xs text-slate-400">{t.count.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VariableRow({
  label,
  v,
  attributeKeys,
  onChange,
}: {
  label: string;
  v: BroadcastVariable;
  attributeKeys: string[];
  onChange: (v: BroadcastVariable) => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-2 items-start">
      <div className="col-span-2 pt-2 text-sm font-mono text-slate-600">{label}</div>
      <select className="input col-span-4 text-sm" value={v.source} onChange={(e) => onChange({ ...v, source: e.target.value as any, value: "" })}>
        {(Object.keys(SOURCE_LABELS) as BroadcastVariable["source"][])
          .filter((s) => s !== "attribute" || attributeKeys.length)
          .map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
      </select>
      {v.source === "static" ? (
        <input className="input col-span-6 text-sm" placeholder="Text to insert" value={v.value} onChange={(e) => onChange({ ...v, value: e.target.value })} />
      ) : (
        <div className="col-span-6 flex gap-2">
          {v.source === "attribute" && (
            <select className="input text-sm" value={v.value} onChange={(e) => onChange({ ...v, value: e.target.value })}>
              <option value="">Field…</option>
              {attributeKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          )}
          <input
            className={`input text-sm ${!v.fallback.trim() ? "border-amber-300" : ""}`}
            placeholder="If missing, use…"
            value={v.fallback}
            onChange={(e) => onChange({ ...v, fallback: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
