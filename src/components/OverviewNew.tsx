import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { budgetMix, makeShareLabel, overview, pct, pctOf } from '@/lib/metrics';
import type { Lead } from '@/types/lead';
import { Card, Stat } from '@/components/ui';
import { basisLabel, tierLabel } from '@/components/labels';
import { LEAD_TIERS } from '@/types/lead';

const BUDGET_COLORS: Record<string, string> = {
  'Below $5,000': '#475569',
  'Above $5,000 - $20,000': '#0ea5e9',
  'Above $20,000 - $50,000': '#38bdf8',
  'Above $50,000 - $100,000': '#818cf8',
  'Above $100,000': '#a78bfa',
};

const TIER_COLORS: Record<string, string> = {
  MQL: '#10b981',
  Nurture: '#0ea5e9',
  Low: '#475569',
  Review: '#f59e0b',
};

/** Tổng quan mới: KPI + funnel MQL + budget mix + attribution (đếm mỗi submission là 1 lead). */
export function OverviewNew({ leads }: { leads: Lead[] }) {
  const stats = useMemo(() => overview(leads), [leads]);
  const mix = useMemo(() => budgetMix(leads), [leads]);
  const total = stats.totalLeads;
  const shareLabel = useMemo(() => makeShareLabel(total), [total]);

  const funnel = useMemo(
    () =>
      LEAD_TIERS.map((tier) => ({
        tier,
        n: stats.tierCounts[tier] ?? 0,
      })),
    [stats],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Lead"
          value={stats.totalLeads.toLocaleString('vi-VN')}
          hint={`${stats.mqlCount.toLocaleString('vi-VN')} MQL`}
        />
        <Stat
          label="MQL rate"
          value={pct(stats.mqlRate)}
          hint={`${stats.mqlCount.toLocaleString('vi-VN')} MQL`}
        />
        <Stat
          label="High-budget ≥$20k"
          value={pct(stats.highBudgetRate)}
          hint={`${stats.highBudgetCount.toLocaleString('vi-VN')} lead`}
        />
        <Stat
          label="Tracking coverage"
          value={pct(stats.trackingCoverage)}
          hint="lead có ít nhất 1 UTM"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Funnel chất lượng">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={funnel} layout="vertical" margin={{ left: 8, right: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis type="number" tick={{ fill: '#64748b', fontSize: 12 }} />
              <YAxis type="category" dataKey="tier" width={80} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip
                formatter={shareLabel}
                contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
              />
              <Bar dataKey="n" radius={[0, 4, 4, 0]}>
                {funnel.map((entry) => (
                  <Cell key={entry.tier} fill={TIER_COLORS[entry.tier] ?? '#64748b'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-slate-500">
            Geo mismatch {pct(stats.geoMismatchRate)} · Spam {pct(stats.spamRate)}
          </p>
        </Card>

        <Card title="Phân bố ngân sách">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={mix} layout="vertical" margin={{ left: 8, right: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis type="number" tick={{ fill: '#64748b', fontSize: 12 }} />
              <YAxis type="category" dataKey="bucket" width={130} tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip
                formatter={shareLabel}
                contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
              />
              <Bar dataKey="n" radius={[0, 4, 4, 0]}>
                {mix.map((entry) => (
                  <Cell key={entry.bucket} fill={BUDGET_COLORS[entry.bucket] ?? '#64748b'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Nguồn attribution">
          <ul className="space-y-2 text-sm">
            {stats.attributionCoverage.map((row) => (
              <li key={row.basis} className="flex items-center justify-between">
                <span className="text-slate-400">{basisLabel(row.basis)}</span>
                <span className="tabular-nums text-slate-200">
                  {row.n.toLocaleString('vi-VN')} <span className="text-slate-500">({pct(row.share)})</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-slate-800 pt-3">
            {Object.entries(stats.tierCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([tier, count]) => (
                <div key={tier} className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">{tierLabel(tier)}</span>
                  <span className="tabular-nums text-slate-200">
                    {count.toLocaleString('vi-VN')} <span className="text-slate-500">({pctOf(count, total)})</span>
                  </span>
                </div>
              ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
