/**
 * Mirror của `sanitizeUrlQuery()` + `sanitizeUtmSet()` trong
 * `supabase/functions/ingest-leads/index.ts`.
 *
 * Edge Function phải single-file để deploy qua Dashboard Via Editor nên
 * không import chung được — giữ 2 bản đồng bộ tay. Test trong
 * `src/__tests__/ingest-align.test.ts` cover bản này + assert bản function
 * vẫn chứa scrub value-level (chống drift về round 1).
 */

import type { UtmSet } from '@/types/lead';

const UTM_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_term',
  'utm_content',
  'utm_campaign',
  'utm_id',
]);

const EMAIL_IN_VALUE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_IN_VALUE = /\+?\d[\d\s\-().]{6,}\d/g;

export function sanitizeUrlQuery(raw: string): string {
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
 * Scrub một UTM value đơn: decode trước rồi cắt email/SĐT, tối đa 200 ký tự.
 * Decode là bắt buộc vì `parseUtm()` không decode — `utm_term=email%40example.com`
 * nếu không decode sẽ lọt qua regex. Mirror `sanitizeUtmValue()` trong
 * Edge Function. Dùng cho cột `utm` JSON (public view).
 */
export function sanitizeUtmValue(raw: string | undefined): string {
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

/** Scrub mọi field của một UtmSet trước khi ghi cột `utm` JSON. */
export function sanitizeUtmSet(u: UtmSet | undefined): UtmSet {
  return {
    source: sanitizeUtmValue(u?.source),
    medium: sanitizeUtmValue(u?.medium),
    term: sanitizeUtmValue(u?.term),
    content: sanitizeUtmValue(u?.content),
    campaign: sanitizeUtmValue(u?.campaign),
  };
}
