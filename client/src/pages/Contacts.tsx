import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  Upload,
  Download,
  Search,
  Tag,
  Trash2,
  Ban,
  UserCheck,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowUpDown,
  X,
  Users,
  Megaphone,
  CheckCircle2,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { downloadFromApi, downloadXlsx, formatPhone, isValidWaId } from "../lib/spreadsheet";
const ImportWizard = lazy(() => import("../components/contacts/ImportWizard"));
import ContactDrawer from "../components/contacts/ContactDrawer";
import TagManager from "../components/contacts/TagManager";
import type { Contact } from "../types";

interface ListResponse {
  items: Contact[];
  total: number;
  page: number;
  pages: number;
  limit: number;
}
interface Stats {
  total: number;
  optedOut: number;
  customers: number;
  leads: number;
  fromAd: number;
  invalid: number;
}

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "lead", label: "Leads" },
  { key: "customer", label: "Customers" },
  { key: "fromAd", label: "From ads" },
  { key: "optedOut", label: "Opted out" },
  { key: "invalid", label: "Invalid numbers" },
];

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  import: "Import",
  manual: "Added manually",
  workflow: "Workflow",
};

export default function Contacts() {
  const { can } = useAuth();
  const canEdit = can("contacts.edit");
  const canExport = can("contacts.export");
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const canBroadcast = can("broadcasts.send");

  const [data, setData] = useState<ListResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState(params.get("status") || "");
  const [tag, setTag] = useState(params.get("tag") || "");
  const [batch, setBatch] = useState(params.get("batch") || "");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [sort, setSort] = useState("createdAt");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [bulkTagMode, setBulkTagMode] = useState<"addTags" | "removeTags" | null>(null);
  const [bulkTagValue, setBulkTagValue] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set("search", debounced);
    if (status) p.set("status", status);
    if (tag) p.set("tag", tag);
    if (batch) p.set("batch", batch);
    return p;
  }, [debounced, status, tag, batch]);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams(filterParams);
    p.set("page", String(page));
    p.set("limit", String(limit));
    p.set("sort", sort);
    p.set("dir", dir);
    try {
      setData(await api<ListResponse>(`/contacts?${p}`));
    } finally {
      setLoading(false);
    }
  }, [filterParams, page, limit, sort, dir]);

  const loadMeta = useCallback(async () => {
    api<Stats>("/contacts/stats").then(setStats).catch(() => {});
    api<{ tag: string; count: number }[]>("/contacts/tags").then(setTags).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  // Changing any filter resets paging and selection.
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
    setAllMatching(false);
  }, [filterParams, limit]);

  function refreshAll() {
    load();
    loadMeta();
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  function toggleSort(field: string) {
    if (sort === field) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(field);
      setDir(field === "name" ? "asc" : "desc");
    }
  }

  const items = data?.items || [];
  const pageIds = items.map((c) => c._id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectionCount = allMatching ? data?.total || 0 : selected.size;

  function togglePage() {
    const next = new Set(selected);
    if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    setSelected(next);
    setAllMatching(false);
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
    setAllMatching(false);
  }

  function clearSelection() {
    setSelected(new Set());
    setAllMatching(false);
  }

  function bulkBody(action: string, extra: Record<string, unknown> = {}) {
    return allMatching
      ? { action, allMatching: true, filter: Object.fromEntries(filterParams), ...extra }
      : { action, filter: { ids: Array.from(selected) }, ...extra };
  }

  async function runBulk(action: string, extra: Record<string, unknown> = {}, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    try {
      const r = await api<{ affected: number }>("/contacts/bulk", { method: "POST", body: bulkBody(action, extra) });
      flash(`Done — ${r.affected.toLocaleString()} contact${r.affected === 1 ? "" : "s"} updated.`);
      clearSelection();
      setBulkTagMode(null);
      setBulkTagValue("");
      refreshAll();
    } catch (e: any) {
      flash(e.message);
    }
  }

  async function exportAs(format: "csv" | "xlsx") {
    setExportOpen(false);
    const p = new URLSearchParams(filterParams);
    if (!allMatching && selected.size) p.set("ids", Array.from(selected).join(","));
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      if (format === "csv") {
        await downloadFromApi(`/contacts/export?${p}`, `contacts-${stamp}.csv`);
      } else {
        p.set("format", "json");
        const { header, rows } = await api<{ header: string[]; rows: string[][] }>(`/contacts/export?${p}`);
        await downloadXlsx(header, rows, `contacts-${stamp}.xlsx`);
      }
    } catch (e: any) {
      flash(e.message);
    }
  }

  const exportScope = selectionCount ? `${selectionCount.toLocaleString()} selected` : `${(data?.total || 0).toLocaleString()} shown`;
  const anyFilter = !!(debounced || status || tag || batch);

  return (
    <div className="h-full overflow-y-auto p-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Contacts</h1>
          <p className="text-sm text-slate-500">
            {stats ? `${stats.total.toLocaleString()} contacts` : "…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <button className="btn-secondary" onClick={() => setShowTags(true)}>
              <Tag size={15} /> Tags
            </button>
          )}
          {canExport && (
            <div className="relative">
              <button className="btn-secondary" onClick={() => setExportOpen(!exportOpen)}>
                <Download size={15} /> Export <ChevronDown size={14} />
              </button>
              {exportOpen && (
                <div className="absolute right-0 mt-1 w-64 card p-1 z-20 shadow-lg">
                  <div className="px-3 py-2 text-[11px] text-slate-400 uppercase tracking-wide">Export {exportScope}</div>
                  <button className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-50" onClick={() => exportAs("xlsx")}>
                    Excel (.xlsx)
                    <span className="block text-xs text-slate-400">Recommended — phone numbers stay intact</span>
                  </button>
                  <button className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-50" onClick={() => exportAs("csv")}>
                    CSV
                    <span className="block text-xs text-slate-400">For other tools; Excel may reformat numbers</span>
                  </button>
                </div>
              )}
            </div>
          )}
          {canEdit && (
            <>
              <button className="btn-secondary" onClick={() => setShowImport(true)}>
                <Upload size={15} /> Import
              </button>
              <button className="btn-primary" onClick={() => setShowAdd(true)}>
                <Plus size={15} /> Add contact
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Summary ── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <SummaryCard icon={<Users size={16} />} label="Total" value={stats.total} onClick={() => setStatus("")} active={!status} />
          <SummaryCard icon={<UserCheck size={16} />} label="Customers" value={stats.customers} onClick={() => setStatus("customer")} active={status === "customer"} />
          <SummaryCard icon={<Megaphone size={16} />} label="From ads" value={stats.fromAd} onClick={() => setStatus("fromAd")} active={status === "fromAd"} />
          <SummaryCard icon={<Ban size={16} />} label="Opted out" value={stats.optedOut} onClick={() => setStatus("optedOut")} active={status === "optedOut"} />
          <SummaryCard
            icon={<AlertTriangle size={16} />}
            label="Invalid numbers"
            value={stats.invalid}
            onClick={() => setStatus("invalid")}
            active={status === "invalid"}
            danger={stats.invalid > 0}
          />
        </div>
      )}

      {/* Broken-number cleanup, shown until they're gone */}
      {stats && stats.invalid > 0 && status !== "invalid" && (
        <div className="mb-5 flex flex-wrap items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={18} className="shrink-0" />
          <span className="flex-1">
            <strong>{stats.invalid.toLocaleString()} contacts have phone numbers that can't be real</strong> — usually
            from a spreadsheet Excel had already damaged. They can't receive messages.
          </span>
          <button className="btn-secondary text-xs" onClick={() => setStatus("invalid")}>
            Review them
          </button>
        </div>
      )}
      {status === "invalid" && canEdit && (data?.total || 0) > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-900">
          <span className="flex-1">
            These numbers can't be fixed automatically — the missing digits were lost before import. Delete them, then
            re-import from the original .xlsx file.
          </span>
          <button
            className="btn-primary text-xs bg-red-600 hover:bg-red-700"
            onClick={() =>
              api<{ affected: number }>("/contacts/bulk", {
                method: "POST",
                body: { action: "delete", allMatching: true, filter: { status: "invalid" } },
              })
                .then((r) => {
                  flash(`Deleted ${r.affected.toLocaleString()} contacts with invalid numbers.`);
                  setStatus("");
                  refreshAll();
                })
                .catch((e) => flash(e.message))
            }
          >
            <Trash2 size={13} /> Delete all {data?.total.toLocaleString()}
          </button>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-60 max-w-md">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search name, number or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={`text-xs rounded-full px-3 py-1.5 font-medium transition-colors ${
                status === f.key ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select className="input w-48 text-sm" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.tag} ({t.count})
            </option>
          ))}
        </select>
        {batch && (
          <span className="inline-flex items-center gap-1 bg-sky-100 text-sky-700 text-xs rounded-full px-3 py-1.5">
            Last import only
            <button
              onClick={() => {
                setBatch("");
                params.delete("batch");
                setParams(params);
              }}
            >
              <X size={12} />
            </button>
          </span>
        )}
        {anyFilter && (
          <button
            className="text-xs text-slate-500 hover:text-slate-800"
            onClick={() => {
              setSearch("");
              setStatus("");
              setTag("");
              setBatch("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Bulk action bar ── */}
      {selectionCount > 0 && (
        <div className="sticky top-0 z-10 mb-3 card px-4 py-2.5 flex flex-wrap items-center gap-2 bg-slate-800 text-white border-slate-800">
          <span className="text-sm font-medium mr-2">{selectionCount.toLocaleString()} selected</span>
          {!allMatching && allOnPageSelected && (data?.total || 0) > items.length && (
            <button className="text-xs underline text-slate-300 hover:text-white mr-2" onClick={() => setAllMatching(true)}>
              Select all {data?.total.toLocaleString()} matching
            </button>
          )}
          {canEdit && (
            <>
              {bulkTagMode ? (
                <span className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    className="input text-xs py-1 w-44 text-slate-800"
                    placeholder={bulkTagMode === "addTags" ? "Tags to add" : "Tags to remove"}
                    value={bulkTagValue}
                    onChange={(e) => setBulkTagValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runBulk(bulkTagMode, { tags: bulkTagValue })}
                    list="bulk-tag-list"
                  />
                  <datalist id="bulk-tag-list">
                    {tags.map((t) => (
                      <option key={t.tag} value={t.tag} />
                    ))}
                  </datalist>
                  <button className="text-xs bg-brand-600 rounded px-2.5 py-1" onClick={() => runBulk(bulkTagMode, { tags: bulkTagValue })}>
                    Apply
                  </button>
                  <button onClick={() => setBulkTagMode(null)}>
                    <X size={14} />
                  </button>
                </span>
              ) : (
                <>
                  <BarButton onClick={() => setBulkTagMode("addTags")}>
                    <Tag size={13} /> Add tags
                  </BarButton>
                  <BarButton onClick={() => setBulkTagMode("removeTags")}>Remove tags</BarButton>
                  <BarButton onClick={() => runBulk("optOut", {}, `Opt out ${selectionCount.toLocaleString()} contacts? They won't receive broadcasts or follow-ups.`)}>
                    <Ban size={13} /> Opt out
                  </BarButton>
                  <BarButton onClick={() => runBulk("optIn")}>
                    <UserCheck size={13} /> Opt in
                  </BarButton>
                </>
              )}
            </>
          )}
          {canBroadcast && (
            <BarButton
              onClick={() => {
                if (allMatching) {
                  if (tag && !debounced && !status) navigate(`/broadcasts/new?tag=${encodeURIComponent(tag)}`);
                  else flash("To broadcast to everyone matching, filter by a tag — or select contacts on this page.");
                  return;
                }
                navigate(`/broadcasts/new?contacts=${Array.from(selected).join(",")}`);
              }}
            >
              <Megaphone size={13} /> Broadcast
            </BarButton>
          )}
          {canExport && (
            <BarButton onClick={() => exportAs("xlsx")}>
              <Download size={13} /> Export
            </BarButton>
          )}
          {canEdit && (
            <BarButton
              danger
              onClick={() =>
                runBulk(
                  "delete",
                  {},
                  `Permanently delete ${selectionCount.toLocaleString()} contacts?\n\nTheir chat history, leads and tickets are deleted too. This can't be undone.`,
                )
              }
            >
              <Trash2 size={13} /> Delete
            </BarButton>
          )}
          <button className="ml-auto text-slate-300 hover:text-white" onClick={clearSelection} title="Clear selection">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-slate-50 text-left text-[11px] text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 w-10">
                <input type="checkbox" className="accent-emerald-600" checked={allOnPageSelected} onChange={togglePage} />
              </th>
              <SortTh label="Name" field="name" sort={sort} dir={dir} onClick={toggleSort} />
              <SortTh label="Phone" field="waId" sort={sort} dir={dir} onClick={toggleSort} />
              <th className="px-4 py-3">Tags</th>
              <th className="px-4 py-3">Source</th>
              <SortTh label="Last active" field="lastSeenAt" sort={sort} dir={dir} onClick={toggleSort} />
              <SortTh label="Added" field="createdAt" sort={sort} dir={dir} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody className={loading ? "opacity-60" : ""}>
            {items.map((c) => {
              const bad = !c.masked && !isValidWaId(c.waId);
              return (
                <tr
                  key={c._id}
                  className={`border-t border-slate-100 cursor-pointer ${
                    selected.has(c._id) || allMatching ? "bg-brand-50/60" : "hover:bg-slate-50"
                  }`}
                  onClick={() => setOpenId(c._id)}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="accent-emerald-600"
                      checked={allMatching || selected.has(c._id)}
                      onChange={() => toggleOne(c._id)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium flex items-center gap-1.5">
                      {c.name || <span className="text-slate-400 font-normal">No name</span>}
                      {c.isCustomer && <CheckCircle2 size={13} className="text-emerald-600" aria-label="Customer" />}
                      {c.optedOut && <span className="text-[10px] bg-red-100 text-red-600 rounded px-1.5">opted out</span>}
                    </div>
                    {c.email && <div className="text-xs text-slate-400">{c.email}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    <span className={bad ? "text-red-600" : ""}>{formatPhone(c.waId, c.masked)}</span>
                    {bad && (
                      <span className="ml-1.5 font-sans text-[10px] bg-red-100 text-red-600 rounded px-1.5" title="Too short or malformed — can't receive WhatsApp messages">
                        invalid
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-56">
                      {(c.tags || []).slice(0, 3).map((t) => (
                        <span key={t} className="bg-brand-100 text-brand-700 text-[11px] rounded-full px-2 py-0.5">
                          {t}
                        </span>
                      ))}
                      {(c.tags || []).length > 3 && <span className="text-[11px] text-slate-400">+{c.tags.length - 3}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {c.referral?.sourceId ? "Ad" : SOURCE_LABEL[c.source || "whatsapp"] || c.source}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {c.lastSeenAt ? new Date(c.lastSeenAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              );
            })}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center">
                  {anyFilter ? (
                    <p className="text-slate-400">No contacts match these filters.</p>
                  ) : (
                    <div className="space-y-3">
                      <Users size={32} className="mx-auto text-slate-300" />
                      <p className="text-slate-500">No contacts yet. People who message you appear here automatically.</p>
                      {canEdit && (
                        <button className="btn-primary mx-auto" onClick={() => setShowImport(true)}>
                          <Upload size={15} /> Import a spreadsheet
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm text-slate-500">
          <span>
            {((data.page - 1) * data.limit + 1).toLocaleString()}–
            {Math.min(data.page * data.limit, data.total).toLocaleString()} of {data.total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <select className="input w-auto text-xs py-1" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n} per page
                </option>
              ))}
            </select>
            <button className="btn-secondary text-xs py-1" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs">
              Page {data.page} of {data.pages}
            </span>
            <button className="btn-secondary text-xs py-1" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm rounded-lg px-4 py-2.5 shadow-lg z-50">
          {toast}
        </div>
      )}

      {openId && (
        <ContactDrawer contactId={openId} canEdit={canEdit} onClose={() => setOpenId(null)} onChanged={refreshAll} />
      )}
      {showImport && (
        <Suspense fallback={null}>
        <ImportWizard
          onClose={() => setShowImport(false)}
          onDone={(b) => {
            setShowImport(false);
            if (b) {
              setStatus("");
              setTag("");
              setSearch("");
              setBatch(b);
            }
            refreshAll();
          }}
        />
        </Suspense>
      )}
      {showTags && <TagManager onClose={() => setShowTags(false)} onChanged={refreshAll} />}
      {showAdd && (
        <AddContact
          onClose={() => setShowAdd(false)}
          onCreated={(id) => {
            setShowAdd(false);
            refreshAll();
            flash("Contact added.");
            setOpenId(id);
          }}
          onOpenExisting={(id) => {
            setShowAdd(false);
            setOpenId(id);
          }}
        />
      )}
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
  onClick,
  active,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  onClick: () => void;
  active: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`card p-3 text-left transition-all ${active ? "ring-2 ring-brand-500" : "hover:border-slate-300"} ${
        danger ? "border-red-200 bg-red-50/50" : ""
      }`}
    >
      <div className={`flex items-center gap-1.5 text-xs ${danger ? "text-red-600" : "text-slate-500"}`}>
        {icon} {label}
      </div>
      <div className={`text-xl font-bold mt-0.5 ${danger ? "text-red-700" : ""}`}>{value.toLocaleString()}</div>
    </button>
  );
}

function SortTh({
  label,
  field,
  sort,
  dir,
  onClick,
}: {
  label: string;
  field: string;
  sort: string;
  dir: string;
  onClick: (f: string) => void;
}) {
  const active = sort === field;
  return (
    <th className="px-4 py-3">
      <button className={`flex items-center gap-1 uppercase ${active ? "text-slate-800" : ""}`} onClick={() => onClick(field)}>
        {label}
        <ArrowUpDown size={11} className={active ? "" : "opacity-40"} />
        {active && <span className="normal-case text-[10px]">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function BarButton({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs rounded px-2.5 py-1 flex items-center gap-1 ${
        danger ? "bg-red-600 hover:bg-red-700" : "bg-white/10 hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}

interface PhoneCheck {
  ok: boolean;
  waId?: string;
  reason?: string;
  warning?: string;
  fixed?: string;
  existing?: { _id: string; name: string } | null;
}

function AddContact({
  onClose,
  onCreated,
  onOpenExisting,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  onOpenExisting: (id: string) => void;
}) {
  const cc = localStorage.getItem("svastha_default_cc") || "91";
  const [form, setForm] = useState({ phone: "", name: "", email: "", tags: "" });
  const [check, setCheck] = useState<PhoneCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (form.phone.replace(/[^0-9]/g, "").length < 6) {
      setCheck(null);
      return;
    }
    const t = setTimeout(() => {
      api<PhoneCheck>("/contacts/validate-phone", { method: "POST", body: { phone: form.phone, defaultCountryCode: cc } })
        .then(setCheck)
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [form.phone, cc]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const c = await api<Contact>("/contacts", {
        method: "POST",
        body: { ...form, defaultCountryCode: cc },
      });
      onCreated(c._id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <form onSubmit={submit} className="card w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Add contact</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <div>
          <label className="label">WhatsApp number</label>
          <input
            className="input font-mono"
            placeholder="+91 98765 43210"
            autoFocus
            required
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          {check && (
            <div className="text-xs mt-1.5">
              {check.ok ? (
                check.existing ? (
                  <span className="text-amber-700">
                    Already saved as {check.existing.name || "a contact"} —{" "}
                    <button type="button" className="underline" onClick={() => onOpenExisting(check.existing!._id)}>
                      open it
                    </button>
                  </span>
                ) : (
                  <span className="text-emerald-700">
                    ✓ Will be saved as {formatPhone(check.waId!)}
                    {check.fixed ? ` (${check.fixed})` : ""}
                    {check.warning && <span className="block text-amber-700">{check.warning}</span>}
                  </span>
                )
              ) : (
                <span className="text-red-600">{check.reason}</span>
              )}
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-1">10-digit numbers get +{cc} added automatically.</p>
        </div>
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Email (optional)</label>
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="label">Tags (comma-separated)</label>
          <input className="input" placeholder="lead, 21-day" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy || (check !== null && (!check.ok || !!check.existing))}>
            {busy ? "Saving…" : "Add contact"}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
