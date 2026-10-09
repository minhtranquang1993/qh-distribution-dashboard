import { useMemo, useState } from 'react';
import {
  brandDemand,
  geoSegments,
  howKnowSegments,
  mediumSegments,
  pct,
  sourceSegments,
  typeBudgetMatrix,
  typeCompanySegments,
} from '@/lib/metrics';
import type { Lead } from '@/types/lead';
import type { Drill } from '@/lib/drill';
import { Card } from '@/components/ui';
import { CreativeTopModule, InsightsModule, SegmentTable } from '@/components/InsightsModule';
import { TrendModule } from '@/components/TrendModule';

type TabKey = 'overview-insights' | 'acquire' | 'quality' | 'leads';

export { TrendModule };

/** Nhóm Thu hút: Kênh + Creative + Xu hướng (gộp 3 tab cũ). */
export function AcquireGroup({
  leads,
  onDrill,
}: {
  leads: Lead[];
  onDrill?: (d: Drill) => void;
}) {
  const [dimension, setDimension] = useState<'source' | 'medium' | 'howKnow'>('source');
  const base = leads;
  const segments = useMemo(() => {
    if (dimension === 'source') return sourceSegments(base);
    if (dimension === 'medium') return mediumSegments(base);
    return howKnowSegments(base);
  }, [base, dimension]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card
          title="Kênh"
          action={
            <div className="flex gap-1">
              {(
                [
                  ['source', 'Source'],
                  ['medium', 'Medium'],
                  ['howKnow', 'Biết qua'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setDimension(key)}
                  className={`chip ${dimension === key ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          <SegmentTable
            title=""
            onDrill={onDrill}
            rows={segments.slice(0, 12).map((s) => ({
              key: s.key,
              n: s.n,
              mqlRate: s.mqlRate,
              extra: `thiếu UTM ${pct(s.missingTrackingRate)}`,
              confidence: s.confidence,
              drill:
                dimension === 'source'
                  ? { dimension: 'source', key: s.key, title: `Source: ${s.key}` }
                  : dimension === 'medium'
                    ? { dimension: 'medium', key: s.key, title: `Medium: ${s.key}` }
                    : { dimension: 'howKnow', key: s.key, title: `Biết qua: ${s.key}` },
            }))}
          />
        </Card>
        <TrendModule leads={leads} />
      </div>
      <div className="space-y-4">
        <CreativeTopModule leads={leads} onDrill={onDrill} />
      </div>
    </div>
  );
}

/** Nhóm Chất lượng: Geo + Firmographic + Brand (gộp 3 tab cũ). */
export function QualityGroup({
  leads,
  onDrill,
}: {
  leads: Lead[];
  onDrill?: (d: Drill) => void;
}) {
  const base = leads;
  const geo = useMemo(() => geoSegments(base).slice(0, 10), [base]);
  const types = useMemo(() => typeCompanySegments(base).slice(0, 8), [base]);
  const matrix = useMemo(() => typeBudgetMatrix(base).slice(0, 8), [base]);
  const brands = useMemo(() => brandDemand(base).slice(0, 10), [base]);
  const mismatch = useMemo(
    () => geoSegments(base).filter((s) => s.geoMismatchRate > 0.3).slice(0, 5),
    [base],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SegmentTable
        title="Top quốc gia theo MQL rate"
        onDrill={onDrill}
        rows={geo.map((s) => ({
          key: s.key,
          n: s.n,
          mqlRate: s.mqlRate,
          extra: `geo mismatch ${pct(s.geoMismatchRate)}`,
          confidence: s.confidence,
          drill: { dimension: 'geo', key: s.key, title: `Quốc gia: ${s.key}` },
        }))}
      />
      <SegmentTable
        title="Loại hình doanh nghiệp"
        onDrill={onDrill}
        rows={types.map((s) => ({
          key: s.key,
          n: s.n,
          mqlRate: s.mqlRate,
          extra: `high-budget ${pct(s.highBudgetRate)}`,
          confidence: s.confidence,
          drill: { dimension: 'type', key: s.key, title: `Loại hình: ${s.key}` },
        }))}
      />
      <Card title="Loại hình × ngân sách (top)">
        <ul className="space-y-1.5 text-sm">
          {matrix.map((row) => (
            <li key={`${row.typeCompany}-${row.budgetBucket}`} className="flex items-center justify-between">
              <span className="text-slate-300">
                {row.typeCompany} <span className="text-slate-500">· {row.budgetBucket}</span>
              </span>
              <span className="tabular-nums text-slate-400">{row.n.toLocaleString('vi-VN')}</span>
            </li>
          ))}
        </ul>
        {mismatch.length > 0 && (
          <p className="mt-3 border-t border-slate-800 pt-3 text-xs text-rose-300">
            Cảnh báo geo mismatch &gt;30%: {mismatch.map((s) => `${s.key} ${pct(s.geoMismatchRate)}`).join(' · ')}
          </p>
        )}
      </Card>
      <SegmentTable
        title="Top thương hiệu được hỏi"
        onDrill={onDrill}
        rows={brands.map((b) => ({
          key: b.brand,
          n: b.n,
          mqlRate: b.mqlRate,
          extra: `high-budget ${pct(b.highBudgetRate)}`,
          confidence: 'high',
          drill: { dimension: 'brand', key: b.brand, title: `Brand: ${b.brand}` },
        }))}
      />
    </div>
  );
}

export function OverviewTab({
  leads,
  onDrill,
  filteredNote,
}: {
  leads: Lead[];
  onDrill?: (d: Drill) => void;
  filteredNote?: string;
}) {
  return (
    <div className="space-y-4">
      <InsightsModule leads={leads} onDrill={onDrill} filteredNote={filteredNote} />
    </div>
  );
}

export type { TabKey };
