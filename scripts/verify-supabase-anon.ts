/**
 * Verify anon key theo FIX-6 (4 lớp):
 * (a) đọc wholesale_leads bị từ chối, (b) đọc batches bị từ chối,
 * (c) đọc leads_public 200 + không chứa key PII/hash,
 * (d) introspect columns của view không có cột PII/hash.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... npx tsx scripts/verify-supabase-anon.ts
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
if (!URL || !ANON) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY env');
  process.exit(1);
}

const supabase = createClient(URL, ANON);
const PII_COLS = new Set([
  'company',
  'contact_name',
  'email',
  'calling_code',
  'phone_raw',
  'phone_e164',
  'website_raw',
  'lead_key_hash',
]);

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}

async function main() {
  // (a) base table wholesale_leads: anon phải bị từ chối
  const a = await supabase.from('wholesale_leads').select('*').limit(1);
  check('(a) anon đọc wholesale_leads bị từ chối', Boolean(a.error), a.error?.message ?? 'unexpected success');

  // (b) batches: anon phải bị từ chối
  const b = await supabase.from('batches').select('*').limit(1);
  check('(b) anon đọc batches bị từ chối', Boolean(b.error), b.error?.message ?? 'unexpected success');

  // (c) leads_public: 200 + không key PII/hash
  const c = await supabase.from('leads_public').select('*').limit(1);
  check('(c1) anon đọc leads_public thành công', !c.error, c.error?.message ?? '');
  const keys = c.data && c.data.length > 0 ? Object.keys(c.data[0]) : [];
  const leaked = keys.filter((k) => PII_COLS.has(k));
  check('(c2) leads_public không chứa cột PII/hash', leaked.length === 0, leaked.join(',') || `${keys.length} cols ok`);

  // (c3) contact_group là UUID ngẫu nhiên (không phải hash/email/phone), xoay theo batch.
  const groups = (c.data ?? []).map((r) => String((r as Record<string, unknown>).contact_group ?? ''));
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  check(
    '(c3) contact_group là UUID ngẫu nhiên, không derivable từ PII',
    groups.length > 0 && groups.every((g) => uuidRe.test(g)),
    groups[0] ?? 'no rows',
  );

  // (d) introspect columns: PostgREST /rpc không có → dùng select limit 0 vẫn trả columns qua keys.
  // Fallback: đếm keys ở (c) đã đủ; ở đây assert số cột view = 33 (32 cũ + seq, không lead_key_hash, không PII).
  const EXPECTED_COLS = 33;
  check(
    `(d) leads_public có đúng ${EXPECTED_COLS} cột safe`,
    keys.length === EXPECTED_COLS,
    `got ${keys.length}: ${keys.join(',')}`,
  );

  if (failed > 0) {
    console.error(`VERIFY FAILED: ${failed} check(s)`);
    process.exit(1);
  }
  console.log('VERIFY OK: anon model đúng FIX-6/FIX-7');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
