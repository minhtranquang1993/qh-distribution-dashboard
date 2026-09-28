import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { budgetMix, overview, pct } from '@/lib/metrics';
import type { Lead } from '@/types/lead';
import { Card, Stat } from '@/components/ui';
import { basisLabel, tierLabel } from '@/components/labels';

const BUDGET_COLORS: Record<string, string> = {
  'Below $5,000': '#475569',
  'Above $5,000 - $20,000': '#0ea5e9',
  'Above $20,000 - $50,000': '#38bdf8',
  'Above $50,000 - $100,000': '#818cf8',
  'Above $100,000': '#a78bfa',
};

export function OverviewModule({ leads }: { leads: Lead[] }) {
  const stats = overview(leads);
  const mix = budgetMix(leads);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Tổng submissions"
          value={stats.totalSubmissions.toLocaleString('vi-VN')}
          hint={`${stats.uniqueContacts.toLocaleString('vi-VN')} contact duy nhất`}
        />
        <Stat
          label="MQL rate"
          value={pct(stats.mqlRate)}
          hint={`${stats.mqlCount.toLocaleString('vi-VN')} MQL`}
        />
        <Stat
          label="High-budget rate"
          value={pct(stats.highBudgetRate)}
          hint={`${stats.highBudgetCount.toLocaleString('vi-VN')} lead ≥ $20k/tháng`}
        />
        <Stat
          label="Trùng lặp"
          value={pct(stats.duplicateRate)}
          hint={`${stats.duplicateContacts.toLocaleString('vi-VN')} contact gửi nhiều lần`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Phân bố ngân sách">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={mix} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis type="number" tick={{ fill: '#64748b', fontSize: 12 }} />
              <YAxis
                type="category"
                dataKey="bucket"
                width={150}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
              />
              <Tooltip
                formatter={(value: number) => `${value.toLocaleString('vi-VN')} (${pct(value / stats.uniqueContacts)})`}
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
                  {row.n.toLocaleString('vi-VN')}{' '}
                  <span className="text-slate-500">({pct(row.share)})</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-500">
            Tracking coverage: {pct(stats.trackingCoverage)} contact có ít nhất 1 thông tin UTM. Phần còn
            lại nên sửa trước khi dùng số liệu để quyết định ngân sách.
          </p>
        </Card>

        <Card title="Phân bố lead tier">
          <ul className="space-y-2 text-sm">
            {Object.entries(stats.tierCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([tier, count]) => (
                <li key={tier} className="flex items-center justify-between">
                  <span className="text-slate-400">{tierLabel(tier)}</span>
                  <span className="tabular-nums text-slate-200">
                    {count.toLocaleString('vi-VN')}{' '}
                    <span className="text-slate-500">({pct(count / stats.uniqueContacts)})</span>
                  </span>
                </li>
              ))}
          </ul>
          <p className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-500">
            Geo mismatch {pct(stats.geoMismatchRate)} · Spam/bot signal {pct(stats.spamRate)}
          </p>
        </Card>
      </div>
    </div>
  );
}
