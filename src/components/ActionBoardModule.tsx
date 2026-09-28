import { useMemo } from 'react';
import { buildActionBoard, type ActionBucket } from '@/lib/actionBoard';
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
import type { Lead, MetricMode } from '@/types/lead';
import { Card, ConfidenceBadge } from '@/components/ui';

const ACTION_STYLES: Record<ActionBucket, string> = {
  Scale: 'bg-emerald-500/20 text-emerald-300',
  Watch: 'bg-sky-500/20 text-sky-300',
  Investigate: 'bg-amber-500/20 text-amber-300',
  'Fix Tracking': 'bg-orange-500/20 text-orange-300',
  'Cut/Exclude': 'bg-rose-500/20 text-rose-300',
  'Needs Spend Data': 'bg-slate-500/20 text-slate-300',
};

const ACTION_ORDER: ActionBucket[] = [
  'Scale',
  'Watch',
  'Investigate',
  'Fix Tracking',
  'Cut/Exclude',
  'Needs Spend Data',
];

export function ActionBoardModule({ leads, mode }: { leads: Lead[]; mode: MetricMode }) {
  const items = useMemo(() => {
    const base = leadsForMode(leads, mode);
    return buildActionBoard({
      leads: base,
      sourceSegments: sourceSegments(base),
      mediumSegments: mediumSegments(base),
      typeSegments: typeCompanySegments(base),
      geoSegments: geoSegments(base),
      termSegments: groupSegments(base, (l) => l.chosenUtm.term || '(no term)'),
      contentSegments: groupSegments(base, (l) => l.chosenUtm.content || '(no content)'),
    });
  }, [leads, mode]);

  const grouped = useMemo(() => {
    const map = new Map<ActionBucket, typeof items>();
    for (const action of ACTION_ORDER) map.set(action, []);
    for (const item of items) map.get(item.action)?.push(item);
    return map;
  }, [items]);

  return (
    <Card title="Action Board — cắt ở đâu, dồn vào đâu">
      <p className="mb-4 text-xs text-slate-500">
        Xếp hạng theo MQL rate, số lượng, tỷ lệ trùng/rác, geo mismatch và độ thiếu tracking. Mọi
        segment mẫu nhỏ hoặc thiếu dữ liệu chi phí đều không được xếp vào Scale.
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Chưa đủ dữ liệu để xếp hạng. Hãy nạp CSV lớn hơn.</p>
      ) : (
        <div className="space-y-5">
          {ACTION_ORDER.map((action) => {
            const bucket = grouped.get(action) ?? [];
            if (bucket.length === 0) return null;
            return (
              <div key={action}>
                <div className="mb-2 flex items-center gap-2">
                  <span className={`chip ${ACTION_STYLES[action]}`}>{action}</span>
                  <span className="text-xs text-slate-500">{bucket.length} segment</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
                        <th className="table-cell">Chiều / Segment</th>
                        <th className="table-cell">Lý do</th>
                        <th className="table-cell text-right">n</th>
                        <th className="table-cell text-right">MQL rate</th>
                        <th className="table-cell">Tin cậy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bucket.slice(0, 12).map((item) => (
                        <tr key={`${item.dimension}-${item.segment}`} className="border-b border-slate-800/60">
                          <td className="table-cell">
                            <span className="text-slate-500">{item.dimension}</span>{' '}
                            <span className="font-medium text-slate-200">{item.segment}</span>
                          </td>
                          <td className="table-cell whitespace-normal text-xs text-slate-400">{item.reason}</td>
                          <td className="table-cell text-right tabular-nums text-slate-400">
                            {item.stats.n.toLocaleString('vi-VN')}
                          </td>
                          <td className="table-cell text-right tabular-nums text-sky-300">
                            {pct(item.stats.mqlRate)}
                          </td>
                          <td className="table-cell">
                            <ConfidenceBadge confidence={item.stats.confidence} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function CreativeModule({ leads, mode }: { leads: Lead[]; mode: MetricMode }) {
  const cells = useMemo(() => creativeMatrix(leadsForMode(leads, mode)), [leads, mode]);

  return (
    <Card title="Creative — utm_term × utm_content">
      <p className="mb-4 text-xs text-slate-500">
        Ô nào có MQL rate cao nhưng volume thấp thì nên scale; ô nào volume lớn mà rate thấp thì nên thay
        creative thay vì cắt target.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="table-cell">Term</th>
              <th className="table-cell">Content</th>
              <th className="table-cell text-right">n</th>
              <th className="table-cell text-right">MQL rate</th>
              <th className="table-cell text-right">High-budget</th>
              <th className="table-cell">Tin cậy</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((cell) => (
              <tr key={cell.key} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                <td className="table-cell font-medium text-slate-200">{cell.term}</td>
                <td className="table-cell text-slate-400">{cell.content}</td>
                <td className="table-cell text-right tabular-nums text-slate-400">{cell.n.toLocaleString('vi-VN')}</td>
                <td className="table-cell text-right tabular-nums text-sky-300">{pct(cell.mqlRate)}</td>
                <td className="table-cell text-right tabular-nums text-slate-300">{pct(cell.highBudgetRate)}</td>
                <td className="table-cell">
                  <ConfidenceBadge confidence={cell.confidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cells.length === 0 && <p className="text-sm text-slate-500">Chưa đủ tổ hợp term/content có mẫu đủ lớn.</p>}
    </Card>
  );
}
