import { useMemo, useState } from 'react';
import {
  leadsForMode,
  sourceSegments,
  mediumSegments,
  howKnowSegments,
  pct,
  type SegmentStats,
} from '@/lib/metrics';
import type { Lead, MetricMode } from '@/types/lead';
import { Card, ConfidenceBadge } from '@/components/ui';

type Dimension = 'source' | 'medium' | 'howKnow';

const DIMENSIONS: Array<{ key: Dimension; label: string }> = [
  { key: 'source', label: 'Source' },
  { key: 'medium', label: 'Medium' },
  { key: 'howKnow', label: 'Biết qua' },
];

export function ChannelModule({ leads, mode, onModeChange }: { leads: Lead[]; mode: MetricMode; onModeChange: (m: MetricMode) => void }) {
  const [dimension, setDimension] = useState<Dimension>('source');

  const segments = useMemo(() => {
    const base = leadsForMode(leads, mode);
    if (dimension === 'source') return sourceSegments(base);
    if (dimension === 'medium') return mediumSegments(base);
    return howKnowSegments(base);
  }, [leads, mode, dimension]);

  return (
    <Card
      title="Phân tích kênh"
      action={<ModeToggle mode={mode} onChange={onModeChange} />}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {DIMENSIONS.map((d) => (
          <button
            key={d.key}
            onClick={() => setDimension(d.key)}
            className={`chip ${
              dimension === d.key ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="table-cell">Segment</th>
              <th className="table-cell text-right">n</th>
              <th className="table-cell text-right">MQL rate</th>
              <th className="table-cell text-right">High-budget</th>
              {/* In dupe_groups mode every row is a repeat submitter, so the
                  column would read 100% everywhere and carry no information. */}
              {mode !== 'dupe_groups' && <th className="table-cell text-right">Trùng</th>}
              <th className="table-cell text-right">Thiếu UTM</th>
              <th className="table-cell">Tin cậy</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((segment) => (
              <SegmentRow key={segment.key} segment={segment} showDupeRate={mode !== 'dupe_groups'} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function SegmentRow({ segment, showDupeRate = true }: { segment: SegmentStats; showDupeRate?: boolean }) {
  return (
    <tr className="border-b border-slate-800/60 hover:bg-slate-800/30">
      <td className="table-cell font-medium text-slate-200">{segment.key}</td>
      <td className="table-cell text-right tabular-nums text-slate-400">{segment.n.toLocaleString('vi-VN')}</td>
      <td className="table-cell text-right tabular-nums text-sky-300">{pct(segment.mqlRate)}</td>
      <td className="table-cell text-right tabular-nums text-slate-300">{pct(segment.highBudgetRate)}</td>
      {showDupeRate && (
        <td className="table-cell text-right tabular-nums text-slate-400">{pct(segment.duplicateRate)}</td>
      )}
      <td className="table-cell text-right tabular-nums text-slate-400">{pct(segment.missingTrackingRate)}</td>
      <td className="table-cell">
        <ConfidenceBadge confidence={segment.confidence} />
      </td>
    </tr>
  );
}

export function ModeToggle({ mode, onChange }: { mode: MetricMode; onChange: (m: MetricMode) => void }) {
  const options: Array<{ key: MetricMode; label: string; title: string }> = [
    { key: 'unique', label: 'Contact duy nhất', title: 'Mặc định: mỗi contact tính 1 lần' },
    { key: 'raw', label: 'Tất cả submissions', title: 'Đo lưu lượng form' },
    { key: 'dupe_groups', label: 'Nhóm trùng', title: 'Đo lạm phát trùng lặp' },
  ];
  return (
    <div className="flex gap-1">
      {options.map((opt) => (
        <button
          key={opt.key}
          title={opt.title}
          onClick={() => onChange(opt.key)}
          className={`chip ${
            mode === opt.key ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

