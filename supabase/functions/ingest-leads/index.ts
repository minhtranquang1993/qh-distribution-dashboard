// Edge Function `ingest-leads`: nhận leads đã parse từ browser và ghi vào
// Supabase bằng service_role (built-in env, không cần custom secrets).
//
// Protocol 3 action, chunk 500 dòng:
//   create_batch { fileName, fileRowCount } → { batch_id }
//   append { batch_id, items: [{ lead, raw, seq }] } → { inserted }
//   finalize { batch_id } → { ok, inserted } (đếm thật server-side)
//
// Bảo đảm khớp import-to-supabase.ts:
// - Dedupe submission_id KEEP FIRST: client đã dedupe global; server dùng
//   INSERT + bỏ qua conflict (không upsert ghi đè) làm safety net xuyên chunk.
// - contact_group deterministic = UUIDv5(batchId, leadKey): cùng leadKey trong
//   batch → cùng group ở mọi chunk, khác batch → khác group (không link xuyên
//   batch). Không dùng randomUUID per-request.
// - seq do client gửi (index trong payload đã dedupe = file-order).
//
// No-PII enforce server-side: function mở (dashboard nội bộ) nên không tin
// client — mọi cột PII luôn ghi '' bất kể payload gửi gì. Vì vậy bản local
// upload qua UI cũng chỉ lưu safe; muốn lưu PII phải dùng seed script local.
//
// raw_url/raw_first_source_url chỉ giữ query UTM đã sanitize (bỏ mọi param
// lạ để không lọt email/phone qua query string), vì 2 cột này nằm trong view
// leads_public. Cột `utm` JSON cũng public nên mọi field UTM đều scrub
// email/SĐT + cắt 200 ký tự trước khi ghi (sanitizeUtmSet).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UtmSet {
  source: string;
  medium: string;
  term: string;
  content: string;
  campaign: string;
}

interface LeadIn {
  submissionId: string;
  submittedAt: string;
  email: string;
  phone: string;
  name: string;
  company: string;
  location: string;
  registeredCountry: string;
  distributeCountry: string;
  budgetBucket: string;
  typeCompany: string;
  howKnow: string;
  contactPref: string;
  website: string;
  brands: string[];
  submitUtm: UtmSet;
  firstTouchUtm: UtmSet;
  chosenUtm: UtmSet;
  attributionBasis: string;
  firstUserSource: string;
  firstUserMedium: string;
  firstSourceUrl: string;
  geoMismatch: boolean;
  severeGeoMismatch: boolean;
  emailValid: boolean;
  phoneValid: boolean;
  duplicateCount: number;
  spamSignals: string[];
  score: number;
  tier: string;
  gateFailed: boolean;
  leadKey: string;
}

interface RawIn {
  URL?: string;
  first_source_url?: string;
  Company?: string;
  Name?: string;
  Email?: string;
  'calling-code'?: string;
  Phone?: string;
  'your-type-of-business-or-the-website'?: string;
  'top-brands-you-are-looking-for'?: string;
  'estimated-monthly-amount-dollar-you-wish-to-buy-from-us'?: string;
  Week?: string;
  Month?: string;
  Day?: string;
}

const str = (v: string | undefined): string => (v ?? '').trim();

function toIntOrNull(v: string | undefined): number | null {
  const n = Number.parseInt((v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

const UTM_KEYS = new Set(['utm_source', 'utm_medium', 'utm_term', 'utm_content', 'utm_campaign', 'utm_id']);

const EMAIL_IN_VALUE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_IN_VALUE = /\+?\d[\d\s\-().]{6,}\d/g;

/**
 * Chỉ giữ param UTM trong query string; bỏ mọi param lạ (có thể chứa
 * email/phone/CRM id). Value của param giữ lại cũng scrub email/SĐT
 * (utm_term/content/campaign do người dùng tự điền vẫn có thể chứa PII).
 * Trả về query đã sanitize (không domain), value cắt tối đa 200 ký tự.
 */
function sanitizeUrlQuery(raw: string): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  const qIndex = v.indexOf('?');
  const query = qIndex === -1 ? v : v.slice(qIndex + 1);
  if (!query) return '';
  const kept: string[] = [];
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim().toLowerCase();
    if (!UTM_KEYS.has(key)) continue;
    let value = pair.slice(eq + 1);
    try {
      value = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      /* giữ nguyên nếu decode lỗi */
    }
    value = value.replace(EMAIL_IN_VALUE, '[redacted]').replace(PHONE_IN_VALUE, '[redacted]');
    if (value.length > 200) value = value.slice(0, 200);
    kept.push(`${key}=${encodeURIComponent(value)}`);
  }
  return kept.join('&');
}

/**
 * Scrub một UTM value đơn: decode trước rồi cắt email/SĐT (parseUtm() không
 * decode nên `utm_term=email%40example.com` sẽ lọt regex nếu không decode),
 * cắt tối đa 200 ký tự. Dùng cho cột `utm` JSON (public view) — mirror ở
 * src/lib/sanitizeUrlQuery.ts.
 */
function sanitizeUtmValue(raw: string | undefined): string {
  let v = (raw ?? '').trim();
  if (!v) return '';
  try {
    v = decodeURIComponent(v.replace(/\+/g, ' '));
  } catch {
    /* giữ nguyên nếu decode lỗi */
  }
  v = v.replace(EMAIL_IN_VALUE, '[redacted]').replace(PHONE_IN_VALUE, '[redacted]');
  if (v.length > 200) v = v.slice(0, 200);
  return v;
}

/** Scrub mọi field của một UtmSet trước khi ghi vào cột `utm` JSON. */
function sanitizeUtmSet(u: UtmSet | undefined): UtmSet {
  return {
    source: sanitizeUtmValue(u?.source),
    medium: sanitizeUtmValue(u?.medium),
    term: sanitizeUtmValue(u?.term),
    content: sanitizeUtmValue(u?.content),
    campaign: sanitizeUtmValue(u?.campaign),
  };
}

/**
 * Parse text `M/D/YYYY[ H:mm]` thành ISO có offset +07:00 cho submitted_at_ts.
 * Mirror src/lib/submittedAt.ts — sai format / ngoài range / ngày không tồn
 * tại => null (KHÔNG normalize như to_timestamp).
 */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseSubmittedAtTs(text: string | undefined): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\s*$/.exec(text ?? '');
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null;
  if (month < 1 || month > 12) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+07:00`;
}

/**
 * UUID deterministic (v5-shaped): cùng (batchId, leadKey) → cùng UUID ở
 * mọi chunk. Lưu ý: KHÔNG phải UUIDv5 chuẩn RFC (chuẩn hash namespace
 * bytes + name bytes; đây hash chuỗi text) — chỉ cần deterministic hợp lệ
 * trong Postgres, không dùng cho interop.
 */
async function groupUuid(batchId: string, leadKey: string): Promise<string> {
  const ns = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace
  const data = new TextEncoder().encode(`${ns}:${batchId}:${leadKey}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant RFC4122
  const hex = [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Function chưa cấu hình (thiếu SUPABASE_URL / SERVICE_ROLE built-in)' }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const action = body.action as string;

  // --- create_batch ---
  if (action === 'create_batch') {
    const fileName = str(body.fileName as string | undefined) || 'upload.csv';
    const fileRowCount = Number(body.fileRowCount) || 0;
    const { data, error } = await supabase
      .from('batches')
      .insert({ file_name: fileName, file_row_count: fileRowCount })
      .select('id')
      .single();
    if (error || !data) return json({ error: `Create batch failed: ${error?.message}` }, 500);
    return json({ batch_id: (data as { id: string }).id });
  }

  // --- append ---
  if (action === 'append') {
    const batchId = body.batch_id as string;
    const items = body.items as Array<{ lead: LeadIn; raw: RawIn; seq: number }>;
    if (!batchId || !Array.isArray(items)) return json({ error: 'Missing batch_id/items' }, 400);
    if (items.length > 1000) return json({ error: 'Chunk quá lớn (max 1000)' }, 400);

    // Dedupe trong chunk (safety net; client đã dedupe global keep-first).
    const seen = new Set<string>();
    const kept = items.filter(({ lead }) => {
      if (!lead?.submissionId || seen.has(lead.submissionId)) return false;
      seen.add(lead.submissionId);
      return true;
    });

    const groups = new Map<string, string>();
    for (const { lead } of kept) {
      if (lead.leadKey && !groups.has(lead.leadKey)) {
        groups.set(lead.leadKey, await groupUuid(batchId, lead.leadKey));
      }
    }

    // No-PII enforce server-side: mọi cột PII luôn '' bất kể client gửi gì.
    const payload = kept.map(({ lead, raw, seq }) => ({
      batch_id: batchId,
      seq: Number.isFinite(Number(seq)) ? Number(seq) : 0,
      submission_id: lead.submissionId,
      submitted_at: lead.submittedAt ?? '',
      submitted_at_ts: parseSubmittedAtTs(lead.submittedAt ?? ''),
      raw_url: sanitizeUrlQuery(str(raw.URL)),
      raw_first_source_url: sanitizeUrlQuery(str(raw.first_source_url)),
      first_user_source: lead.firstUserSource ?? '',
      first_user_medium: lead.firstUserMedium ?? '',
      location: lead.location ?? '',
      brands_raw: str(raw['top-brands-you-are-looking-for']),
      budget_raw: str(raw['estimated-monthly-amount-dollar-you-wish-to-buy-from-us']),
      budget_bucket: lead.budgetBucket || 'Below $5,000',
      registered_country: lead.registeredCountry ?? '',
      distribute_country: lead.distributeCountry ?? '',
      type_company: lead.typeCompany || 'Others',
      how_know: lead.howKnow ?? '',
      company: '',
      contact_name: '',
      email: '',
      calling_code: '',
      phone_raw: '',
      phone_e164: '',
      contact_pref: lead.contactPref ?? '',
      website_raw: '',
      week_num: toIntOrNull(raw.Week),
      month_num: toIntOrNull(raw.Month),
      day_num: toIntOrNull(raw.Day),
      score: lead.score ?? 0,
      tier: lead.tier ?? 'Review',
      gate_failed: Boolean(lead.gateFailed),
      spam_signals: Array.isArray(lead.spamSignals) ? lead.spamSignals : [],
      geo_mismatch: Boolean(lead.geoMismatch),
      severe_geo_mismatch: Boolean(lead.severeGeoMismatch),
      email_valid: Boolean(lead.emailValid),
      phone_valid: Boolean(lead.phoneValid),
      duplicate_count: lead.duplicateCount ?? 1,
      attribution_basis: lead.attributionBasis ?? 'unknown',
      lead_key_hash: lead.leadKey ?? '',
      contact_group: lead.leadKey ? groups.get(lead.leadKey)! : crypto.randomUUID(),
      utm: {
        submit: sanitizeUtmSet(lead.submitUtm),
        first_touch: sanitizeUtmSet(lead.firstTouchUtm),
        chosen: sanitizeUtmSet(lead.chosenUtm),
      },
    }));

    // INSERT + bỏ qua conflict: dòng trùng submission_id (kể cả xuyên chunk)
    // giữ dòng đầu, không ghi đè — khớp import script.
    const { error } = await supabase
      .from('wholesale_leads')
      .upsert(payload, { onConflict: 'batch_id,submission_id', ignoreDuplicates: true });
    if (error) return json({ error: `Upsert failed: ${error.message}` }, 500);
    return json({ inserted: payload.length });
  }

  // --- finalize: đếm thật server-side, không tin counter client ---
  if (action === 'finalize') {
    const batchId = body.batch_id as string;
    if (!batchId) return json({ error: 'Missing batch_id' }, 400);
    const { count, error: countErr } = await supabase
      .from('wholesale_leads')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId);
    if (countErr) return json({ error: `Count failed: ${countErr.message}` }, 500);
    const inserted = count ?? 0;
    const { error } = await supabase
      .from('batches')
      .update({ inserted, updated: 0 })
      .eq('id', batchId);
    if (error) return json({ error: `Finalize failed: ${error.message}` }, 500);
    return json({ ok: true, batch_id: batchId, inserted });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
