import type { Lead, LeadTier, UtmSet } from '@/types/lead';
import { splitBrands } from '@/lib/normalize';
import { supabaseClient } from '@/lib/supabase';
import {
  monthRangeFromAnchor,
  rangeBounds,
  type RangePreset,
} from '@/lib/submittedAt';

export type { RangePreset };

/** Một dòng của view public.leads_public (không PII, không lead_key_hash). */
export interface PublicLeadRow {
  id: string;
  batch_id: string;
  submission_id: string;
  submitted_at: string;
  /** Cột mới từ migration 003; bản DB cũ chưa chạy migration thì null. */
  submitted_at_ts: string | null;
  raw_url: string;
  raw_first_source_url: string;
  first_user_source: string;
  first_user_medium: string;
  location: string;
  brands_raw: string;
  budget_raw: string;
  budget_bucket: string;
  registered_country: string;
  distribute_country: string;
  type_company: string;
  how_know: string;
  contact_pref: string;
  week_num: number | null;
  month_num: number | null;
  day_num: number | null;
  score: number;
  tier: string;
  gate_failed: boolean;
  spam_signals: string[];
  geo_mismatch: boolean;
  severe_geo_mismatch: boolean;
  email_valid: boolean;
  phone_valid: boolean;
  duplicate_count: number;
  attribution_basis: string;
  contact_group: string;
  seq: number | null;
  utm: {
    submit: UtmSet;
    first_touch: UtmSet;
    chosen: UtmSet;
  };
}

const EMPTY_UTM: UtmSet = { source: '', medium: '', term: '', content: '', campaign: '' };

function utmOf(value: unknown): UtmSet {
  if (!value || typeof value !== 'object') return { ...EMPTY_UTM };
  const v = value as Partial<UtmSet>;
  return {
    source: String(v.source ?? ''),
    medium: String(v.medium ?? ''),
    term: String(v.term ?? ''),
    content: String(v.content ?? ''),
    campaign: String(v.campaign ?? ''),
  };
}

function tierOf(value: string): LeadTier {
  return value === 'MQL' || value === 'Nurture' || value === 'Low' ? value : 'Review';
}

function basisOf(value: string): Lead['attributionBasis'] {
  return value === 'submit_url' || value === 'first_source_fallback' ? value : 'unknown';
}

/**
 * Map 1 dòng leads_public → Lead. PII để trống (anon không bao giờ thấy).
 * leadKey = contact_group (UUID ngẫu nhiên theo contact trong batch):
 * đủ để uniqueContacts/dedupe chạy đúng mà không lộ hash PII.
 */
export function publicRowToLead(row: PublicLeadRow): Lead {
  return {
    submissionId: row.submission_id,
    submittedAt: row.submitted_at ?? '',
    email: '',
    phone: '',
    name: '',
    company: '',
    location: row.location ?? '',
    registeredCountry: row.registered_country ?? '',
    distributeCountry: row.distribute_country ?? '',
    budgetBucket: (row.budget_bucket || 'Below $5,000') as Lead['budgetBucket'],
    typeCompany: row.type_company || 'Others',
    howKnow: row.how_know ?? '',
    contactPref: row.contact_pref ?? '',
    website: '',
    brands: splitBrands(row.brands_raw ?? ''),
    submitUtm: utmOf(row.utm?.submit),
    firstTouchUtm: utmOf(row.utm?.first_touch),
    chosenUtm: utmOf(row.utm?.chosen),
    attributionBasis: basisOf(row.attribution_basis),
    firstUserSource: row.first_user_source ?? '',
    firstUserMedium: row.first_user_medium ?? '',
    firstSourceUrl: row.raw_first_source_url ?? '',
    geoMismatch: Boolean(row.geo_mismatch),
    severeGeoMismatch: Boolean(row.severe_geo_mismatch),
    emailValid: Boolean(row.email_valid),
    phoneValid: Boolean(row.phone_valid),
    // isDuplicate tính lại sau fetch theo thứ tự submission (cùng contact_group,
    // dòng đầu giữ false, các dòng sau true) — khớp semantics transformRows.
    isDuplicate: false,
    duplicateCount: row.duplicate_count ?? 1,
    spamSignals: Array.isArray(row.spam_signals) ? row.spam_signals : [],
    score: row.score ?? 0,
    tier: tierOf(row.tier),
    gateFailed: Boolean(row.gate_failed),
    leadKey: row.contact_group,
  };
}

/**
 * Gán lại isDuplicate theo contact_group sau khi sort theo submissionId
 * (khớp semantics transformRows: earliest giữ false).
 */
export function assignDuplicates(leads: Lead[]): Lead[] {
  const seen = new Set<string>();
  return leads.map((lead) => {
    const dup = seen.has(lead.leadKey);
    seen.add(lead.leadKey);
    return { ...lead, isDuplicate: dup };
  });
}

const PAGE = 1000;

/** Số page fetch song song trong 1 batch (cân bằng tốc độ / spike request). */
const PAGE_CONCURRENCY = 6;

export interface RangeFetchResult {
  rows: Lead[];
  /** Tổng dòng server-side (count exact) — hiển thị header, KHÔNG phải rows.length. */
  totalCount: number;
  /** Số rows đã accumulate qua các page. */
  loadedCount: number;
  /** Preset hiệu lực (fallback về 'all' khi không anchor) — đúng contract Gate 2. */
  rangePreset: RangePreset;
  /** Số dòng không có ngày (submitted_at_ts null) — chỉ đếm khi lọc theo tháng. */
  undatedCount: number;
}

/** Anchor mặc định: max submitted_at_ts qua leads_public (KHÔNG suy từ page đầu).
 * Pre-migration (DB chưa có cột) thì trả null để fetch fallback về preset all. */
export async function fetchRangeAnchor(): Promise<{ maxSubmittedAtTs: string | null }> {
  const client = supabaseClient();
  if (!client) throw new Error('Supabase chưa cấu hình (thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  const { data, error } = await client
    .from('leads_public')
    .select('submitted_at_ts')
    .not('submitted_at_ts', 'is', null)
    .order('submitted_at_ts', { ascending: false })
    .limit(1);
  if (error) {
    if (/submitted_at_ts/i.test(error.message)) return { maxSubmittedAtTs: null };
    throw new Error(`Supabase read failed: ${error.message}`);
  }
  const row = (data as Array<{ submitted_at_ts: string | null }> | null)?.[0];
  return { maxSubmittedAtTs: row?.submitted_at_ts ?? null };
}

interface DateFilter {
  gte: string;
  lt: string;
}

function applyDateFilter<T>(
  query: T,
  filter: DateFilter | null,
  gteFn: (q: T, col: string, v: string) => T,
  ltFn: (q: T, col: string, v: string) => T,
): T {
  if (!filter) return query;
  return ltFn(gteFn(query, 'submitted_at_ts', filter.gte), 'submitted_at_ts', filter.lt);
}

function resolveDateFilter(
  monthFrom: string | null,
  monthTo: string | null,
  preset: RangePreset,
  anchorIso: string | null,
): DateFilter | null {
  if (preset === 'all') return null;
  // Custom bắt buộc có bounds từ applied (lỗi code nếu thiếu) — không suy từ anchor.
  if (preset === 'custom') {
    if (monthFrom && monthTo) return rangeBounds(monthFrom, monthTo);
    throw new Error('Custom range thiếu monthFrom/monthTo (lỗi code: reload phải dùng applied)');
  }
  if (monthFrom && monthTo) return rangeBounds(monthFrom, monthTo);
  if (!anchorIso) return null;
  const range = monthRangeFromAnchor(anchorIso, preset);
  if (!range) return null;
  return rangeBounds(range.monthFrom, range.monthTo);
}

/** Fetch leads theo time-range + paging server, ORDER BY seq ổn định.
 * seq = vị trí dòng trong file (import script ghi). Không sort TEXT theo
 * submission_id ('100000' < '68876') — nó đổi representative của contact group
 * và làm lệch tier (parity AC6).
 * Dừng loop theo totalCount (count exact), KHÔNG dùng `data.length < PAGE`
 * làm điều kiện duy nhất — PostgREST cap nhỏ hơn PAGE sẽ dừng sớm (bug 1000).
 * Progressive (tang-toc-load-hien-ngay): page 0 fetch riêng rồi publish ngay
 * (first paint), các page còn lại fetch song song theo batch PAGE_CONCURRENCY.
 * Chỉ publish prefix LIÊN TỤC từ page 0 theo `seq` — page về sớm ngoài prefix
 * (vd có page 0+3 mà thiếu 1-2) thì giữ lại, chưa publish. Mỗi lần publish chạy
 * lại `assignDuplicates` trên toàn bộ prefix. `totalCount === 0` là success rỗng
 * (không fetch page). `totalCount > 0` mà page đầu rỗng là không nhất quán
 * (count/page lệch do dữ liệu đổi giữa các query) → throw để consumer restore.
 * onProgress(loaded, leadsSoFar, total) để consumer commit dần có guard;
 * consumer KHÔNG được coi partial là số cuối (chỉ `ready` mới là số cuối).
 * Preset 'custom' bắt buộc có monthFrom/monthTo (từ applied). */
export async function fetchLeadsByRange(
  options: {
    preset: RangePreset;
    /** Bounds explicit cho preset 'custom' (từ applied); preset chuẩn suy từ anchor. */
    monthFrom?: string | null;
    monthTo?: string | null;
    anchorIso?: string | null;
  },
  onProgress?: (loaded: number, leadsSoFar: Lead[], total: number) => void,
): Promise<RangeFetchResult> {
  const { preset } = options;
  const supabase = supabaseClient();
  if (!supabase) throw new Error('Supabase chưa cấu hình (thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  const client = supabase;
  const anchorIso = options.anchorIso ?? (await fetchRangeAnchor()).maxSubmittedAtTs;
  // Pre-migration (hoặc DB toàn dòng không ngày): không anchor thì không lọc
  // server được (WHERE cột chưa tồn tại sẽ lỗi). Preset chuẩn fallback về
  // 'all' để dashboard vẫn chạy — rangeLabel ở useDataSource báo rõ trạng thái.
  // Riêng 'custom' có bounds explicit thì GIỮ NGUYÊN (không fallback all):
  // fallback all với label custom sẽ hiện sai dữ liệu, thà để query lỗi
  // và hook hiện error còn trung thực hơn.
  const effectivePreset: RangePreset =
    anchorIso === null && preset !== 'all' && preset !== 'custom' ? 'all' : preset;
  const filter =
    effectivePreset === 'all'
      ? null
      : resolveDateFilter(
          options.monthFrom ?? null,
          options.monthTo ?? null,
          effectivePreset,
          anchorIso,
        );

  let countQuery = client.from('leads_public').select('id', { count: 'exact', head: true });
  countQuery = applyDateFilter(
    countQuery,
    filter,
    (q, col, v) => q.gte(col, v),
    (q, col, v) => q.lt(col, v),
  );
  const { count, error: countErr } = await countQuery;
  if (countErr) throw new Error(`Supabase count failed: ${countErr.message}`);
  const totalCount = count ?? 0;

  let undatedCount = 0;
  if (filter) {
    const { count: undated, error: undatedErr } = await client
      .from('leads_public')
      .select('id', { count: 'exact', head: true })
      .is('submitted_at_ts', null);
    if (undatedErr) throw new Error(`Supabase count failed: ${undatedErr.message}`);
    undatedCount = undated ?? 0;
  }

  const pageCount = Math.ceil(totalCount / PAGE);
  const pages: Array<PublicLeadRow[] | null> = new Array(pageCount).fill(null);
  let publishedPrefix = 0;
  let leadsSoFar: Lead[] = [];

  async function fetchPage(index: number): Promise<void> {
    const from = index * PAGE;
    const to = Math.min(from + PAGE - 1, totalCount - 1);
    let pageQuery = client
      .from('leads_public')
      .select('*')
      .order('seq', { ascending: true, nullsFirst: true })
      .range(from, to);
    pageQuery = applyDateFilter(
      pageQuery,
      filter,
      (q, col, v) => q.gte(col, v),
      (q, col, v) => q.lt(col, v),
    );
    const { data, error } = await pageQuery;
    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    const expected = to - from + 1;
    if (!data || data.length === 0) {
      throw new Error(
        `Supabase read inconsistent: totalCount=${totalCount} nhưng page ${index} rỗng (dữ liệu đổi giữa các query)`,
      );
    }
    // Fix ISSUE-4 impl-REV1: page thiếu (không rỗng vẫn sai) cũng throw — nếu
    // không success sẽ chốt thiếu rows mà total vẫn đủ (2.499/2.500).
    if (data.length !== expected) {
      throw new Error(
        `Supabase read inconsistent: page ${index} chỉ có ${data.length}/${expected} dòng (totalCount=${totalCount}, dữ liệu đổi giữa các query)`,
      );
    }
    pages[index] = data as PublicLeadRow[];
    // Chỉ publish prefix liên tục từ page 0: page về sớm ngoài prefix thì giữ
    // lại chờ. Publish lại toàn bộ prefix + re-assign duplicates mỗi lần.
    let end = publishedPrefix;
    while (end < pageCount && pages[end] !== null) end += 1;
    if (end === publishedPrefix) return;
    publishedPrefix = end;
    const rows: PublicLeadRow[] = [];
    for (let i = 0; i < end; i += 1) rows.push(...(pages[i] as PublicLeadRow[]));
    // Dữ liệu giữ file-order (seq) nên earliest của mỗi contact_group đứng trước.
    leadsSoFar = assignDuplicates(rows.map(publicRowToLead));
    onProgress?.(rows.length, leadsSoFar, totalCount);
  }

  if (totalCount > 0) {
    // Page 0 riêng để first paint nhanh nhất; còn lại song song theo batch.
    await fetchPage(0);
    for (let start = 1; start < pageCount; start += PAGE_CONCURRENCY) {
      const batch: Array<Promise<void>> = [];
      for (let i = start; i < Math.min(start + PAGE_CONCURRENCY, pageCount); i += 1) {
        batch.push(fetchPage(i));
      }
      await Promise.all(batch);
    }
  }
  const finalLoaded = pages.reduce((n, p) => n + (p?.length ?? 0), 0);
  // Đai an toàn cuối: tổng rows phải đúng totalCount mới là success (chặn page
  // thiếu lọt qua khi mock/server trả sai kích thước range).
  if (finalLoaded !== totalCount) {
    throw new Error(
      `Supabase read inconsistent: chỉ tải ${finalLoaded}/${totalCount} dòng (dữ liệu đổi giữa các query)`,
    );
  }
  return { rows: leadsSoFar, totalCount, loadedCount: finalLoaded, rangePreset: effectivePreset, undatedCount };
}

/** Giữ tương thích code cũ: full-load qua preset 'all' (count exact + loop theo total). */
export async function fetchSupabaseLeads(
  onProgress?: (loaded: number, leadsSoFar?: Lead[]) => void,
): Promise<Lead[]> {
  const result = await fetchLeadsByRange({ preset: 'all' }, (loaded, leadsSoFar) =>
    onProgress?.(loaded, leadsSoFar),
  );
  return result.rows;
}
