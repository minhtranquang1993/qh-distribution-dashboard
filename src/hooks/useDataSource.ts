import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIngest } from '@/hooks/useIngest';
import { fetchSupabaseLeads } from '@/lib/supabaseLeads';
import { dedupeForSave, saveKeyOf, saveLeadsToDb, type SaveProgress } from '@/lib/ingestApi';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { Lead } from '@/types/lead';

export type DataSource = 'supabase' | 'csv';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'skipped';

/**
 * Nguồn dữ liệu hợp nhất (GĐ2-Q3):
 * - Mặc định load Supabase (leads_public full-load ≤50k).
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
  const [source, setSource] = useState<DataSource>('supabase');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveProgress, setSaveProgress] = useState<SaveProgress | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedForRef = useRef<string | null>(null);
  const savingForRef = useRef<string | null>(null);

  const loadSupabase = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setDbStatus('unconfigured');
      return;
    }
    setDbStatus('loading');
    setDbError(null);
    try {
      const leads = await fetchSupabaseLeads(setDbLoaded);
      setDbLeads(leads);
      setDbStatus('ready');
    } catch (e) {
      setDbError(e instanceof Error ? e.message : 'Không tải được Supabase');
      setDbStatus('error');
    }
  }, []);

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
    dbCount: dbLeads.length,
    csvCount: csvLeads.length,
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
