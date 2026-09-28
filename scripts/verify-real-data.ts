/**
 * Acceptance check: run the real transform + metrics over the full source CSV
 * and print the numbers the Gate 2 criteria were written against.
 */
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { transformRows } from '@/lib/transform';
import { leadsForMode, overview, sourceSegments, typeCompanySegments } from '@/lib/metrics';
import { buildActionBoard } from '@/lib/actionBoard';
import { creativeMatrix, geoSegments, groupSegments, mediumSegments } from '@/lib/metrics';
import type { RawRow } from '@/types/raw';

const SOURCE = process.argv[2] ?? '/Users/minhtqm1993/Downloads/Data wholesale form - 2026 - Wholesale.csv';

const raw = readFileSync(SOURCE, 'utf-8');
const rows = Papa.parse<RawRow>(raw, { header: true, skipEmptyLines: 'greedy' }).data;
console.log('SOURCE ROWS:', rows.length);

const t0 = Date.now();
const { leads, warnings } = await transformRows(rows);
console.log('TRANSFORM ms:', Date.now() - t0, '| leads:', leads.length, '| warnings:', warnings.length);

const stats = overview(leads);
console.log('\n--- OVERVIEW ---');
console.log('submissions        ', stats.totalSubmissions);
console.log('unique contacts    ', stats.uniqueContacts);
console.log('MQL rate           ', (stats.mqlRate * 100).toFixed(1) + '%', `(${stats.mqlCount})`);
console.log('high budget rate   ', (stats.highBudgetRate * 100).toFixed(1) + '%');
console.log('duplicate rate     ', (stats.duplicateRate * 100).toFixed(1) + '%');
console.log('geo mismatch rate  ', (stats.geoMismatchRate * 100).toFixed(1) + '%');
console.log('spam rate          ', (stats.spamRate * 100).toFixed(1) + '%');
console.log('tracking coverage  ', (stats.trackingCoverage * 100).toFixed(1) + '%');
console.log('attribution        ', stats.attributionCoverage.map((r) => `${r.basis}=${(r.share * 100).toFixed(1)}%`).join('  '));
console.log('tiers              ', JSON.stringify(stats.tierCounts));

const base = leadsForMode(leads, 'unique');
console.log('\n--- TOP SOURCE (unique) ---');
for (const s of sourceSegments(base).slice(0, 8)) {
  console.log(' ', s.key.padEnd(22), `n=${String(s.n).padStart(6)}`, `mql=${(s.mqlRate * 100).toFixed(1)}%`, `conf=${s.confidence}`);
}
console.log('\n--- TOP TYPE (unique) ---');
for (const s of typeCompanySegments(base).slice(0, 8)) {
  console.log(' ', s.key.padEnd(36), `n=${String(s.n).padStart(6)}`, `mql=${(s.mqlRate * 100).toFixed(1)}%`);
}

const items = buildActionBoard({
  leads: base,
  sourceSegments: sourceSegments(base),
  mediumSegments: mediumSegments(base),
  typeSegments: typeCompanySegments(base),
  geoSegments: geoSegments(base),
  termSegments: groupSegments(base, (l) => l.chosenUtm.term || '(no term)'),
  contentSegments: groupSegments(base, (l) => l.chosenUtm.content || '(no content)'),
});
const byAction = new Map<string, number>();
for (const item of items) byAction.set(item.action, (byAction.get(item.action) ?? 0) + 1);
console.log('\n--- ACTION BOARD ---');
console.log('total segments:', items.length);
for (const [action, count] of byAction) console.log(' ', action.padEnd(18), count);
console.log('\nScale candidates:');
for (const item of items.filter((i) => i.action === 'Scale').slice(0, 10)) {
  console.log(' ', `${item.dimension}/${item.segment}`.padEnd(38), `n=${item.stats.n}`, `mql=${(item.stats.mqlRate * 100).toFixed(1)}%`);
}

const matrix = creativeMatrix(base);
console.log('\n--- CREATIVE MATRIX top 8 ---');
for (const c of matrix.slice(0, 8)) {
  console.log(' ', `${c.term} | ${c.content}`.padEnd(46), `n=${String(c.n).padStart(5)}`, `mql=${(c.mqlRate * 100).toFixed(1)}%`);
}
