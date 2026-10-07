import { useMemo, useState } from 'react';
import { useDataSource } from '@/hooks/useDataSource';
import type { RangePreset } from '@/lib/supabaseLeads';
import { UploadPanel } from '@/components/UploadPanel';
import { DashboardSkeleton } from '@/components/DashboardSkeleton';
import { OverviewNew } from '@/components/OverviewNew';
import { AcquireGroup, QualityGroup, OverviewTab } from '@/components/Groups';
import { LeadsModule } from '@/components/LeadsModule';
import { FilterBar } from '@/components/FilterBar';
import { applyFilters, EMPTY_FILTER, isFiltered, type CohortFilter } from '@/lib/cohort';
import type { Drill } from '@/lib/drill';
import type { MetricMode } from '@/types/lead';

const TABS = [
  { key: 'overview', label: 'Tổng quan' },
  { key: 'acquire', label: 'Thu hút' },
  { key: 'quality', label: 'Chất lượng' },
  { key: 'leads', label: 'Leads' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function ModeToggle({ mode, onChange }: { mode: MetricMode; onChange: (m: MetricMode) => void }) {
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

export default function App() {
  const data = useDataSource();
  const [tab, setTab] = useState<TabKey>('overview');
  const [mode, setMode] = useState<MetricMode>('unique');
  const [filter, setFilter] = useState<CohortFilter>(EMPTY_FILTER);
  const [drill, setDrill] = useState<Drill | null>(null);

  const base = data.combined.length > 0 ? data.combined : data.visibleLeads;
  const filtered = useMemo(() => applyFilters(base, filter), [base, filter]);

  const handleDrill = (d: Drill) => {
    setDrill(d);
    setTab('leads');
  };

  const ready = base.length > 0;
  // Progressive (tang-toc-load-hien-ngay): có rows là hiện dashboard ngay, kể
  // cả đang loading (gap giữ snapshot cũ hoặc partial mới). Skeleton chỉ khi
  // loading mà chưa có gì để hiện (lần đầu chưa snapshot).
  const serverLoading = data.dbStatus === 'loading';
  const showDashboard = ready;
  const showSkeleton = serverLoading && !ready;
  const filteredNote = isFiltered(filter) ? 'trên bộ lọc hiện tại' : undefined;

  return (
    <div className="mx-auto min-h-screen max-w-[1400px] px-4 py-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">QH Distribution — Lead Quality Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Phân tích chất lượng lead để tối ưu performance marketing. MQL rate là proxy tổng budget —
            khi có dữ liệu chi phí ads, các segment sẽ chuyển từ quyết định chờ sang quyết định scale.
          </p>
        </div>
        {showDashboard && <ModeToggle mode={mode} onChange={setMode} />}
      </header>

      <div className="space-y-4">
        {/* Nguồn Supabase */}
        {data.supabaseConfigured ? (
          <div className="card space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-300">
              {data.dbStatus === 'loading' &&
                (data.dbPartial
                  ? `Đang tải ${data.dbLoaded.toLocaleString('vi-VN')}${data.dbTotal > 0 ? `/${data.dbTotal.toLocaleString('vi-VN')}` : ''} dòng${data.rangeLabel ? ` (${data.rangeLabel})` : ''} — số liệu chưa đủ, sẽ cập nhật tiếp`
                  : ready
                    ? `Supabase: ${data.dbTotal.toLocaleString('vi-VN')} dòng${data.rangeLabel ? ` (${data.rangeLabel})` : ' trong DB'} · Đang tải khoảng mới…`
                    : `Đang tải Supabase… ${data.dbLoaded.toLocaleString('vi-VN')}${data.dbTotal > 0 ? `/${data.dbTotal.toLocaleString('vi-VN')}` : ''} dòng`)}
              {data.dbStatus === 'ready' &&
                `Supabase: ${data.dbTotal.toLocaleString('vi-VN')} dòng${data.rangeLabel ? ` (${data.rangeLabel})` : ' trong DB'}`}
              {data.dbUndated > 0 && data.dbStatus === 'ready' && (
                <span className="text-slate-500"> · {data.dbUndated.toLocaleString('vi-VN')} dòng không có ngày</span>
              )}
              {data.dbStatus === 'error' && <span className="text-rose-400">Supabase lỗi: {data.dbError}</span>}
              {data.dbStatus === 'unconfigured' && 'Supabase chưa cấu hình — dùng CSV bên dưới.'}
              {data.csvCount > 0 && (
                <span className="text-sky-300"> · CSV thêm {data.csvCount.toLocaleString('vi-VN')} dòng</span>
              )}
            </p>
            <div className="flex items-center gap-1">
              {(['1m', '3m', '6m', 'all'] as const).map((p: Exclude<RangePreset, 'custom'>) => (
                <button
                  key={p}
                  onClick={() => data.setPreset(p)}
                  className={`chip ${data.preset === p ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                  {p === 'all' ? 'Tất cả' : p === '1m' ? '1 tháng' : p === '3m' ? '3 tháng' : '6 tháng'}
                </button>
              ))}
              <button
                onClick={data.openCustom}
                className={`chip ${data.preset === 'custom' ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                Custom
              </button>
              {data.dbStatus === 'error' && (
                <button className="btn border border-slate-700 text-xs text-slate-300 hover:bg-slate-800" onClick={() => data.reloadDb()}>
                  Thử lại
                </button>
              )}
            </div>
            </div>
            {data.preset === 'custom' && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  Từ tháng
                  <input
                    type="month"
                    value={data.customDraft.from}
                    onChange={(e) => data.setCustomDraft({ ...data.customDraft, from: e.target.value })}
                    className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  Tới tháng
                  <input
                    type="month"
                    value={data.customDraft.to}
                    onChange={(e) => data.setCustomDraft({ ...data.customDraft, to: e.target.value })}
                    className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                  />
                </label>
                <button
                  onClick={data.applyCustom}
                  disabled={!data.customValid}
                  className="btn border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Áp dụng
                </button>
                {!data.customValid && (
                  <span className="text-xs text-slate-500">Chọn đủ Từ–Tới tháng, Từ ≤ Tới</span>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Chưa cấu hình Supabase (thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trong .env.local) — dùng CSV bên dưới.
          </p>
        )}

        <UploadPanel
          onFile={data.ingest.parseFile}
          status={data.ingest.state.status}
          progress={data.ingest.state.progress}
          error={data.ingest.state.error}
          fileName={data.ingest.state.fileName}
          onReset={data.ingest.reset}
          saveStatus={data.saveStatus}
          saveProgress={data.saveProgress}
          saveError={data.saveError}
        />

        {data.ingest.state.warnings.length > 0 && (
          <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {data.ingest.state.warnings.join(' · ')}
          </div>
        )}

        {/* Reload lỗi giữ snapshot + banner, không trắng trang. */}
        {data.dbError && data.dbStatus === 'ready' && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Tải khoảng mới thất bại: {data.dbError} — đang hiển thị dữ liệu cũ ({data.rangeLabel ?? 'toàn bộ'}).
          </p>
        )}

        {showSkeleton ? (
          <DashboardSkeleton loaded={data.dbLoaded} total={data.dbTotal} />
        ) : showDashboard ? (
          <>
            {serverLoading && data.dbPartial && (
              <p className="rounded-md bg-sky-500/10 px-3 py-2 text-xs text-sky-300">
                Đang tải thêm dữ liệu cho {data.rangeLabel ?? 'khoảng đã chọn'} (
                {data.dbLoaded.toLocaleString('vi-VN')}
                {data.dbTotal > 0 ? `/${data.dbTotal.toLocaleString('vi-VN')}` : ''} dòng) — số
                liệu bên dưới chưa đủ, sẽ tự cập nhật.
              </p>
            )}
            <FilterBar filter={filter} onChange={setFilter} total={base.length} filtered={filtered.length} />

            <nav className="flex flex-wrap gap-1 border-b border-slate-800 pb-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    tab === t.key ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {t.label}
                  {t.key === 'leads' && drill && <span className="ml-1 text-sky-400">•</span>}
                </button>
              ))}
            </nav>

            <p className="text-xs text-slate-600">
              Mặc định mọi phân tích dùng contact duy nhất, không tính lead gửi trùng. Bấm vào bất kỳ
              segment nào để xem lead mẫu ở tab Leads.
            </p>

            {tab === 'overview' && (
              <div className="space-y-4">
                <OverviewNew leads={filtered} />
                <OverviewTab leads={filtered} mode={mode} onDrill={handleDrill} filteredNote={filteredNote} />
              </div>
            )}
            {tab === 'acquire' && <AcquireGroup leads={filtered} mode={mode} onDrill={handleDrill} />}
            {tab === 'quality' && <QualityGroup leads={filtered} mode={mode} onDrill={handleDrill} />}
            {tab === 'leads' && (
              <LeadsModule leads={filtered} drill={drill} onClearDrill={() => setDrill(null)} newIds={data.newIds} />
            )}
          </>
        ) : (
          data.ingest.state.status !== 'parsing' &&
          data.dbStatus !== 'loading' && (
            <div className="card text-center text-sm text-slate-500">
              {data.supabaseConfigured
                ? data.dbStatus === 'ready'
                  ? `Không có dữ liệu trong khoảng đã chọn${data.rangeLabel ? ` (${data.rangeLabel})` : ''} — thử khoảng khác hoặc nạp file CSV wholesale.`
                  : 'Đang tải dữ liệu từ Supabase, hoặc nạp file CSV wholesale để phân tích file riêng.'
                : 'Nạp file CSV wholesale để bắt đầu phân tích. File 67MB vẫn parse được — quá trình chạy nền trong Web Worker.'}
            </div>
          )
        )}
      </div>
    </div>
  );
}
