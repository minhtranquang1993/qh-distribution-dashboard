import type { Lead, LeadTier, UtmSet } from '@/types/lead';
import { splitBrands } from '@/lib/normalize';
import { supabaseClient } from '@/lib/supabase';

/** Một dòng của view public.leads_public (không PII, không lead_key_hash). */
export interface PublicLeadRow {
  id: string;
  batch_id: string;
  submission_id: string;
  submitted_at: string;
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

/** Full-load leads_public (≤50k theo FIX-4) vào memory, ORDER BY seq ổn định.
 * seq = vị trí dòng trong file (import script ghi). Không sort TEXT theo
 * submission_id ('100000' < '68876') — nó đổi representative của contact group
 * và làm lệch tier (parity AC6). */
export async function fetchSupabaseLeads(onProgress?: (loaded: number) => void): Promise<Lead[]> {
  const client = supabaseClient();
  if (!client) throw new Error('Supabase chưa cấu hình (thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  const all: PublicLeadRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('leads_public')
      .select('*')
      .order('seq', { ascending: true, nullsFirst: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as PublicLeadRow[]));
    onProgress?.(all.length);
    if (data.length < PAGE) break;
  }
  const leads = all.map(publicRowToLead);
  // Dữ liệu giữ file-order (seq) nên earliest của mỗi contact_group đứng trước.
  return assignDuplicates(leads);
}
