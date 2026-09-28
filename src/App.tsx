import { useMemo, useState } from 'react';
import { useIngest } from '@/hooks/useIngest';
import { UploadPanel } from '@/components/UploadPanel';
import { OverviewModule } from '@/components/OverviewModule';
import { ChannelModule, ModeToggle } from '@/components/ChannelModule';
import { ActionBoardModule, CreativeModule } from '@/components/ActionBoardModule';
import { BrandModule, FirmographicModule, GeoModule } from '@/components/AnalysisModules';
import { TrendModule } from '@/components/TrendModule';
import { LeadExplorer } from '@/components/LeadExplorerModule';
import type { MetricMode } from '@/types/lead';

const TABS = [
  { key: 'overview', label: 'Tổng quan' },
  { key: 'action', label: 'Action Board' },
  { key: 'channel', label: 'Kênh' },
  { key: 'creative', label: 'Creative' },
  { key: 'geo', label: 'Geo' },
  { key: 'firmographic', label: 'Firmographic' },
  { key: 'brand', label: 'Brand' },
  { key: 'trend', label: 'Xu hướng' },
  { key: 'leads', label: 'Lead Explorer' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function App() {
  const { state, parseFile, reset } = useIngest();
  const [tab, setTab] = useState<TabKey>('overview');
  const [mode, setMode] = useState<MetricMode>('unique');

  const ready = state.status === 'ready' && state.leads.length > 0;
  const uniqueCount = useMemo(() => new Set(state.leads.map((l) => l.leadKey)).size, [state.leads]);

  return (
    <div className="mx-auto min-h-screen max-w-[1400px] px-4 py-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">QH Distribution — Lead Quality Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Phân tích chất lượng lead để tối ưu performance marketing. MQL rate là proxy tổng budget —
            khi có dữ liệu chi phí ads, các segment sẽ chuyển từ "Needs Spend Data" sang quyết định scale.
          </p>
        </div>
        {ready && (
          <div className="flex items-center gap-2">
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
        )}
      </header>

      <div className="space-y-4">
        <UploadPanel
          onFile={parseFile}
          status={state.status}
          progress={state.progress}
          error={state.error}
          fileName={state.fileName}
          onReset={reset}
        />

        {state.warnings.length > 0 && (
          <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {state.warnings.join(' · ')}
          </div>
        )}

        {ready ? (
          <>
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
                </button>
              ))}
            </nav>

            <p className="text-xs text-slate-600">
              Mặc định mọi phân tích dùng {uniqueCount.toLocaleString('vi-VN')} contact duy nhất, không tính lead gửi
              trùng. Dùng bộ chuyển denominator phía trên để xem lưu lượng thô.
            </p>

            {tab === 'overview' && <OverviewModule leads={state.leads} />}
            {tab === 'action' && <ActionBoardModule leads={state.leads} mode={mode} />}
            {tab === 'channel' && (
              <ChannelModule leads={state.leads} mode={mode} onModeChange={setMode} />
            )}
            {tab === 'creative' && <CreativeModule leads={state.leads} mode={mode} />}
            {tab === 'geo' && <GeoModule leads={state.leads} mode={mode} />}
            {tab === 'firmographic' && <FirmographicModule leads={state.leads} mode={mode} />}
            {tab === 'brand' && <BrandModule leads={state.leads} mode={mode} />}
            {tab === 'trend' && <TrendModule leads={state.leads} />}
            {tab === 'leads' && <LeadExplorer leads={state.leads} />}
          </>
        ) : (
          state.status !== 'parsing' && (
            <div className="card text-center text-sm text-slate-500">
              Nạp file CSV wholesale để bắt đầu phân tích. File 67MB vẫn parse được — quá trình chạy nền
              trong Web Worker.
            </div>
          )
        )}
      </div>
    </div>
  );
}
