import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { monthlyTrend } from '@/lib/metrics';
import type { Lead } from '@/types/lead';
import { Card } from '@/components/ui';

export function TrendModule({ leads }: { leads: Lead[] }) {
  const trend = useMemo(() => monthlyTrend(leads), [leads]);

  return (
    <Card title="Xu hướng theo tháng — phát hiện resubmit">
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={trend} margin={{ left: 0, right: 16 }}>
          <defs>
            <linearGradient id="gradLeads" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradMql" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 12 }} />
          <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
            labelFormatter={(label) => `Tháng ${label}`}
          />
          <Area type="monotone" dataKey="n" name="Submissions" stroke="#0ea5e9" fill="url(#gradLeads)" />
          <Area type="monotone" dataKey="highBudget" name="High-budget" stroke="#38bdf8" fill="transparent" />
          <Area type="monotone" dataKey="mql" name="MQL" stroke="#a78bfa" fill="url(#gradMql)" />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}
