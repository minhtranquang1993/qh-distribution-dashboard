/** Parity live AC6: so aggregates CSV upload vs Supabase load trên cùng dataset. */
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { transformRows } from '../src/lib/transform';
import { overview, sourceSegments } from '../src/lib/metrics';
import { fetchSupabaseLeads } from '../src/lib/supabaseLeads';
import type { RawRow } from '../src/types/raw';

const csvPath = process.argv[2] ?? '/Users/minhtqm1993/Downloads/Data wholesale form - 2026 - Wholesale.csv';

async function main() {
  const text = readFileSync(csvPath, 'utf-8');
  const rows = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: 'greedy' }).data as RawRow[];
  const { leads: csvLeads } = await transformRows(rows);
  // CSV có 73 submission_id trùng → DB dedupe giữ dòng đầu (như import script).
  const seen = new Set<string>();
  const deduped = csvLeads.filter((l) => {
    if (seen.has(l.submissionId)) return false;
    seen.add(l.submissionId);
    return true;
  });
  const csvStats = overview(deduped);
  const csvTop = sourceSegments(deduped).slice(0, 5).map((s) => `${s.key}:${s.n}:${s.mqlRate.toFixed(4)}`);

  const dbLeads = await fetchSupabaseLeads((n) => process.stdout.write(`\rdb loaded ${n}`));
  console.log('');
  const dbStats = overview(dbLeads);
  const dbTop = sourceSegments(dbLeads).slice(0, 5).map((s) => `${s.key}:${s.n}:${s.mqlRate.toFixed(4)}`);

  const checks: Array<[string, boolean, string]> = [
    ['submissions', dbStats.totalSubmissions === deduped.length, `${dbStats.totalSubmissions} vs ${deduped.length}`],
    ['unique', dbStats.uniqueContacts === csvStats.uniqueContacts, `${dbStats.uniqueContacts} vs ${csvStats.uniqueContacts}`],
    ['mql', dbStats.mqlCount === csvStats.mqlCount, `${dbStats.mqlCount} vs ${csvStats.mqlCount}`],
    ['mqlRate', Math.abs(dbStats.mqlRate - csvStats.mqlRate) < 1e-9, `${dbStats.mqlRate} vs ${csvStats.mqlRate}`],
    ['top5 source', JSON.stringify(dbTop) === JSON.stringify(csvTop), dbTop.join(' | ')],
  ];
  let failed = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
    if (!ok) failed += 1;
  }
  if (failed > 0) {
    process.exit(1);
  }
  console.log('PARITY OK: CSV = Supabase');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
