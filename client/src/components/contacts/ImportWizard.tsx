import { useRef, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  ClipboardPaste,
  Download,
  AlertTriangle,
  CheckCircle2,
  X,
  ArrowLeft,
  ArrowRight,
  Info,
} from "lucide-react";
import { api } from "../../lib/api";
import {
  parseSpreadsheet,
  parseText,
  guessMapping,
  buildRows,
  downloadCsv,
  downloadSampleCsv,
  TARGET_LABELS,
  type ColumnTarget,
  type ParsedSheet,
  type ImportRow,
} from "../../lib/spreadsheet";

interface ProblemRow {
  row: number;
  raw: string;
  name: string;
  status: string;
  reason?: string;
  warning?: string;
}
interface Preview {
  summary: {
    total: number;
    new: number;
    update: number;
    invalid: number;
    duplicate: number;
    corrected: number;
    warnings: number;
    scientificNotation: number;
  };
  problems: ProblemRow[];
  sample: { row: number; raw: string; name: string; waId: string; status: string; fixed?: string }[];
}
interface Result {
  batch: string;
  created: number;
  updated: number;
  skippedExisting: number;
  invalid: number;
  duplicate: number;
  problems: { row: number; raw: string; name: string; reason?: string }[];
}

const STEPS = ["Upload", "Match columns", "Review", "Done"];
const CC_KEY = "svastha_default_cc";

export default function ImportWizard({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (batch?: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnTarget[]>([]);
  const [cc, setCc] = useState(() => localStorage.getItem(CC_KEY) || "91");
  const [mode, setMode] = useState<"merge" | "skip" | "overwrite">("merge");
  const [addTags, setAddTags] = useState(`import-${new Date().toISOString().slice(0, 10)}`);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function loadSheet(s: ParsedSheet) {
    setSheet(s);
    setMapping(guessMapping(s));
    setError("");
    setStep(1);
  }

  async function onFile(file: File) {
    setBusy(true);
    setError("");
    try {
      loadSheet(await parseSpreadsheet(file));
    } catch (e: any) {
      setError(e.message || "Couldn't read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function onPaste() {
    try {
      loadSheet(await parseText(pasted));
    } catch (e: any) {
      setError(e.message);
    }
  }

  function setTarget(i: number, t: ColumnTarget) {
    setMapping((m) =>
      m.map((cur, j) => {
        if (j === i) return t;
        // Only one column can be the phone / name / email etc.
        if (t !== "attribute" && t !== "ignore" && cur === t) return "ignore";
        return cur;
      }),
    );
  }

  async function runPreview() {
    if (!sheet) return;
    if (!mapping.includes("phone")) {
      setError("Choose which column holds the phone number.");
      return;
    }
    localStorage.setItem(CC_KEY, cc);
    setBusy(true);
    setError("");
    try {
      const built = buildRows(sheet, mapping);
      setRows(built);
      const p = await api<Preview>("/contacts/import/preview", {
        method: "POST",
        body: { rows: built, defaultCountryCode: cc },
      });
      setPreview(p);
      setStep(2);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setError("");
    try {
      const r = await api<Result>("/contacts/import", {
        method: "POST",
        body: { rows, defaultCountryCode: cc, mode, addTags },
      });
      setResult(r);
      setStep(3);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function downloadProblems(list: { row: number; raw: string; name: string; reason?: string; warning?: string }[]) {
    downloadCsv(
      ["row", "phone_as_in_file", "name", "problem"],
      list.map((p) => [p.row, p.raw, p.name, p.reason || p.warning || ""]),
      "contacts-import-problems.csv",
    );
  }

  const willImport = preview
    ? preview.summary.new + (mode === "skip" ? 0 : preview.summary.update)
    : 0;

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
      <div className="card w-full max-w-4xl max-h-[92vh] flex flex-col">
        {/* Header + stepper */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Import contacts</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
              <X size={20} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <span
                  className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-semibold ${
                    i < step
                      ? "bg-brand-600 text-white"
                      : i === step
                        ? "bg-brand-100 text-brand-700 ring-2 ring-brand-500"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {i < step ? "✓" : i + 1}
                </span>
                <span className={`text-xs font-medium ${i === step ? "text-slate-800" : "text-slate-400"}`}>
                  {s}
                </span>
                {i < STEPS.length - 1 && <span className="flex-1 h-px bg-slate-200" />}
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {/* ── Step 1: upload ── */}
          {step === 0 && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) onFile(f);
                }}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400 hover:bg-slate-50"
                }`}
              >
                <FileSpreadsheet size={36} className="mx-auto text-brand-600 mb-3" />
                <p className="font-medium">{busy ? "Reading file…" : "Drop your file here, or click to browse"}</p>
                <p className="text-xs text-slate-500 mt-1">Excel (.xlsx) or CSV · up to 50,000 contacts</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.txt,.tsv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                    e.target.value = "";
                  }}
                />
              </div>

              <div className="flex items-center gap-3">
                <button className="btn-secondary text-xs" onClick={() => setPasteOpen(!pasteOpen)}>
                  <ClipboardPaste size={14} /> Paste from Excel / Google Sheets
                </button>
                <button className="btn-secondary text-xs" onClick={downloadSampleCsv}>
                  <Download size={14} /> Download template
                </button>
              </div>

              {pasteOpen && (
                <div>
                  <textarea
                    className="input font-mono text-xs"
                    rows={7}
                    placeholder={"phone\tname\n+91 98765 43210\tAsha Rao\n9812345678\tVikram Singh"}
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                  />
                  <button className="btn-primary mt-2" onClick={onPaste} disabled={!pasted.trim()}>
                    Use pasted rows
                  </button>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
                <div className="font-semibold flex items-center gap-2 mb-1">
                  <Info size={15} /> Using Excel? Upload the .xlsx file, not a CSV
                </div>
                When Excel saves a CSV it turns long numbers like 919876543210 into <code>9.19876E+11</code> and
                throws away the last digits. The .xlsx file keeps every digit. If you must use CSV, first select
                the phone column in Excel → Format Cells → Text, then re-type or re-paste the numbers.
              </div>
            </div>
          )}

          {/* ── Step 2: mapping ── */}
          {step === 1 && sheet && (
            <div className="space-y-5">
              <p className="text-sm text-slate-600">
                <span className="font-semibold">{sheet.fileName}</span> · {sheet.rows.length.toLocaleString()} rows.
                Tell us what each column contains — we've guessed where we could.
              </p>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] text-slate-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-2">Column in your file</th>
                      <th className="px-3 py-2">Example values</th>
                      <th className="px-3 py-2 w-52">Import as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.headers.map((h, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium">{h}</td>
                        <td className="px-3 py-2 text-xs text-slate-500 max-w-xs truncate">
                          {sheet.rows
                            .slice(0, 3)
                            .map((r) => r[i])
                            .filter(Boolean)
                            .join(" · ") || <span className="italic">empty</span>}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className={`input text-xs py-1.5 ${mapping[i] === "phone" ? "border-brand-500 bg-brand-50" : ""}`}
                            value={mapping[i]}
                            onChange={(e) => setTarget(i, e.target.value as ColumnTarget)}
                          >
                            {(Object.keys(TARGET_LABELS) as ColumnTarget[]).map((t) => (
                              <option key={t} value={t}>
                                {t === "attribute" ? `Custom field "${h}"` : TARGET_LABELS[t]}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Default country code</label>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">+</span>
                    <input
                      className="input w-24"
                      value={cc}
                      onChange={(e) => setCc(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Added to 10-digit numbers without a code — e.g. 9876543210 becomes +{cc || "91"} 98765 43210.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: review ── */}
          {step === 2 && preview && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Stat label="New contacts" value={preview.summary.new} tone="green" />
                <Stat label="Already exist" value={preview.summary.update} tone="blue" />
                <Stat label="Auto-corrected" value={preview.summary.corrected} tone="slate" />
                <Stat label="Duplicates in file" value={preview.summary.duplicate} tone="amber" />
                <Stat label="Can't import" value={preview.summary.invalid} tone="red" />
              </div>

              {preview.summary.scientificNotation > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
                  <div className="font-semibold flex items-center gap-2 mb-1">
                    <AlertTriangle size={16} />
                    {preview.summary.scientificNotation.toLocaleString()} numbers were damaged by Excel
                  </div>
                  They look like <code>9.19876E+11</code> — Excel stored only the first few digits, so the real
                  numbers can't be recovered from this file. We won't import them. Go back and upload the original
                  .xlsx file instead, or format the phone column as Text in Excel and save again.
                </div>
              )}

              {preview.problems.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-sm">Rows that need attention</h3>
                    <button className="btn-secondary text-xs" onClick={() => downloadProblems(preview.problems)}>
                      <Download size={13} /> Download list
                    </button>
                  </div>
                  <div className="border border-slate-200 rounded-lg max-h-56 overflow-y-auto">
                    <table className="w-full text-xs">
                      <tbody>
                        {preview.problems.slice(0, 200).map((p) => (
                          <tr key={p.row} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-1.5 text-slate-400 w-16">Row {p.row}</td>
                            <td className="px-3 py-1.5 font-mono w-40">{p.raw || "—"}</td>
                            <td className="px-3 py-1.5">{p.name}</td>
                            <td
                              className={`px-3 py-1.5 ${p.status === "invalid" ? "text-red-600" : "text-amber-700"}`}
                            >
                              {p.reason || p.warning}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {preview.sample.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm mb-2">Preview</h3>
                  <div className="border border-slate-200 rounded-lg max-h-44 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                          <th className="px-3 py-1.5">In your file</th>
                          <th className="px-3 py-1.5">Will be saved as</th>
                          <th className="px-3 py-1.5">Name</th>
                          <th className="px-3 py-1.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sample.map((s) => (
                          <tr key={s.row} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 font-mono text-slate-500">{s.raw}</td>
                            <td className="px-3 py-1.5 font-mono font-medium">+{s.waId}</td>
                            <td className="px-3 py-1.5">{s.name}</td>
                            <td className="px-3 py-1.5 text-slate-400">
                              {s.status === "update" ? "updates existing" : s.fixed || ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {preview.summary.update > 0 && (
                  <div>
                    <label className="label">
                      For the {preview.summary.update.toLocaleString()} contacts that already exist
                    </label>
                    <div className="space-y-1.5 text-sm">
                      {(
                        [
                          ["merge", "Merge — fill in new details, add tags, keep existing info"],
                          ["skip", "Skip — leave existing contacts untouched"],
                          ["overwrite", "Overwrite — replace name, email and tags with the file"],
                        ] as const
                      ).map(([v, label]) => (
                        <label key={v} className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="radio"
                            className="mt-1 accent-emerald-600"
                            checked={mode === v}
                            onChange={() => setMode(v)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="label">Tag every imported contact with</label>
                  <input className="input" value={addTags} onChange={(e) => setAddTags(e.target.value)} />
                  <p className="text-xs text-slate-500 mt-1">
                    Comma-separated. Handy for sending a broadcast to just this list later.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: done ── */}
          {step === 3 && result && (
            <div className="text-center py-6 space-y-4">
              <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
              <h3 className="text-xl font-bold">Import complete</h3>
              <div className="flex justify-center gap-8 text-sm">
                <div>
                  <div className="text-2xl font-bold text-emerald-600">{result.created.toLocaleString()}</div>
                  added
                </div>
                <div>
                  <div className="text-2xl font-bold text-sky-600">{result.updated.toLocaleString()}</div>
                  updated
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-400">
                    {(result.invalid + result.duplicate + result.skippedExisting).toLocaleString()}
                  </div>
                  skipped
                </div>
              </div>
              {result.problems.length > 0 && (
                <button className="btn-secondary mx-auto" onClick={() => downloadProblems(result.problems)}>
                  <Download size={14} /> Download {result.problems.length.toLocaleString()} skipped rows to fix
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <div>
            {step > 0 && step < 3 && (
              <button className="btn-secondary" onClick={() => setStep(step - 1)} disabled={busy}>
                <ArrowLeft size={15} /> Back
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {step === 1 && (
              <button className="btn-primary" onClick={runPreview} disabled={busy}>
                {busy ? "Checking numbers…" : "Check numbers"} <ArrowRight size={15} />
              </button>
            )}
            {step === 2 && (
              <button className="btn-primary" onClick={runImport} disabled={busy || willImport === 0}>
                <Upload size={15} />
                {busy ? "Importing…" : `Import ${willImport.toLocaleString()} contacts`}
              </button>
            )}
            {step === 3 && (
              <>
                <button className="btn-secondary" onClick={() => onDone()}>
                  Close
                </button>
                <button className="btn-primary" onClick={() => onDone(result?.batch)}>
                  View imported contacts
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  const colors: Record<string, string> = {
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-sky-50 text-sky-700",
    slate: "bg-slate-50 text-slate-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
  };
  return (
    <div className={`rounded-lg p-3 ${colors[tone]}`}>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}
