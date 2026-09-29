import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIngest } from '@/hooks/useIngest';
import { fetchSupabaseLeads } from '@/lib/supabaseLeads';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { Lead } from '@/types/lead';

export type DataSource = 'supabase' | 'csv';

/**
 * Nguồn dữ liệu hợp nhất (GĐ2-Q3):
 * - Mặc định load Supabase (leads_public full-load ≤50k).
 * - CSV upload UNION in-memory, dedupe theo submission_id.
 * - Dòng CSV mới gắn cờ "chưa lưu DB" (persist qua seed script service_role).
 */
export function useDataSource() {
  const ingest = useIngest();
  const [dbLeads, setDbLeads] = useState<Lead[]>([]);
  const [dbStatus, setDbStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'unconfigured'>('idle');
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbLoaded, setDbLoaded] = useState(0);
  const [source, setSource] = useState<DataSource>('supabase');

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
