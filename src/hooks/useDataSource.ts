import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIngest } from '@/hooks/useIngest';
import {
  fetchLeadsByRange,
  fetchRangeAnchor,
  type RangePreset,
} from '@/lib/supabaseLeads';
import { monthRangeFromAnchor } from '@/lib/submittedAt';
import { dedupeForSave, saveKeyOf, saveLeadsToDb, type SaveProgress } from '@/lib/ingestApi';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { Lead } from '@/types/lead';

export type DataSource = 'supabase' | 'csv';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'skipped';

/** Cấu hình server-range đã apply (duy nhất được fetch). Tách khỏi editor selection. */
export type AppliedRange =
  | { preset: '1m' | '3m' | '6m' | 'all' }
  | { preset: 'custom'; from: string; to: string };

export interface CustomDraft {
  from: string;
  to: string;
}

/** Draft hợp lệ khi cả 2 non-empty và from <= to (so chuỗi YYYY-MM). */
export function isCustomDraftValid(draft: CustomDraft): boolean {
  return Boolean(draft.from && draft.to && draft.from <= draft.to);
}

/**
 * Nguồn dữ liệu hợp nhất (Phase B + load-lien-custom-date):
 * - Load BLOCKING: mọi request server-range chỉ commit 1 lần khi đủ,
 *   App ẩn dashboard trong mọi loading (skeleton), không render partial.
 * - Guard requestId trên MỌI nhánh async (progress/resolve/reject).
 * - Reload lỗi giữ snapshot đã commit + banner lỗi, không trắng trang.
 * - Custom month From-To: editorPreset/customDraft tách khỏi applied;
 *   reload (kể cả sau save CSV) luôn dùng applied.
 */
export function useDataSource() {
  const ingest = useIngest();
  const [dbLeads, setDbLeads] = useState<Lead[]>([]);
  const [dbStatus, setDbStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'unconfigured'>('idle');
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbLoaded, setDbLoaded] = useState(0);
  const [dbTotal, setDbTotal] = useState(0);
  const [dbUndated, setDbUndated] = useState(0);
  const [editorPreset, setEditorPresetState] = useState<RangePreset>('1m');
  const [customDraft, setCustomDraftState] = useState<CustomDraft>({ from: '', to: '' });
  const [rangeLabel, setRangeLabel] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>('supabase');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveProgress, setSaveProgress] = useState<SaveProgress | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedForRef = useRef<string | null>(null);
  const savingForRef = useRef<string | null>(null);
  const appliedRef = useRef<AppliedRange>({ preset: '1m' });
  const requestIdRef = useRef(0);
  const committedRef = useRef(false);
  // Snapshot đã commit (hiển thị trên dashboard) — tách khỏi applied (cấu hình
  // request). Prefill Custom luôn từ snapshot này, không từ applied/draft.
  const committedMonthsRef = useRef<{ from: string; to: string } | null>(null);
  const committedCountersRef = useRef<{ loaded: number; total: number; undated: number } | null>(null);

  const loadSupabase = useCallback(async (nextApplied?: AppliedRange) => {
    if (!isSupabaseConfigured()) {
      setDbStatus('unconfigured');
      return;
    }
    const activeApplied = nextApplied ?? appliedRef.current;
    const myId = requestIdRef.current + 1;
    requestIdRef.current = myId;
    const isCurrent = () => requestIdRef.current === myId;
    setDbStatus('loading');
    setDbError(null);
    // Reset counters của request mới để skeleton/header không hiện số của
    // request cũ (vd 1800/1800) trong lúc chờ anchor/count đầu. Snapshot đã
    // commit giữ trong committedCountersRef để reload lỗi còn restore được.
    setDbLoaded(0);
    setDbTotal(0);
    try {
      const anchor = await fetchRangeAnchor();
      if (!isCurrent()) return;
      let monthFrom: string | null = null;
      let monthTo: string | null = null;
      let label: string | null = null;
      if (activeApplied.preset === 'all') {
        label = null;
      } else if (activeApplied.preset === 'custom') {
        monthFrom = activeApplied.from;
        monthTo = activeApplied.to;
        label = `${activeApplied.from} → ${activeApplied.to}`;
      } else {
        const custom = monthRangeFromAnchor(anchor.maxSubmittedAtTs ?? '', activeApplied.preset);
        monthFrom = custom?.monthFrom ?? null;
        monthTo = custom?.monthTo ?? null;
        label =
          custom
            ? `${custom.monthFrom} → ${custom.monthTo}`
            : anchor.maxSubmittedAtTs
              ? 'chưa xác định tháng'
              : 'chưa có dữ liệu ngày';
      }
      const result = await fetchLeadsByRange(
        {
          preset: activeApplied.preset,
          monthFrom,
          monthTo,
          anchorIso: anchor.maxSubmittedAtTs,
        },
        (loaded, _leadsSoFar, total) => {
          // Chỉ progress counters, KHÔNG set leads giữa chừng.
          if (!isCurrent()) return;
          setDbLoaded(loaded);
          setDbTotal(total);
        },
      );
      if (!isCurrent()) return;
      setDbLeads(result.rows);
      setDbLoaded(result.loadedCount);
      setDbTotal(result.totalCount);
      setDbUndated(result.undatedCount);
      setRangeLabel(label);
      // Ghi snapshot đã commit: có bounds thì giữ, preset all thì null
      // (mở Custom sau khi xem all → draft rỗng, không dùng range cũ).
      committedMonthsRef.current = monthFrom && monthTo ? { from: monthFrom, to: monthTo } : null;
      committedRef.current = true;
      committedCountersRef.current = {
        loaded: result.loadedCount,
        total: result.totalCount,
        undated: result.undatedCount,
      };
      setDbStatus('ready');
    } catch (e) {
      if (!isCurrent()) return;
      const message = e instanceof Error ? e.message : 'Không tải được Supabase';
      if (!committedRef.current) {
        setDbError(message);
        setDbStatus('error');
      } else {
        // Giữ snapshot đã commit, chỉ hiện banner lỗi — trả status về ready
        // để App hiện lại dashboard cũ thay vì kẹt skeleton. Restore counters
        // đã commit để header không cặp total mới + rows/label cũ.
        const snap = committedCountersRef.current;
        if (snap) {
          setDbLoaded(snap.loaded);
          setDbTotal(snap.total);
          setDbUndated(snap.undated);
        }
        setDbError(message);
        setDbStatus('ready');
      }
    }
  }, []);

  const setPreset = useCallback(
    (next: Exclude<RangePreset, 'custom'>) => {
      const applied: AppliedRange = { preset: next };
      appliedRef.current = applied;
      setEditorPresetState(next);
      void loadSupabase(applied);
    },
    [loadSupabase],
  );

  /** Mở editor Custom: prefill từ snapshot ĐÃ COMMIT (đang hiển thị),
   * KHÔNG từ applied/draft. Chỉ đổi highlight, KHÔNG fetch. */
  const openCustom = useCallback(() => {
    setEditorPresetState('custom');
    const snap = committedMonthsRef.current;
    setCustomDraftState(snap ? { ...snap } : { from: '', to: '' });
  }, []);

  const setCustomDraft = useCallback((draft: CustomDraft) => {
    setCustomDraftState(draft);
  }, []);

  /** Áp dụng draft hợp lệ: set applied custom + fetch. Draft thiếu/đảo → no-op. */
  const applyCustom = useCallback(() => {
    if (!isCustomDraftValid(customDraft)) return;
    const applied: AppliedRange = { preset: 'custom', from: customDraft.from, to: customDraft.to };
    appliedRef.current = applied;
    setEditorPresetState('custom');
    void loadSupabase(applied);
  }, [loadSupabase, customDraft]);

  useEffect(() => {
    loadSupabase();
  }, [loadSupabase]);

  // Tự lưu CSV vừa parse vào DB qua Edge Function. Lỗi lưu không làm mất
  // csvLeads in-memory — dashboard vẫn phân tích bình thường.
  // Key = checksum submissionIds đã dedupe: file khác cùng tên/count không
  // bị skip nhầm; chỉ đánh dấu saved SAU khi finalize thành công nên lỗi
  // mạng vẫn retry được (guard bằng savingFor, không phải savedFor).
  // Reload sau save dùng applied hiện tại (không dùng draft/editor).
  useEffect(() => {
    const st = ingest.state;
    if (st.status === 'idle') {
      savedForRef.current = null;
      savingForRef.current = null;
      return;
    }
    if (st.status === 'parsing') {
      setSaveStatus('idle');
      setSaveProgress(null);
      setSaveError(null);
      return;
    }
    if (st.status !== 'ready' || st.leads.length === 0) return;
    const items = dedupeForSave(st.leads, st.raw);
    const key = saveKeyOf(st.fileName ?? '', items);
    if (savedForRef.current === key || savingForRef.current === key) return;
    if (!isSupabaseConfigured()) {
      setSaveStatus('skipped');
      return;
    }
    savingForRef.current = key;
    setSaveStatus('saving');
    setSaveProgress({ saved: 0, total: items.length });
    setSaveError(null);
    saveLeadsToDb(st.leads, st.raw, st.fileName ?? 'upload.csv', st.totalRows, setSaveProgress)
      .then(({ saveKey }) => {
        savingForRef.current = null;
        savedForRef.current = saveKey;
        setSaveStatus('saved');
        setSaveProgress(null);
        loadSupabase();
      })
      .catch((e) => {
        savingForRef.current = null;
        setSaveError(e instanceof Error ? e.message : 'Không lưu được DB');
        setSaveStatus('error');
      });
  }, [ingest.state, loadSupabase]);

  const csvLeads = useMemo(
    () => (ingest.state.status === 'ready' ? ingest.state.leads : []),
    [ingest.state.status, ingest.state.leads],
  );

  const { combined, newIds } = useMemo(() => {
    if (dbStatus !== 'ready' || dbLeads.length === 0) {
      return { combined: csvLeads, newIds: new Set(csvLeads.map((l) => l.submissionId)) };
    }
    if (csvLeads.length === 0) return { combined: dbLeads, newIds: new Set<string>() };
    const seen = new Set(dbLeads.map((l) => l.submissionId));
    const extra = csvLeads.filter((l) => !seen.has(l.submissionId));
    return {
      combined: [...dbLeads, ...extra],
      newIds: new Set(extra.map((l) => l.submissionId)),
    };
  }, [dbLeads, dbStatus, csvLeads]);

  const visibleLeads = source === 'supabase' && dbStatus === 'ready' ? combined : csvLeads.length > 0 ? combined : dbLeads;

  return {
    ingest,
    dbStatus,
    dbError,
    dbLoaded,
    dbTotal,
    dbUndated,
    dbCount: dbLeads.length,
    csvCount: csvLeads.length,
    preset: editorPreset,
    rangeLabel,
    setPreset,
    openCustom,
    customDraft,
    setCustomDraft,
    applyCustom,
    customValid: isCustomDraftValid(customDraft),
    saveStatus,
    saveProgress,
    saveError,
    combined,
    newIds,
    visibleLeads,
    source,
    setSource,
    reloadDb: loadSupabase,
    supabaseReady: dbStatus === 'ready',
    supabaseConfigured: isSupabaseConfigured(),
  };
}
