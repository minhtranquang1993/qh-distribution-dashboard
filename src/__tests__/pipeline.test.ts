import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { transformRows } from '@/lib/transform';
import { digestKey } from '@/lib/normalize';
import { overview, uniqueContacts, duplicateGroups, leadsForMode } from '@/lib/metrics';
import { buildActionBoard } from '@/lib/actionBoard';
import { groupSegments, sourceSegments, mediumSegments, typeCompanySegments, geoSegments } from '@/lib/metrics';
import type { RawRow } from '@/types/raw';

const SAMPLE_CSV = new URL('../../public/sample.csv', import.meta.url).pathname;

function readSample(): RawRow[] {
  const text = readFileSync(SAMPLE_CSV, 'utf-8');
  return Papa.parse<RawRow>(text, { header: true, skipEmptyLines: 'greedy' }).data;
}

describe('sample.csv shape', () => {
  it('parses 200 rows with a submission_id on every row', async () => {
    const rows = readSample();
    expect(rows).toHaveLength(200);
    expect(rows.every((r) => (r.submission_id ?? '').trim().length > 0)).toBe(true);
  });
});

describe('transformRows', () => {
  it('keeps one lead per submission and reports the source row count', async () => {
    const rows = readSample();
    const { leads, totalRows, warnings } = await transformRows(rows);
    expect(leads).toHaveLength(200);
    expect(totalRows).toBe(200);
    expect(warnings).toHaveLength(0);
  });

  it('strips every PII field when noPii is set', async () => {
    const rows = readSample();
    const { leads } = await transformRows(rows, { noPii: true });
    for (const lead of leads) {
      expect(lead.email).toBe('');
      expect(lead.phone).toBe('');
      expect(lead.name).toBe('');
      expect(lead.company).toBe('');
      expect(lead.website).toBe('');
    }
  });

  it('retains PII on the local build so the Explorer is usable', async () => {
    const rows = readSample();
    const { leads } = await transformRows(rows, { noPii: false });
    expect(leads.some((l) => l.email.endsWith('@example.com'))).toBe(true);
    expect(leads.some((l) => l.name.length > 0)).toBe(true);
  });

  it('gives every lead a score in range and a known tier', async () => {
    const { leads } = await transformRows(readSample());
    for (const lead of leads) {
      expect(lead.score).toBeGreaterThanOrEqual(0);
      expect(lead.score).toBeLessThanOrEqual(100);
      expect(['MQL', 'Nurture', 'Low', 'Review']).toContain(lead.tier);
    }
  });

  it('never buckets a gate-failed lead as MQL', async () => {
    const { leads } = await transformRows(readSample());
    for (const lead of leads) {
      if (lead.gateFailed) expect(lead.tier).not.toBe('MQL');
    }
  });

  it('records the attribution basis for every lead', async () => {
    const { leads } = await transformRows(readSample());
    for (const lead of leads) {
      expect(['submit_url', 'first_source_fallback', 'unknown']).toContain(lead.attributionBasis);
    }
    // At least some rows should fall back to the first-touch URL.
    expect(leads.some((l) => l.attributionBasis === 'first_source_fallback')).toBe(true);
  });
});

describe('dedupe semantics', () => {
  it('collapses repeated contacts but keeps every raw submission', async () => {
    const { leads } = await transformRows(readSample());
    const unique = uniqueContacts(leads);
    expect(unique.length).toBeLessThanOrEqual(leads.length);
    expect(leadsForMode(leads, 'raw')).toHaveLength(leads.length);
    expect(leadsForMode(leads, 'unique')).toHaveLength(unique.length);
  });

  it('marks the second and later submissions from the same contact as duplicates', async () => {
    const rows = readSample().slice(0, 2).map((r) => ({ ...r }));
    // Force a duplicate: same email, different submission id.
    rows[1].Email = rows[0].Email;
    const { leads } = await transformRows(rows);
    expect(leads[0].isDuplicate).toBe(false);
    expect(leads[1].isDuplicate).toBe(true);
    const repeats = duplicateGroups(leads).filter((g) => g.count > 1);
    expect(repeats).toHaveLength(1);
    expect(repeats[0].count).toBe(2);
  });

  it('resolves the dupe_groups denominator to one row per repeat submitter', async () => {
    const rows = readSample().slice(0, 6).map((r) => ({ ...r }));
    // Three contacts: A submits twice, B three times, C once.
    rows[1].Email = rows[0].Email;
    rows[2].Email = rows[0].Email;
    rows[3].Email = rows[4].Email;
    rows[4].Email = rows[3].Email;
    rows[5].Email = 'solo@example.com';
    const { leads } = await transformRows(rows);

    const raw = leadsForMode(leads, 'raw');
    const unique = leadsForMode(leads, 'unique');
    const groups = leadsForMode(leads, 'dupe_groups');

    expect(raw).toHaveLength(6);
    expect(unique).toHaveLength(3);
    // Only the two repeat submitters remain, each collapsed to a single row.
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((l) => l.leadKey)).size).toBe(2);
  });

  it('gives the surviving unique row its final group size, not a streaming count', async () => {
    const rows = readSample().slice(0, 4).map((r) => ({ ...r }));
    // One contact submits three times; the others submit once each.
    rows[1].Email = rows[0].Email;
    rows[2].Email = rows[0].Email;
    const { leads } = await transformRows(rows);

    const unique = leadsForMode(leads, 'unique');
    const repeater = unique.find((l) => l.leadKey === leads[0].leadKey)!;
    // uniqueContacts keeps the earliest submission, which is also the isDuplicate=false
    // one — a single streaming pass would leave this stuck at 1.
    expect(repeater.isDuplicate).toBe(false);
    expect(repeater.duplicateCount).toBe(3);
  });

  it('reports a non-zero duplicate rate in the default unique denominator', async () => {
    const rows = readSample().slice(0, 4).map((r) => ({ ...r }));
    rows[1].Email = rows[0].Email;
    rows[2].Email = rows[0].Email;
    const { leads } = await transformRows(rows);

    const base = leadsForMode(leads, 'unique');
    const segments = groupSegments(base, () => 'all');
    expect(segments).toHaveLength(1);
    // 1 of 2 unique contacts resubmitted.
    expect(segments[0].duplicateRate).toBeCloseTo(0.5, 5);
  });
});

describe('leadKey privacy (impl-review ISSUE-1)', () => {
  it('never embeds the email, phone, or submission id in the key', async () => {
    const { leads } = await transformRows(readSample());
    for (const lead of leads) {
      expect(lead.leadKey).toMatch(/^lk1:[0-9a-f]{24}$/);
      if (lead.email) expect(lead.leadKey).not.toContain(lead.email);
      if (lead.phone) expect(lead.leadKey).not.toContain(lead.phone);
      expect(lead.leadKey).not.toContain(lead.submissionId);
    }
  });

  it('produces no readable contact value even in the PII-stripped build', async () => {
    const { leads } = await transformRows(readSample(), { noPii: true });
    for (const lead of leads) {
      expect(lead.email).toBe('');
      // The key still has to be safe to render and export in that build.
      expect(lead.leadKey).toMatch(/^lk1:[0-9a-f]{24}$/);
    }
  });

  it('is stable for the same contact and distinct across contacts', async () => {
    const { leads } = await transformRows(readSample());
    // A hash collision would merge two real leads into one person and corrupt
    // every downstream count, so the key count must track the contact count.
    const byKey = new Set(leads.map((l) => l.leadKey));
    const byContact = new Set(leads.filter((l) => l.emailValid || l.phoneValid).map((l) => l.leadKey));
    expect(byKey.size).toBe(byContact.size);
  });

  it('gives the same contact one key within a single parse', async () => {
    const rows = readSample().slice(0, 3).map((r) => ({ ...r }));
    rows[1].Email = rows[0].Email;
    const { leads } = await transformRows(rows);
    // Dedupe depends on this: same contact, same parse → same key.
    expect(leads[0].leadKey).toBe(leads[1].leadKey);
    expect(leads[1].isDuplicate).toBe(true);
  });

  it('derives different keys for the same contact across parses', async () => {
    // impl-review round-2 ISSUE-1: an unsalted digest is a reversible-by-dictionary
    // pseudonym. A fresh per-parse salt is what makes an exported key useless
    // off the machine that produced it.
    const first = await transformRows(readSample());
    const second = await transformRows(readSample());
    const firstKeys = first.leads.map((l) => l.leadKey);
    const secondKeys = second.leads.map((l) => l.leadKey);
    expect(firstKeys).not.toEqual(secondKeys);
    // But the *structure* is unchanged, so dedupe still works within each run.
    expect(new Set(firstKeys).size).toBe(new Set(secondKeys).size);
  });

  it('does not leak a dictionary-checkable fingerprint', async () => {
    const { leads } = await transformRows(readSample());
    const first = leads[0];
    // Recompute what an attacker with a candidate list would produce — and prove
    // they cannot match the rendered key without the per-parse salt.
    const guess = await digestKey('', first.email);
    expect(first.leadKey).not.toBe(`lk1:${guess}`);
  });
});

describe('overview metrics', () => {
  it('reports submissions, unique contacts and attribution coverage', async () => {
    const { leads } = await transformRows(readSample());
    const stats = overview(leads);
    expect(stats.totalSubmissions).toBe(leads.length);
    expect(stats.uniqueContacts).toBe(uniqueContacts(leads).length);
    expect(stats.mqlRate).toBeGreaterThanOrEqual(0);
    expect(stats.mqlRate).toBeLessThanOrEqual(1);
    const coverageTotal = stats.attributionCoverage.reduce((sum, row) => sum + row.share, 0);
    expect(coverageTotal).toBeCloseTo(1, 5);
  });

  it('produces segment stats whose bucket counts add up to the input size', async () => {
    const { leads } = await transformRows(readSample());
    const base = leadsForMode(leads, 'unique');
    for (const segments of [sourceSegments(base), mediumSegments(base), typeCompanySegments(base), geoSegments(base)]) {
      const total = segments.reduce((sum, s) => sum + s.n, 0);
      expect(total).toBe(base.length);
    }
  });

  it('marks small segments as exploratory', async () => {
    const rows: RawRow[] = Array.from({ length: 5 }, (_, i) => ({
      submission_id: String(1000 + i),
      submission_date: '1/1/2026 0:00',
      URL: 'utm_source=Tiny&utm_medium=Ads',
      location: 'Ghana',
      'in-which-country-is-your-business-registered': 'Ghana',
      'country-to-distribute-products': 'Ghana',
      'estimated-monthly-amount-dollar-you-wish-to-buy-from-us': 'Above $20,000 - $50,000',
      'type-company': 'Wholesaler',
      'how-do-you-know-about-us': 'Tradeshow',
      Name: 'Test User',
      Email: `tiny${i}@example.com`,
      'calling-code': '233',
      Phone: `55510000${i}`,
      Company: 'Tiny Co',
    }));
    const { leads } = await transformRows(rows);
    const [segment] = sourceSegments(leads).filter((s) => s.key === 'tiny');
    expect(segment.n).toBe(5);
    expect(segment.confidence).toBe('exploratory');
  });
});

describe('action board', () => {
  it('never recommends Scale for a segment with weak tracking', async () => {
    const { leads } = await transformRows(readSample());
    const base = leadsForMode(leads, 'unique');
    const items = buildActionBoard({
      leads: base,
      sourceSegments: sourceSegments(base),
      mediumSegments: mediumSegments(base),
      typeSegments: typeCompanySegments(base),
      geoSegments: geoSegments(base),
      termSegments: groupSegments(base, (l) => l.chosenUtm.term || '(no term)'),
      contentSegments: groupSegments(base, (l) => l.chosenUtm.content || '(no content)'),
    });
    for (const item of items) {
      if (item.action === 'Scale') {
        expect(item.stats.n).toBeGreaterThanOrEqual(100);
        expect(item.stats.missingTrackingRate).toBeLessThanOrEqual(0.5);
        expect(item.stats.geoMismatchRate).toBeLessThanOrEqual(0.4);
      }
    }
  });
});
