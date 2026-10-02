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

/**
 * Nguồn dữ liệu hợp nhất (Phase B):
 * - Mặc định load Supabase preset 1 tháng gần nhất (neo dữ liệu, +07).
 * - Preset 1/3/6/tất cả lọc + paging server-side (submitted_at_ts).
 * - Aggregates pha 1 vẫn client-side trên rows của range đã fetch.
 * - CSV upload UNION in-memory, dedupe theo submission_id.
 * - CSV mới parse xong tự lưu DB qua Edge Function `ingest-leads`
 *   (service_role nằm trong function secrets, anon key không ghi trực tiếp).
 */
export function useDataSource() {
  const ingest = useIngest();
  const [dbLeads, setDbLeads] = useState<Lead[]>([]);
  const [dbStatus, setDbStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'unconfigured'>('idle');
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbLoaded, setDbLoaded] = useState(0);
  const [dbTotal, setDbTotal] = useState(0);
  const [dbUndated, setDbUndated] = useState(0);
  const [dbLoadingMore, setDbLoadingMore] = useState(false);
  const [preset, setPresetState] = useState<RangePreset>('1m');
  const [rangeLabel, setRangeLabel] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>('supabase');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveProgress, setSaveProgress] = useState<SaveProgress | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedForRef = useRef<string | null>(null);
  const savingForRef = useRef<string | null>(null);
  const presetRef = useRef<RangePreset>('1m');

  const loadSupabase = useCallback(async (nextPreset?: RangePreset) => {
    if (!isSupabaseConfigured()) {
      setDbStatus('unconfigured');
      return;
    }
    const activePreset = nextPreset ?? presetRef.current;
    setDbStatus((prev) => (prev === 'ready' ? prev : 'loading'));
    setDbLoadingMore(true);
    setDbError(null);
    try {
      const anchor = await fetchRangeAnchor();
      const custom = monthRangeFromAnchor(anchor.maxSubmittedAtTs ?? '', activePreset);
      setRangeLabel(
        activePreset === 'all'
          ? null
          : custom
            ? `${custom.monthFrom} → ${custom.monthTo}`
            : anchor.maxSubmittedAtTs
              ? 'chưa xác định tháng'
              : 'chưa có dữ liệu ngày',
      );
      const result = await fetchLeadsByRange(
        {
          preset: activePreset,
          monthFrom: custom?.monthFrom ?? null,
          monthTo: custom?.monthTo ?? null,
          anchorIso: anchor.maxSubmittedAtTs,
        },
        (loaded, leadsSoFar, total) => {
          setDbLoaded(loaded);
          setDbTotal(total);
          // Hiện dashboard ngay từ page đầu, các page sau cập nhật nền.
          if (leadsSoFar.length > 0) {
            setDbLeads(leadsSoFar);
            setDbStatus('ready');
          }
        },
      );
      setDbLeads(result.rows);
      setDbLoaded(result.loadedCount);
      setDbTotal(result.totalCount);
      setDbUndated(result.undatedCount);
      setDbStatus('ready');
      setDbLoadingMore(false);
    } catch (e) {
      setDbLoadingMore(false);
      // Đã có dữ liệu partial thì giữ dashboard, không lật sang error.
      setDbLeads((prev) => {
        if (prev.length === 0) {
          setDbError(e instanceof Error ? e.message : 'Không tải được Supabase');
          setDbStatus('error');
        }
        return prev;
      });
    }
  }, []);

  const setPreset = useCallback(
    (next: RangePreset) => {
      presetRef.current = next;
      setPresetState(next);
      void loadSupabase(next);
    },
    [loadSupabase],
  );

  useEffect(() => {
    loadSupabase();
  }, [loadSupabase]);

  // Tự lưu CSV vừa parse vào DB qua Edge Function. Lỗi lưu không làm mất
  // csvLeads in-memory — dashboard vẫn phân tích bình thường.
  // Key = checksum submissionIds đã dedupe: file khác cùng tên/count không
  // bị skip nhầm; chỉ đánh dấu saved SAU khi finalize thành công nên lỗi
  // mạng vẫn retry được (guard bằng savingFor, không phải savedFor).
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
    dbLoadingMore,
    dbCount: dbLeads.length,
    csvCount: csvLeads.length,
    preset,
    rangeLabel,
    setPreset,
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
