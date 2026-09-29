import { BUDGET_BUCKETS, LEAD_TIERS } from '@/types/lead';
import { activeFilterLabels, EMPTY_FILTER, type CohortFilter } from '@/lib/cohort';

export function FilterBar({
  filter,
  onChange,
  total,
  filtered,
}: {
  filter: CohortFilter;
  onChange: (f: CohortFilter) => void;
  total: number;
  filtered: number;
}) {
  const toggleBudget = (b: (typeof BUDGET_BUCKETS)[number]) => {
    const has = filter.budgets.includes(b);
    onChange({ ...filter, budgets: has ? filter.budgets.filter((x) => x !== b) : [...filter.budgets, b] });
  };
  const toggleTier = (t: (typeof LEAD_TIERS)[number]) => {
    const has = filter.tiers.includes(t);
    onChange({ ...filter, tiers: has ? filter.tiers.filter((x) => x !== t) : [...filter.tiers, t] });
  };

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Từ tháng
          <input
            type="month"
            value={filter.monthFrom}
            min="2026-01"
            max="2026-12"
            onChange={(e) => onChange({ ...filter, monthFrom: e.target.value })}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Tới tháng
          <input
            type="month"
            value={filter.monthTo}
            min="2026-01"
            max="2026-12"
            onChange={(e) => onChange({ ...filter, monthTo: e.target.value })}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
          />
        </label>
        <div className="flex flex-wrap gap-1">
          {BUDGET_BUCKETS.map((b) => (
            <button
              key={b}
              onClick={() => toggleBudget(b)}
              className={`chip ${filter.budgets.includes(b) ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {LEAD_TIERS.map((t) => (
            <button
              key={t}
              onClick={() => toggleTier(t)}
              className={`chip ${filter.tiers.includes(t) ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
            >
              {t}
            </button>
          ))}
        </div>
        {(filter.monthFrom || filter.monthTo || filter.budgets.length > 0 || filter.tiers.length > 0) && (
          <button
            onClick={() => onChange(EMPTY_FILTER)}
            className="btn border border-slate-700 text-xs text-slate-300 hover:bg-slate-800"
          >
            Xóa lọc
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        n={filtered.toLocaleString('vi-VN')}/{total.toLocaleString('vi-VN')} contacts
        {activeFilterLabels(filter).length > 0 && (
          <> · đang lọc: {activeFilterLabels(filter).join(' · ')}</>
        )}
      </p>
    </div>
  );
}
