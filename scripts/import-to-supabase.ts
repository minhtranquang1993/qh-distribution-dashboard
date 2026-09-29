/**
 * Seed CSV wholesale vào Supabase (service_role, chạy local).
 * Gọi chung transformRows nên derived luôn khớp app (R5).
 * Upsert on conflict (batch_id, submission_id) — chạy lại cùng batch thì update.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/import-to-supabase.ts <csv-path> [file-name]
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import Papa from 'papaparse';
import { createClient } from '@supabase/supabase-js';
import { transformRows } from '../src/lib/transform';
import type { RawRow } from '../src/types/raw';

const csvPath = process.argv[2];
if (!csvPath || !existsSync(csvPath)) {
  console.error('Usage: import-to-supabase.ts <csv-path> [file-name]');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function toIntOrNull(v: string | undefined): number | null {
  const n = Number.parseInt((v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const text = readFileSync(csvPath, 'utf-8');
  const parsed = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: 'greedy' });
  const rows = parsed.data as RawRow[];
  console.log(`CSV rows: ${rows.length}`);

  const { leads, warnings } = await transformRows(rows);
  if (warnings.length > 0) console.log('warnings:', warnings.join(' · '));

  // Lọc raw rows có submission_id để align thứ tự với leads (transformRows giữ order).
  const rawFiltered = rows.filter((r) => (r.submission_id ?? '').trim().length > 0);
  if (rawFiltered.length !== leads.length) {
    console.error(`Row mismatch: raw ${rawFiltered.length} vs leads ${leads.length}`);
    process.exit(1);
  }

  // CSV thật có submission_id trùng (73 dòng): UNIQUE(batch_id, submission_id)
  // không cho upsert 2 dòng cùng key trong 1 lệnh → giữ dòng đầu, bỏ dòng sau.
  const seenIds = new Set<string>();
  const keepIdx: number[] = [];
  const dupIds: string[] = [];
  leads.forEach((lead, i) => {
    if (seenIds.has(lead.submissionId)) {
      if (dupIds.length < 10) dupIds.push(lead.submissionId);
    } else {
      seenIds.add(lead.submissionId);
      keepIdx.push(i);
    }
  });
  const skipped = leads.length - keepIdx.length;
  if (skipped > 0) console.log(`deduped ${skipped} row(s) with duplicate submission_id (kept first), e.g. ${dupIds.join(',')}`);

  const fileName = process.argv[3] ?? csvPath.split('/').pop() ?? 'wholesale.csv';
  const { data: batch, error: batchErr } = await supabase
    .from('batches')
    .insert({ file_name: fileName, file_row_count: rows.length })
    .select('id')
    .single();
  if (batchErr || !batch) {
    console.error('Create batch failed:', batchErr?.message);
    process.exit(1);
  }
  const batchId: string = batch.id;
  console.log(`batch ${batchId} (${fileName})`);

  // contact_group: cùng leadKey trong batch → cùng UUID ngẫu nhiên.
  // leadKey của transformRows đã salted per-parse nên không đảo ngược được —
  // lưu nó làm lead_key_hash là an toàn (base table chỉ service_role đọc).
  // Chỉ seed các dòng đã dedupe (keepIdx) để UNIQUE(batch_id, submission_id) không vỡ.
  const deduped = keepIdx.map((i) => ({ lead: leads[i], raw: rawFiltered[i] }));
  const groupByKey = new Map<string, string>();
  for (const { lead } of deduped) {
    if (!groupByKey.has(lead.leadKey)) groupByKey.set(lead.leadKey, randomUUID());
  }

  const payload = deduped.map(({ lead, raw }, seq) => {
    const str = (v: string | undefined) => (v ?? '').trim();
    return {
      batch_id: batchId,
      seq,
      submission_id: lead.submissionId,
      submitted_at: lead.submittedAt,
      raw_url: str(raw.URL),
      raw_first_source_url: str(raw.first_source_url),
      first_user_source: lead.firstUserSource,
      first_user_medium: lead.firstUserMedium,
      location: lead.location,
      brands_raw: str(raw['top-brands-you-are-looking-for']),
      budget_raw: str(raw['estimated-monthly-amount-dollar-you-wish-to-buy-from-us']),
      budget_bucket: lead.budgetBucket,
      registered_country: lead.registeredCountry,
      distribute_country: lead.distributeCountry,
      type_company: lead.typeCompany,
      how_know: lead.howKnow,
      company: str(raw.Company),
      contact_name: str(raw.Name),
      email: lead.email,
      calling_code: str(raw['calling-code']),
      phone_raw: str(raw.Phone),
      phone_e164: lead.phone,
      contact_pref: lead.contactPref,
      website_raw: str(raw['your-type-of-business-or-the-website']),
      week_num: toIntOrNull(raw.Week),
      month_num: toIntOrNull(raw.Month),
      day_num: toIntOrNull(raw.Day),
      score: lead.score,
      tier: lead.tier,
      gate_failed: lead.gateFailed,
      spam_signals: lead.spamSignals,
      geo_mismatch: lead.geoMismatch,
      severe_geo_mismatch: lead.severeGeoMismatch,
      email_valid: lead.emailValid,
      phone_valid: lead.phoneValid,
      duplicate_count: lead.duplicateCount,
      attribution_basis: lead.attributionBasis,
      lead_key_hash: lead.leadKey,
      contact_group: groupByKey.get(lead.leadKey)!,
      utm: {
        submit: lead.submitUtm,
        first_touch: lead.firstTouchUtm,
        chosen: lead.chosenUtm,
      },
    };
  });

  // Sanity: hash 1 dòng để log (không lưu salt) — debug import mà không lộ PII.
  const checksum = createHash('sha256').update(payload.map((p) => p.submission_id).join(',')).digest('hex').slice(0, 12);
  console.log(`payload checksum ${checksum}, groups ${groupByKey.size}`);

  const CHUNK = 500;
  let inserted = 0;
  for (let from = 0; from < payload.length; from += CHUNK) {
    const chunk = payload.slice(from, from + CHUNK);
    const { error } = await supabase
      .from('wholesale_leads')
      .upsert(chunk, { onConflict: 'batch_id,submission_id' });
    if (error) {
      console.error(`Upsert chunk ${from} failed:`, error.message);
      process.exit(1);
    }
    inserted += chunk.length;
    console.log(`upserted ${inserted}/${payload.length}`);
  }

  const { error: updErr } = await supabase
    .from('batches')
    .update({ inserted, updated: 0 })
    .eq('id', batchId);
  if (updErr) console.error('Update batch counters failed:', updErr.message);
  console.log(`DONE batch=${batchId} file_row_count=${rows.length} inserted=${inserted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
