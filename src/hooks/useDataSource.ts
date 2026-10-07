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
 * Nguồn dữ liệu hợp nhất (Phase B + load-lien-custom-date + tang-toc-load-hien-ngay):
 * - Load PROGRESSIVE: publish page đầu ngay (first paint), các page còn lại
 *   fetch song song theo batch, chỉ commit prefix liên tục theo seq.
 * - Guard requestId trên MỌI nhánh async (progress/resolve/reject); request thất
 *   bại đánh dấu terminal để page về muộn cùng request bị loại.
 * - Giữ cặp rows+label cũ tới khi page đầu range mới về; range rỗng (count = 0)
 *   vẫn là success có commit (rows rỗng + label mới + 0/0 + ready).
 * - `lastCompleteSnapshot` giữ riêng snapshot hoàn chỉnh của lần success gần nhất
 *   (kể cả rỗng), chỉ cập nhật khi success; lỗi restore nguyên bộ từ đó, chưa
 *   từng success thì hiện lỗi + retry (không gán ready).
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
  /** Request đã kết thúc lỗi — page về muộn cùng request bị loại (terminal). */
  const terminalRef = useRef(0);
  /** Snapshot hoàn chỉnh của lần success gần nhất (kể cả rỗng) — nguồn restore
   * duy nhất khi lỗi. Partial giữa chừng không bao giờ ghi vào đây. */
  interface CompleteSnapshot {
    rows: Lead[];
    label: string | null;
    loaded: number;
    total: number;
    undated: number;
    months: { from: string; to: string } | null;
  }
  const lastCompleteRef = useRef<CompleteSnapshot | null>(null);
  // Prefill Custom luôn từ snapshot hoàn chỉnh, không từ applied/draft.
  const committedMonthsRef = useRef<{ from: string; to: string } | null>(null);
  /** true khi request đang chạy đã publish ít nhất 1 partial (đã chuyển sang
   * rows+label MỚI). False ở khoảng gap giữ snapshot cũ chờ page đầu. */
  const [dbPartial, setDbPartial] = useState(false);

  const loadSupabase = useCallback(async (nextApplied?: AppliedRange) => {
    if (!isSupabaseConfigured()) {
      setDbStatus('unconfigured');
      return;
    }
    const activeApplied = nextApplied ?? appliedRef.current;
    const myId = requestIdRef.current + 1;
    requestIdRef.current = myId;
    const isCurrent = () => requestIdRef.current === myId && terminalRef.current !== myId;
    setDbStatus('loading');
    setDbError(null);
    // Giữ nguyên rows+label+counters+cờ partial cũ tới khi page đầu range mới
    // về (P3 + fix ISSUE-2 impl-REV1): gap sau partial vẫn hiện loaded/total và
    // cảnh báo "chưa đủ" của snapshot đang hiển thị; chỉ xóa cờ khi success /
    // restore snapshot hoàn chỉnh. KHÔNG reset ở đây.
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
        (loaded, leadsSoFar, total) => {
          // Commit dần prefix liên tục: chuyển sang rows+label MỚI + cờ partial.
          if (!isCurrent()) return;
          setDbLeads(leadsSoFar);
          setDbLoaded(loaded);
          setDbTotal(total);
          setRangeLabel(label);
          setDbPartial(true);
        },
      );
      if (!isCurrent()) return;
      // Success (kể cả rỗng khi count = 0): commit đồng bộ rows + label mới +
      // counters, cập nhật lastCompleteSnapshot.
      setDbLeads(result.rows);
      setDbLoaded(result.loadedCount);
      setDbTotal(result.totalCount);
      setDbUndated(result.undatedCount);
      setRangeLabel(label);
      const months = monthFrom && monthTo ? { from: monthFrom, to: monthTo } : null;
      committedMonthsRef.current = months;
      lastCompleteRef.current = {
        rows: result.rows,
        label,
        loaded: result.loadedCount,
        total: result.totalCount,
        undated: result.undatedCount,
        months,
      };
      setDbPartial(false);
      setDbStatus('ready');
    } catch (e) {
      // Fix ISSUE-1 impl-REV1: chỉ request HIỆN HÀNH mới được đánh dấu terminal
      // và restore. Request cũ lỗi muộn (đã bị supersede) return im lặng, không
      // được đổi terminal của request mới — nếu không page về muộn của request
      // mới sẽ vượt guard và ghi đè snapshot vừa restore.
      if (requestIdRef.current !== myId || terminalRef.current === myId) return;
      // Đánh dấu terminal để page song song về muộn cùng request (Promise.all
      // còn chạy) bị loại, không đụng snapshot đã restore.
      terminalRef.current = myId;
      const message = e instanceof Error ? e.message : 'Không tải được Supabase';
      const snap = lastCompleteRef.current;
      if (!snap) {
        // Chưa từng success mà đã lỗi (kể cả sau partial): loại partial DB khỏi
        // hiển thị + reset metadata partial (fix ISSUE-3 impl-REV1) — dashboard
        // không được trình bày aggregate thiếu như số cuối. Hiện lỗi + retry,
        // KHÔNG gán ready cho snapshot không tồn tại. CSV fallback (nếu có)
        // vẫn hiện bình thường qua logic combined/visibleLeads.
        setDbLeads([]);
        setDbLoaded(0);
        setDbTotal(0);
        setDbUndated(0);
        setRangeLabel(null);
        setDbPartial(false);
        setDbError(message);
        setDbStatus('error');
      } else {
        // Restore NGUYÊN BỘ snapshot hoàn chỉnh gần nhất + banner, trả về ready
        // để hiện lại dashboard cũ thay vì kẹt skeleton.
        setDbLeads(snap.rows);
        setRangeLabel(snap.label);
        setDbLoaded(snap.loaded);
        setDbTotal(snap.total);
        setDbUndated(snap.undated);
        setDbPartial(false);
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
    // Progressive: loading nhưng đã có dbLeads (snapshot cũ trong gap hoặc
    // partial mới) thì vẫn hiện — chỉ khi chưa có rows nào mới fallback CSV.
    const dbHasRows = dbLeads.length > 0 && (dbStatus === 'ready' || dbStatus === 'loading');
    if (!dbHasRows) {
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

  const visibleLeads =
    source === 'supabase' && (dbStatus === 'ready' || (dbStatus === 'loading' && dbLeads.length > 0))
      ? combined
      : csvLeads.length > 0
        ? combined
        : dbLeads;

  return {
    ingest,
    dbStatus,
    dbError,
    dbLoaded,
    dbTotal,
    dbUndated,
    dbPartial,
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
