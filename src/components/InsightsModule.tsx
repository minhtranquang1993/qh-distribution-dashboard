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
import { buildActionBoard, type ActionBucket, type ActionItem } from '@/lib/actionBoard';
import {
  creativeMatrix,
  geoSegments,
  groupSegments,
  leadsForMode,
  mediumSegments,
  pct,
  sourceSegments,
  typeCompanySegments,
} from '@/lib/metrics';
import { actionDimensionToDrill } from '@/lib/drill';
import type { Lead, MetricMode } from '@/types/lead';
import type { Drill } from '@/lib/drill';
import { Card, ConfidenceBadge } from '@/components/ui';

const ACTION_STYLES: Record<ActionBucket, string> = {
  Scale: 'bg-emerald-500/20 text-emerald-300',
  Watch: 'bg-sky-500/20 text-sky-300',
  Investigate: 'bg-amber-500/20 text-amber-300',
  'Fix Tracking': 'bg-orange-500/20 text-orange-300',
  'Cut/Exclude': 'bg-rose-500/20 text-rose-300',
  'Needs Spend Data': 'bg-slate-500/20 text-slate-300',
};

function ClickableSegment({
  children,
  onDrill,
}: {
  children: React.ReactNode;
  onDrill: (() => void) | undefined;
}) {
  if (!onDrill) return <>{children}</>;
  return (
    <button onClick={onDrill} className="text-left hover:text-sky-300 hover:underline" title="Xem lead mẫu">
      {children}
    </button>
  );
}

/** P1 — Insights: giữ engine buildActionBoard, trình bày 3 card click-drill được. */
export function InsightsModule({
  leads,
  mode,
  onDrill,
  filteredNote,
}: {
  leads: Lead[];
  mode: MetricMode;
  onDrill?: (drill: Drill) => void;
  filteredNote?: string;
}) {
  const { scale, risks, tracking } = useMemo(() => {
    const base = leadsForMode(leads, mode);
    const items = buildActionBoard({
      leads: base,
      sourceSegments: sourceSegments(base),
      mediumSegments: mediumSegments(base),
      typeSegments: typeCompanySegments(base),
      geoSegments: geoSegments(base),
      termSegments: groupSegments(base, (l) => l.chosenUtm.term || '(no term)'),
      contentSegments: groupSegments(base, (l) => l.chosenUtm.content || '(no content)'),
    });
    const scaleTop = items.filter((i) => i.action === 'Scale').slice(0, 5);
    const risksTop = items
      .filter((i) => i.action === 'Cut/Exclude' || i.action === 'Investigate')
      .slice(0, 8);
    const trackingTop = items.filter((i) => i.action === 'Fix Tracking').slice(0, 5);
    return { scale: scaleTop, risks: risksTop, tracking: trackingTop };
  }, [leads, mode]);

  const chartData = useMemo(
    () =>
      scale.map((item) => ({
        segment: item.segment,
        mqlRate: item.stats.mqlRate,
        n: item.stats.n,
      })),
    [scale],
  );

  const drillOf = (item: ActionItem): Drill | null => {
    const dimension = actionDimensionToDrill(item.dimension);
    if (!dimension) return null;
    return { dimension, key: item.segment, title: `${item.dimension}: ${item.segment}` };
  };

  if (scale.length === 0 && risks.length === 0 && tracking.length === 0) {
    return (
      <Card title="Insights — nên làm gì">
        <p className="text-sm text-slate-500">Chưa đủ dữ liệu để xếp hạng. Hãy nạp CSV lớn hơn.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Ứng viên scale — top 5"
          action={filteredNote ? <span className="text-xs text-slate-500">{filteredNote}</span> : undefined}
        >
          {scale.length === 0 ? (
            <p className="text-sm text-slate-500">Chưa có segment nào đủ điều kiện scale.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
                  <YAxis type="category" dataKey="segment" width={130} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number) => [`${pct(Number(value))}`, 'MQL rate']}
                    contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                  />
                  <Bar dataKey="mqlRate" radius={[0, 4, 4, 0]}>
                    {chartData.map((item) => (
                      <Cell key={item.segment} fill="#10b981" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <ul className="mt-2 space-y-1.5 text-sm">
                {scale.map((item) => {
                  const drill = drillOf(item);
                  return (
                    <li key={`${item.dimension}-${item.segment}`} className="flex items-center justify-between gap-2">
                      <ClickableSegment onDrill={drill && onDrill ? () => onDrill(drill) : undefined}>
                        <span className="text-slate-500">{item.dimension}</span>{' '}
                        <span className="font-medium text-slate-200">{item.segment}</span>
                      </ClickableSegment>
                      <span className="tabular-nums text-emerald-300">{pct(item.stats.mqlRate)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>

        <Card title="Rủi ro — loại trừ / xác minh">
          {risks.length === 0 ? (
            <p className="text-sm text-slate-500">Không có rủi ro nổi bật.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {risks.map((item) => {
                const drill = drillOf(item);
                return (
                  <li key={`${item.dimension}-${item.segment}`} className="flex items-start justify-between gap-2">
                    <div>
                      <ClickableSegment onDrill={drill && onDrill ? () => onDrill(drill) : undefined}>
                        <span className="text-slate-500">{item.dimension}</span>{' '}
                        <span className="font-medium text-slate-200">{item.segment}</span>
                      </ClickableSegment>
                      <p className="text-xs text-slate-500">{item.reason}</p>
                    </div>
                    <span className={`chip shrink-0 ${ACTION_STYLES[item.action]}`}>{item.action}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Sức khỏe tracking">
        {tracking.length === 0 ? (
          <p className="text-sm text-slate-500">Tracking ổn — không có segment nào thiếu UTM trên 50%.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {tracking.map((item) => {
              const drill = drillOf(item);
              return (
                <li key={`${item.dimension}-${item.segment}`} className="flex items-center justify-between gap-2">
                  <ClickableSegment onDrill={drill && onDrill ? () => onDrill(drill) : undefined}>
                    <span className="font-medium text-slate-200">{item.segment}</span>
                  </ClickableSegment>
                  <span className="tabular-nums text-orange-300">
                    {pct(item.stats.missingTrackingRate)} thiếu UTM
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Bảng segment dùng chung: có bar MQL + click-drill + confidence. */
export function SegmentTable({
  title,
  rows,
  onDrill,
  maxRate,
}: {
  title: string;
  rows: Array<{ key: string; n: number; mqlRate: number; extra?: string; confidence: 'high' | 'medium' | 'exploratory'; drill?: Drill }>;
  onDrill?: (drill: Drill) => void;
  maxRate?: number;
}) {
  const max = maxRate ?? Math.max(0.01, ...rows.map((r) => r.mqlRate));
  return (
    <Card title={title}>
      <ul className="space-y-2">
        {rows.map((row) => {
          const drill = row.drill;
          const handleDrill = drill && onDrill ? () => onDrill(drill) : undefined;
          return (
          <li key={row.key}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <ClickableSegment onDrill={handleDrill}>
                <span className="font-medium text-slate-200">{row.key}</span>
              </ClickableSegment>
              <span className="shrink-0 text-xs text-slate-500">
                {row.extra ? `${row.extra} · ` : ''}{row.n.toLocaleString('vi-VN')} ·{' '}
                <span className="tabular-nums text-sky-300">{pct(row.mqlRate)}</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-sky-500"
                style={{ width: `${Math.min(100, (row.mqlRate / max) * 100)}%` }}
              />
            </div>
            <div className="mt-0.5">
              <ConfidenceBadge confidence={row.confidence} />
            </div>
          </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className="text-sm text-slate-500">Chưa có dữ liệu.</p>}
    </Card>
  );
}

/** Creative dạng top-combo + bar thay vì ma trận chữ thuần. */
export function CreativeTopModule({ leads, mode, onDrill }: { leads: Lead[]; mode: MetricMode; onDrill?: (d: Drill) => void }) {
  const cells = useMemo(() => creativeMatrix(leadsForMode(leads, mode)).slice(0, 12), [leads, mode]);
  return (
    <SegmentTable
      title="Creative — top combo term × content"
      onDrill={onDrill}
      rows={cells.map((c) => ({
        key: `${c.term} × ${c.content}`,
        n: c.n,
        mqlRate: c.mqlRate,
        extra: `high-budget ${pct(c.highBudgetRate)}`,
        confidence: c.confidence,
        drill: { dimension: 'term', key: c.term, title: `Term: ${c.term}` },
      }))}
    />
  );
}
