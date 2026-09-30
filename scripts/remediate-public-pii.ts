/**
 * Remediate các dòng đã seed trước round 5: sanitize lại raw_url,
 * raw_first_source_url và utm (3 basis) bằng cùng logic Edge Function.
 * Chỉ chạm các dòng còn chứa PII/param lạ — dòng đã sạch thì bỏ qua.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/remediate-public-pii.ts [--dry-run]
 */
import { createClient } from '@supabase/supabase-js';
import { sanitizeUrlQuery, sanitizeUtmSet } from '../src/lib/sanitizeUrlQuery';
import type { UtmSet } from '../src/types/lead';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const PAGE = 1000;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

interface Row {
  id: string;
  raw_url: string;
  raw_first_source_url: string;
  utm: { submit?: UtmSet; first_touch?: UtmSet; chosen?: UtmSet } | null;
}

function needsFix(row: Row): { raw_url: string; raw_first_source_url: string; utm: Row['utm'] } | null {
  const raw_url = sanitizeUrlQuery(row.raw_url ?? '');
  const raw_first_source_url = sanitizeUrlQuery(row.raw_first_source_url ?? '');
  const utm = row.utm
    ? {
        submit: sanitizeUtmSet(row.utm.submit),
        first_touch: sanitizeUtmSet(row.utm.first_touch),
        chosen: sanitizeUtmSet(row.utm.chosen),
      }
    : row.utm;
  const changed =
    raw_url !== (row.raw_url ?? '') ||
    raw_first_source_url !== (row.raw_first_source_url ?? '') ||
    JSON.stringify(utm) !== JSON.stringify(row.utm);
  return changed ? { raw_url, raw_first_source_url, utm } : null;
}

async function main() {
  let scanned = 0;
  let fixed = 0;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('wholesale_leads')
      .select('id, raw_url, raw_first_source_url, utm')
      // Order ổn định: PostgREST không đảm bảo thứ tự mặc định, update trong
      // lúc phân trang offset có thể làm sót/lặp dòng.
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('Select failed:', error.message);
      process.exit(1);
    }
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;
    scanned += rows.length;
    for (const row of rows) {
      const patch = needsFix(row);
      if (!patch) continue;
      fixed += 1;
      if (DRY_RUN) continue;
      const { error: updErr } = await supabase.from('wholesale_leads').update(patch).eq('id', row.id);
      if (updErr) {
        console.error(`Update ${row.id} failed:`, updErr.message);
        process.exit(1);
      }
    }
    console.log(`scanned ${scanned}, to-fix ${fixed}${DRY_RUN ? ' (dry-run)' : ''}`);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  console.log(`DONE scanned=${scanned} fixed=${fixed}${DRY_RUN ? ' (dry-run, no writes)' : ''}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
