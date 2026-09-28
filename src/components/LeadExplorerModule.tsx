import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { tierLabel } from '@/components/labels';
import { IS_PRODUCTION_BUILD } from '@/hooks/useIngest';
import { pct } from '@/lib/metrics';
import type { Lead, LeadTier } from '@/types/lead';
import { Card } from '@/components/ui';

const PAGE_SIZE = 50;
const TIERS: Array<LeadTier | 'All'> = ['All', 'MQL', 'Nurture', 'Low', 'Review'];

const TIER_STYLES: Record<LeadTier, string> = {
  MQL: 'bg-emerald-500/15 text-emerald-300',
  Nurture: 'bg-sky-500/15 text-sky-300',
  Low: 'bg-slate-500/15 text-slate-400',
  Review: 'bg-amber-500/15 text-amber-300',
};

/** Columns safe to export anywhere: no email, phone, name, or company. */
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

function exportRow(lead: Lead) {
  return {
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
  };
}

export function LeadExplorer({ leads }: { leads: Lead[] }) {
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState<LeadTier | 'All'>('All');
  const [minScore, setMinScore] = useState(0);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (tier !== 'All' && lead.tier !== tier) return false;
      if (lead.score < minScore) return false;
      if (!q) return true;
      return (
        lead.submissionId.toLowerCase().includes(q) ||
        lead.registeredCountry.toLowerCase().includes(q) ||
        lead.typeCompany.toLowerCase().includes(q) ||
        lead.chosenUtm.term.toLowerCase().includes(q) ||
        lead.chosenUtm.campaign.toLowerCase().includes(q)
      );
    });
  }, [leads, search, tier, minScore]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const handleExport = () => {
    const data = filtered.map(exportRow);
    const csv = Papa.unparse({ fields: [...EXPORT_COLUMNS], data });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `leads-segment-${tier.toLowerCase()}-${filtered.length}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card
      title="Lead Explorer"
      action={
        <button
          className="btn border border-slate-700 text-slate-300 hover:bg-slate-800"
          onClick={handleExport}
          disabled={filtered.length === 0}
        >
          Export {filtered.length.toLocaleString('vi-VN')} dòng (không PII)
        </button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Tìm theo ID, quốc gia, loại hình, term, campaign…"
          className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
        />
        <div className="flex gap-1">
          {TIERS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTier(t);
                setPage(0);
              }}
              className={`chip ${
                tier === t ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {t === 'All' ? 'Tất cả' : tierLabel(t).split('—')[0].trim()}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Score ≥
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={minScore}
            onChange={(e) => {
              setMinScore(Number(e.target.value));
              setPage(0);
            }}
            className="w-28"
          />
          <span className="tabular-nums text-slate-300">{minScore}</span>
        </label>
      </div>

      {!IS_PRODUCTION_BUILD && (
        <p className="mb-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Bản local: dữ liệu PII vẫn nằm trong bộ nhớ tiến trình. File export luôn KHÔNG chứa
          email/SĐT/tên/địa chỉ website để an toàn khi dùng làm audience hoặc chạy ads.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="table-cell">Submission</th>
              <th className="table-cell">Ngày</th>
              {IS_PRODUCTION_BUILD ? (
                <th className="table-cell">Lead ID</th>
              ) : (
                <>
                  <th className="table-cell">Tên / Email</th>
                  <th className="table-cell">SĐT</th>
                </>
              )}
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
              <tr key={lead.submissionId} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                <td className="table-cell text-slate-500">{lead.submissionId}</td>
                <td className="table-cell text-slate-400">{lead.submittedAt}</td>
                {IS_PRODUCTION_BUILD ? (
                  <td className="table-cell font-mono text-xs text-slate-500">{lead.leadKey}</td>
                ) : (
                  <>
                    <td className="table-cell">
                      <span className="text-slate-200">{lead.name || '—'}</span>
                      <span className="block text-xs text-slate-500">{lead.email}</span>
                    </td>
                    <td className="table-cell text-slate-400">{lead.phone}</td>
                  </>
                )}
                <td className="table-cell text-slate-300">
                  {lead.registeredCountry || '—'}
                  {lead.geoMismatch && <span className="ml-1 text-amber-400" title="Geo không nhất quán">⚠</span>}
                </td>
                <td className="table-cell text-slate-400">{lead.typeCompany}</td>
                <td className="table-cell text-slate-400">{lead.budgetBucket}</td>
                <td className="table-cell text-right tabular-nums font-semibold text-slate-200">{lead.score}</td>
                <td className="table-cell">
                  <span className={`chip ${TIER_STYLES[lead.tier]}`}>{lead.tier}</span>
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
          {filtered.length > 0 && ` (${pct(rows.length / filtered.length)} trang hiện tại)`}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="btn border border-slate-700 text-slate-300 disabled:opacity-40"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Trước
          </button>
          <span className="tabular-nums">
            {currentPage + 1} / {pageCount}
          </span>
          <button
            className="btn border border-slate-700 text-slate-300 disabled:opacity-40"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            Sau
          </button>
        </div>
      </div>
    </Card>
  );
}
