/** Skeleton khi server-range đang loading (blocking render 1 lần).
 * Mô phỏng từng module để user biết layout sắp hiện, kèm progress x/y.
 * Không nhận rows — chỉ hiện khi chưa commit range mới.
 */
export function DashboardSkeleton({ loaded, total }: { loaded: number; total: number }) {
  const progress =
    total > 0
      ? `Đang tải ${loaded.toLocaleString('vi-VN')}/${total.toLocaleString('vi-VN')} dòng…`
      : `Đang tải ${loaded.toLocaleString('vi-VN')} dòng…`;
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Đang tải dữ liệu">
      <p className="text-xs text-slate-500">{progress}</p>
      {/* FilterBar */}
      <div className="card animate-pulse space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="h-6 w-32 rounded-md bg-slate-800" />
          <div className="h-6 w-32 rounded-md bg-slate-800" />
          <div className="h-6 w-20 rounded-md bg-slate-800" />
          <div className="h-6 w-20 rounded-md bg-slate-800" />
          <div className="h-6 w-16 rounded-md bg-slate-800" />
        </div>
        <div className="h-4 w-48 rounded bg-slate-800" />
      </div>
      {/* Tabs */}
      <div className="flex animate-pulse gap-1 border-b border-slate-800 pb-2">
        <div className="h-8 w-24 rounded-md bg-slate-800" />
        <div className="h-8 w-20 rounded-md bg-slate-800" />
        <div className="h-8 w-24 rounded-md bg-slate-800" />
        <div className="h-8 w-16 rounded-md bg-slate-800" />
      </div>
      {/* Overview stats */}
      <div className="grid animate-pulse gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-2">
            <div className="h-4 w-24 rounded bg-slate-800" />
            <div className="h-7 w-16 rounded bg-slate-800" />
            <div className="h-3 w-full rounded bg-slate-800" />
          </div>
        ))}
      </div>
      {/* Kênh + Creative */}
      <div className="grid animate-pulse gap-4 lg:grid-cols-2">
        <div className="card space-y-2">
          <div className="h-4 w-16 rounded bg-slate-800" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-5 w-full rounded bg-slate-800" />
          ))}
        </div>
        <div className="card space-y-2">
          <div className="h-4 w-56 rounded bg-slate-800" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-5 w-full rounded bg-slate-800" />
          ))}
        </div>
      </div>
      {/* Leads table */}
      <div className="card animate-pulse space-y-2">
        <div className="h-4 w-20 rounded bg-slate-800" />
        <div className="h-8 w-full rounded bg-slate-800" />
        <div className="h-8 w-full rounded bg-slate-800" />
        <div className="h-8 w-full rounded bg-slate-800" />
      </div>
    </div>
  );
}
