import { useMemo } from 'react';
import {
  brandDemand,
  budgetMix,
  geoSegments,
  leadsForMode,
  typeBudgetMatrix,
  pct,
} from '@/lib/metrics';
import type { Lead, MetricMode } from '@/types/lead';
import { Card, ConfidenceBadge } from '@/components/ui';

export function GeoModule({ leads, mode }: { leads: Lead[]; mode: MetricMode }) {
  const base = useMemo(() => leadsForMode(leads, mode), [leads, mode]);
  const segments = useMemo(() => geoSegments(base).slice(0, 20), [base]);
  const mismatch = useMemo(() => {
    const rows = geoSegments(base).filter((s) => s.geoMismatchRate > 0.3).slice(0, 12);
    return rows;
  }, [base]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Top quốc gia theo MQL rate">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
                <th className="table-cell">Quốc gia đăng ký</th>
                <th className="table-cell text-right">n</th>
                <th className="table-cell text-right">MQL</th>
                <th className="table-cell text-right">High-budget</th>
                <th className="table-cell text-right">Geo mismatch</th>
                <th className="table-cell">Tin cậy</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.key} className="border-b border-slate-800/60">
                  <td className="table-cell font-medium text-slate-200">{s.key}</td>
                  <td className="table-cell text-right tabular-nums text-slate-400">{s.n.toLocaleString('vi-VN')}</td>
                  <td className="table-cell text-right tabular-nums text-sky-300">{pct(s.mqlRate)}</td>
                  <td className="table-cell text-right tabular-nums text-slate-300">{pct(s.highBudgetRate)}</td>
                  <td
                    className={`table-cell text-right tabular-nums ${
                      s.geoMismatchRate > 0.4 ? 'text-rose-300' : 'text-slate-400'
                    }`}
                  >
                    {pct(s.geoMismatchRate)}
                  </td>
                  <td className="table-cell">
                    <ConfidenceBadge confidence={s.confidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Cảnh báo geo không nhất quán">
        <p className="mb-3 text-xs text-slate-500">
          Quốc gia này có tỷ lệ location ≠ registered ≠ distribute cao — thường là proxy/VPN hoặc chọn bừa,
          cần xác minh trước khi scale.
        </p>
        {mismatch.length === 0 ? (
          <p className="text-sm text-slate-500">Không có quốc gia nào vượt ngưỡng 30% mismatch.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {mismatch.map((s) => (
              <li key={s.key} className="flex items-center justify-between">
                <span className="text-slate-300">{s.key}</span>
                <span className="tabular-nums text-rose-300">
                  {pct(s.geoMismatchRate)} <span className="text-slate-500">({s.n})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function FirmographicModule({ leads, mode }: { leads: Lead[]; mode: MetricMode }) {
  const base = useMemo(() => leadsForMode(leads, mode), [leads, mode]);
  const matrix = useMemo(() => typeBudgetMatrix(base).slice(0, 20), [base]);
  const mix = useMemo(() => budgetMix(base), [base]);

  return (
    <Card title="Firmographic — loại hình × ngân sách">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="table-cell">Loại hình</th>
              <th className="table-cell">Khoản mua/tháng</th>
              <th className="table-cell text-right">n</th>
              <th className="table-cell text-right">Tỷ trọng</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={`${row.typeCompany}-${row.budgetBucket}`} className="border-b border-slate-800/60">
                <td className="table-cell font-medium text-slate-200">{row.typeCompany}</td>
                <td className="table-cell text-slate-400">{row.budgetBucket}</td>
                <td className="table-cell text-right tabular-nums text-slate-400">{row.n.toLocaleString('vi-VN')}</td>
                <td className="table-cell text-right tabular-nums text-slate-300">
                  {pct(row.n / base.length)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Dùng để viết rule loại trừ — ví dụ nhóm Boutique Store + Below $5k chiếm tỷ trọng lớn nhưng MQL rate
        thấp, phù hợp để đưa vào exclusion.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {mix.map((row) => (
          <span key={row.bucket} className="chip bg-slate-800 text-slate-300">
            {row.bucket}: {pct(row.share)}
          </span>
        ))}
      </div>
    </Card>
  );
}

export function BrandModule({ leads, mode }: { leads: Lead[]; mode: MetricMode }) {
  const base = useMemo(() => leadsForMode(leads, mode), [leads, mode]);
  const brands = useMemo(() => brandDemand(base).slice(0, 20), [base]);

  return (
    <Card title="Brand demand — top 20 thương hiệu được hỏi">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="table-cell">Thương hiệu</th>
              <th className="table-cell text-right">Số lead</th>
              <th className="table-cell text-right">MQL rate</th>
              <th className="table-cell text-right">High-budget</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((row) => (
              <tr key={row.brand} className="border-b border-slate-800/60">
                <td className="table-cell font-medium text-slate-200">{row.brand}</td>
                <td className="table-cell text-right tabular-nums text-slate-400">{row.n.toLocaleString('vi-VN')}</td>
                <td className="table-cell text-right tabular-nums text-sky-300">{pct(row.mqlRate)}</td>
                <td className="table-cell text-right tabular-nums text-slate-300">{pct(row.highBudgetRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
