import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { BUDGET_BUCKETS, LEAD_TIERS, type BudgetBucket, type Lead, type LeadTier } from '@/types/lead';
import { leadsForDrill, type Drill } from '@/lib/drill';
import { pct } from '@/lib/metrics';
import { Card } from '@/components/ui';
import { tierLabel } from '@/components/labels';
import { IS_PRODUCTION_BUILD } from '@/hooks/useIngest';

const PAGE_SIZE = 50;
type SortKey = 'score' | 'submittedAt' | 'submissionId';

const EXPORT_COLUMNS = [
  'submissionId',
  'submittedAt',
  'leadKey',
  'score',
  'tier',
  'budgetBucket',
  'typeCompany',
  'howKnow',
  'contactPref',
  'location',
  'registeredCountry',
  'distributeCountry',
  'geoMismatch',
  'duplicateCount',
  'spamSignals',
  'attributionBasis',
  'utmSource',
  'utmMedium',
  'utmTerm',
  'utmContent',
  'utmCampaign',
  'brands',
] as const;

/** P2 — Lead lookup: facet tier/budget/country/date + sort + paging + drill. */
export function LeadsModule({
  leads,
  drill,
  onClearDrill,
  newIds,
}: {
  leads: Lead[];
  drill: Drill | null;
  onClearDrill: () => void;
  newIds: Set<string>;
}) {
  const [tier, setTier] = useState<LeadTier | 'All'>('All');
  const [budget, setBudget] = useState<BudgetBucket | 'All'>('All');
  const [country, setCountry] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlySpam, setOnlySpam] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(0);

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) if (l.registeredCountry) set.add(l.registeredCountry);
    return [...set].sort();
  }, [leads]);

  const scoped = useMemo(() => (drill ? leadsForDrill(leads, drill) : leads), [leads, drill]);

  const filtered = useMemo(() => {
    const out = scoped.filter((l) => {
      if (tier !== 'All' && l.tier !== tier) return false;
      if (budget !== 'All' && l.budgetBucket !== budget) return false;
      if (country && l.registeredCountry !== country) return false;
      if (onlyNew && !newIds.has(l.submissionId)) return false;
      if (onlySpam && l.spamSignals.length === 0) return false;
      return true;
    });
    const dir = sortDesc ? -1 : 1;
    return [...out].sort((a, b) => {
      if (sortKey === 'score') return (a.score - b.score) * dir;
      if (sortKey === 'submissionId') return a.submissionId.localeCompare(b.submissionId) * dir;
      return a.submittedAt.localeCompare(b.submittedAt) * dir;
    });
  }, [scoped, tier, budget, country, onlyNew, onlySpam, newIds, sortKey, sortDesc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const resetPage = () => setPage(0);

  const handleExport = () => {
    const data = filtered.map((lead) => ({
      submissionId: lead.submissionId,
      submittedAt: lead.submittedAt,
      leadKey: lead.leadKey,
      score: lead.score,
      tier: lead.tier,
      budgetBucket: lead.budgetBucket,
      typeCompany: lead.typeCompany,
      howKnow: lead.howKnow,
      contactPref: lead.contactPref,
      location: lead.location,
      registeredCountry: lead.registeredCountry,
      distributeCountry: lead.distributeCountry,
      geoMismatch: lead.geoMismatch,
      duplicateCount: lead.duplicateCount,
      spamSignals: lead.spamSignals.join('|'),
      attributionBasis: lead.attributionBasis,
      utmSource: lead.chosenUtm.source,
      utmMedium: lead.chosenUtm.medium,
      utmTerm: lead.chosenUtm.term,
      utmContent: lead.chosenUtm.content,
      utmCampaign: lead.chosenUtm.campaign,
      brands: lead.brands.join('|'),
    }));
    const csv = Papa.unparse({ fields: [...EXPORT_COLUMNS], data });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `leads-segment-${filtered.length}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card
      title={drill ? `Leads — ${drill.title}` : 'Leads — tra cứu'}
      action={
        <div className="flex items-center gap-2">
          {drill && (
            <button className="btn border border-slate-700 text-xs text-slate-300 hover:bg-slate-800" onClick={onClearDrill}>
              Xóa drill
            </button>
          )}
          <button
            className="btn border border-slate-700 text-xs text-slate-300 hover:bg-slate-800"
            onClick={handleExport}
            disabled={filtered.length === 0}
          >
            Export {filtered.length.toLocaleString('vi-VN')} dòng (không PII)
          </button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(['All', ...LEAD_TIERS] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTier(t); resetPage(); }}
              className={`chip ${tier === t ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
            >
              {t === 'All' ? 'Tất cả' : t}
            </button>
          ))}
        </div>
        <select
          value={budget}
          onChange={(e) => { setBudget(e.target.value as BudgetBucket | 'All'); resetPage(); }}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
        >
          <option value="All">Mọi ngân sách</option>
          {BUDGET_BUCKETS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <select
          value={country}
          onChange={(e) => { setCountry(e.target.value); resetPage(); }}
          className="max-w-44 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
        >
          <option value="">Mọi quốc gia</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-400">
          <input type="checkbox" checked={onlyNew} onChange={(e) => { setOnlyNew(e.target.checked); resetPage(); }} />
          Mới từ CSV
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-400">
          <input type="checkbox" checked={onlySpam} onChange={(e) => { setOnlySpam(e.target.checked); resetPage(); }} />
          Có cờ spam
        </label>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
        >
          <option value="score">Sort: Score</option>
          <option value="submittedAt">Sort: Ngày</option>
          <option value="submissionId">Sort: ID</option>
        </select>
        <button
          onClick={() => setSortDesc(!sortDesc)}
          className="chip bg-slate-800 text-slate-300 hover:bg-slate-700"
          title="Đảo chiều sort"
        >
          {sortDesc ? '↓' : '↑'}
        </button>
      </div>

      {!IS_PRODUCTION_BUILD && newIds.size > 0 && (
        <p className="mb-3 rounded-md bg-sky-500/10 px-3 py-2 text-xs text-sky-300">
          {newIds.size.toLocaleString('vi-VN')} dòng từ CSV chưa có trong DB (gắn cờ MỚI). Dữ liệu đang tự lưu qua Edge Function.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="table-cell">Submission</th>
              <th className="table-cell">Ngày</th>
              {!IS_PRODUCTION_BUILD && <th className="table-cell">Tên / Email</th>}
              <th className="table-cell">Quốc gia</th>
              <th className="table-cell">Loại hình</th>
              <th className="table-cell">Ngân sách</th>
              <th className="table-cell text-right">Score</th>
              <th className="table-cell">Tier</th>
              <th className="table-cell">Cờ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lead) => (
              <tr key={`${lead.submissionId}-${lead.leadKey}`} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                <td className="table-cell text-slate-500">
                  {lead.submissionId}
                  {newIds.has(lead.submissionId) && (
                    <span className="ml-1 rounded bg-sky-500/20 px-1 text-[10px] text-sky-300">MỚI</span>
                  )}
                </td>
                <td className="table-cell text-slate-400">{lead.submittedAt}</td>
                {!IS_PRODUCTION_BUILD && (
                  <td className="table-cell">
                    <span className="text-slate-200">{lead.name || '—'}</span>
                    <span className="block text-xs text-slate-500">{lead.email}</span>
                  </td>
                )}
                <td className="table-cell text-slate-300">{lead.registeredCountry || '—'}</td>
                <td className="table-cell text-slate-400">{lead.typeCompany}</td>
                <td className="table-cell text-slate-400">{lead.budgetBucket}</td>
                <td className="table-cell text-right tabular-nums font-semibold text-slate-200">{lead.score}</td>
                <td className="table-cell">
                  <span className="chip bg-slate-800 text-slate-300">{tierLabel(lead.tier).split('—')[0].trim()}</span>
                </td>
                <td className="table-cell text-xs text-slate-500">
                  {lead.duplicateCount > 1 && `trùng ×${lead.duplicateCount}`}
                  {lead.spamSignals.length > 0 && ` ${lead.spamSignals.join(',')}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          Hiện {rows.length} / {filtered.length.toLocaleString('vi-VN')} dòng
          {filtered.length > 0 && ` (${pct(rows.length / filtered.length)} trang)`}
        </span>
        <div className="flex items-center gap-2">
          <button className="btn border border-slate-700 text-slate-300 disabled:opacity-40" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            Trước
          </button>
          <span className="tabular-nums">{currentPage + 1} / {pageCount}</span>
          <button className="btn border border-slate-700 text-slate-300 disabled:opacity-40" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>
            Sau
          </button>
        </div>
      </div>
    </Card>
  );
}
