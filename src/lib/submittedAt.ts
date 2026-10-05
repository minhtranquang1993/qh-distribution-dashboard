/**
 * Parse + preset ngày cho Phase B (server pagination theo submitted_at_ts).
 * Wall-clock hiểu là Asia/Ho_Chi_Minh; thiếu giờ => 00:00; sai format /
 * ngoài range / ngày không tồn tại => null (KHÔNG normalize như to_timestamp).
 * Mirror SQL ở supabase/migration-submitted-ts.sql — đổi 1 trong 2 chỗ phải
 * đổi cả chỗ còn lại + Edge Function ingest-leads.
 */

export type RangePreset = '1m' | '3m' | '6m' | 'all' | 'custom';

const SUBMITTED_RE =
  /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\s*$/;

export function daysInMonth(year: number, month: number): number {
  // month 1-12; dùng UTC để không lệch DST.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Parse text `M/D/YYYY[ H:mm]` thành ISO có offset +07:00 để ghi timestamptz.
 * Trả null khi sai format / ngoài range / ngày không tồn tại.
 */
export function parseSubmittedAtTs(text: string | undefined): string | null {
  const m = SUBMITTED_RE.exec(text ?? '');
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
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+07:00`;
}

/** Tháng wall-clock +07 của một timestamptz ISO (hỗ trợ 'Z' hoặc offset). */
export function anchorMonthOf(isoTs: string): string {
  const ms = Date.parse(isoTs);
  if (Number.isNaN(ms)) return '';
  const plus7 = new Date(ms + 7 * 60 * 60 * 1000);
  return `${plus7.getUTCFullYear()}-${pad(plus7.getUTCMonth() + 1)}`;
}

function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * Từ anchor (max submitted_at_ts, wall-clock +07) suy monthFrom/monthTo.
 * Neo theo DỮ LIỆU, không neo now() — tránh default rỗng khi data cũ.
 * Trả null cho 'all' và 'custom' (custom dùng bounds từ applied, không suy).
 */
export function monthRangeFromAnchor(
  anchorIso: string,
  preset: RangePreset,
): { monthFrom: string; monthTo: string } | null {
  if (preset === 'all' || preset === 'custom') return null;
  const endMonth = anchorMonthOf(anchorIso);
  if (!endMonth) return null;
  const n = preset === '1m' ? 1 : preset === '3m' ? 3 : 6;
  return { monthFrom: shiftMonth(endMonth, -(n - 1)), monthTo: endMonth };
}

function firstDayPlus07(monthKey: string): string {
  return `${monthKey}-01T00:00:00+07:00`;
}

/** Biên server: [gte đầu tháng, lt đầu tháng sau) — không dùng lte cuối tháng. */
export function rangeBounds(monthFrom: string, monthTo: string): { gte: string; lt: string } {
  return { gte: firstDayPlus07(monthFrom), lt: firstDayPlus07(shiftMonth(monthTo, 1)) };
}
