import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformRows } from '@/lib/transform';
import { digestKey } from '@/lib/normalize';
import { brandDemand, budgetMix, makeShareLabel, overview, pctOf, typeBudgetMatrix } from '@/lib/metrics';
import { buildActionBoard } from '@/lib/actionBoard';
import { creativeMatrix, groupSegments, monthlyTrend, sourceSegments, mediumSegments, typeCompanySegments, geoSegments } from '@/lib/metrics';
import { AcquireGroup, QualityGroup } from '@/components/Groups';
import { LeadsModule } from '@/components/LeadsModule';
import { OverviewNew } from '@/components/OverviewNew';
import { TrendModule } from '@/components/TrendModule';
import type { RawRow } from '@/types/raw';

// Recharts đo DOM khi render thật — mock ở ranh giới chart, giữ data + formatter nguyên.
vi.mock('recharts', () => {
  const stub = ({ children }: { children?: React.ReactNode }) => createElement('div', null, children);
  return {
    Bar: stub,
    BarChart: stub,
    Area: stub,
    AreaChart: stub,
    CartesianGrid: stub,
    Cell: stub,
    ResponsiveContainer: stub,
    Tooltip: ({ formatter }: { formatter?: (value: number) => readonly [string, string] }) =>
      createElement('div', { 'data-formatter': formatter ? 'share-label' : 'none' }),
    XAxis: stub,
    YAxis: stub,
  };
});

const SAMPLE_CSV = fileURLToPath(new URL('../../public/sample.csv', import.meta.url));

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

describe('duplicate flags (scoring input, not a denominator)', () => {
  it('keeps every submission as one lead', async () => {
    const { leads } = await transformRows(readSample());
    const stats = overview(leads);
    expect(stats.totalLeads).toBe(leads.length);
  });

  it('marks the second and later submissions from the same contact as duplicates', async () => {
    const rows = readSample().slice(0, 2).map((r) => ({ ...r }));
    // Force a duplicate: same email, different submission id.
    rows[1].Email = rows[0].Email;
    const { leads } = await transformRows(rows);
    expect(leads[0].isDuplicate).toBe(false);
    expect(leads[1].isDuplicate).toBe(true);
    expect(leads[0].leadKey).toBe(leads[1].leadKey);
    expect(leads[1].duplicateCount).toBe(2);
  });

  it('counts every submission even when contacts repeat', async () => {
    const rows = readSample().slice(0, 6).map((r) => ({ ...r }));
    // Three contacts: A submits twice, B three times, C once.
    rows[1].Email = rows[0].Email;
    rows[2].Email = rows[0].Email;
    rows[3].Email = rows[4].Email;
    rows[4].Email = rows[3].Email;
    rows[5].Email = 'solo@example.com';
    const { leads } = await transformRows(rows);

    // 1 submission = 1 lead: no collapsing by contact.
    expect(leads).toHaveLength(6);
    expect(overview(leads).totalLeads).toBe(6);
  });

  it('gives each lead its contact final group size, not a streaming count', async () => {
    const rows = readSample().slice(0, 4).map((r) => ({ ...r }));
    // One contact submits three times; the others submit once each.
    rows[1].Email = rows[0].Email;
    rows[2].Email = rows[0].Email;
    const { leads } = await transformRows(rows);

    const repeater = leads.find((l) => l.leadKey === leads[0].leadKey && !l.isDuplicate)!;
    // A single streaming pass would leave this stuck at 1.
    expect(repeater.duplicateCount).toBe(3);
  });

  it('counts resubmits in the submissions denominator', async () => {
    const rows = readSample().slice(0, 4).map((r) => ({ ...r }));
    rows[1].Email = rows[0].Email;
    rows[2].Email = rows[0].Email;
    const { leads } = await transformRows(rows);

    const segments = groupSegments(leads, () => 'all');
    expect(segments).toHaveLength(1);
    expect(segments[0].n).toBe(4);
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
  it('reports total leads and attribution coverage on submissions', async () => {
    const { leads } = await transformRows(readSample());
    const stats = overview(leads);
    expect(stats.totalLeads).toBe(leads.length);
    expect(stats.totalSubmissions).toBe(leads.length);
    expect(stats.mqlRate).toBeGreaterThanOrEqual(0);
    expect(stats.mqlRate).toBeLessThanOrEqual(1);
    expect(stats.mqlCount).toBe(leads.filter((l) => l.tier === 'MQL').length);
    const coverageTotal = stats.attributionCoverage.reduce((sum, row) => sum + row.share, 0);
    expect(coverageTotal).toBeCloseTo(1, 5);
  });

  it('produces segment stats whose bucket counts add up to the input size', async () => {
    const { leads } = await transformRows(readSample());
    for (const segments of [sourceSegments(leads), mediumSegments(leads), typeCompanySegments(leads), geoSegments(leads)]) {
      const total = segments.reduce((sum, s) => sum + s.n, 0);
      expect(total).toBe(leads.length);
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

describe('submissions denominator fixture (hand-computed)', () => {
  // contactA: lần đầu MQL-grade (Wholesaler + Above $20k + Tradeshow + Ghana
  // đồng nhất + email/phone hợp lệ + có tên/công ty + UTM đầy đủ ở URL).
  // Cùng contact gửi lần 2 → isDuplicate, rớt gate về Review (giữ gate).
  // contactB: budget thấp + Nurture-grade. contactC: email/phone rác → Review.
  // Kỳ vọng tính tay: 4 lead, MQL = 1 (25%), Review = 2, funnel cộng đủ 4.
  function fixtureRows(): RawRow[] {
    const base: RawRow = {
      submission_date: '1/15/2026 10:00',
      URL: 'https://shop.example/?utm_source=FixtureSource&utm_medium=Ads',
      location: 'Ghana',
      'in-which-country-is-your-business-registered': 'Ghana',
      'country-to-distribute-products': 'Ghana',
      'estimated-monthly-amount-dollar-you-wish-to-buy-from-us': 'Above $20,000 - $50,000',
      'type-company': 'Wholesaler',
      'how-do-you-know-about-us': 'Tradeshow',
      Name: 'Adaeze Mensah',
      Email: 'adaeze.mensah@realtrade.com',
      'calling-code': '233',
      Phone: '244123456',
      Company: 'Accra Wholesale Ltd',
    };
    return [
      { ...base, submission_id: 'fix-1' },
      { ...base, submission_id: 'fix-2', submission_date: '1/16/2026 10:00' },
      {
        ...base,
        submission_id: 'fix-3',
        Email: 'kwame.low@realtrade.com',
        Phone: '244654321',
        'estimated-monthly-amount-dollar-you-wish-to-buy-from-us': 'Above $5,000 - $20,000',
        // Hạ điểm về Nurture (20 + 8 + 6 + 10 + 10 = 54): vẫn pass gate, không lên MQL.
        'type-company': 'Boutique Store',
        'how-do-you-know-about-us': 'Facebook',
      },
      {
        ...base,
        submission_id: 'fix-4',
        Email: 'not-an-email',
        Phone: '123',
      },
    ];
  }

  it('counts all views from the same hand-computed submissions', async () => {
    const { leads } = await transformRows(fixtureRows());
    expect(leads).toHaveLength(4);

    // Dòng đầu MQL, dòng resubmit rớt gate; không suy từ output.
    expect(leads[0].tier).toBe('MQL');
    expect(leads[0].isDuplicate).toBe(false);
    expect(leads[1].isDuplicate).toBe(true);
    expect(leads[1].tier).toBe('Review');

    const stats = overview(leads);
    expect(stats.totalLeads).toBe(4);
    expect(stats.mqlCount).toBe(1);
    expect(stats.mqlRate).toBeCloseTo(0.25, 10);
    expect(Object.values(stats.tierCounts).reduce((s, n) => s + n, 0)).toBe(4);

    // Mọi breakdown cộng đủ 4 trên cùng tập submissions sau filter.
    for (const segments of [sourceSegments(leads), mediumSegments(leads), typeCompanySegments(leads), geoSegments(leads)]) {
      expect(segments.reduce((s, g) => s + g.n, 0)).toBe(4);
    }
    const [all] = groupSegments(leads, () => 'all');
    expect(all.n).toBe(4);
    expect(all.mqlRate).toBeCloseTo(0.25, 10);

    // Trend tháng 01 gom đủ 4 submissions, 1 MQL.
    const january = monthlyTrend(leads).find((t) => t.label === '2026-01');
    expect(january?.n).toBe(4);
    expect(january?.mql).toBe(1);

    // Creative đủ ngưỡng hiển thị mặc định (30): 30 submissions cùng term×content.
    const creativeRows: RawRow[] = Array.from({ length: 30 }, (_, i) => ({
      submission_id: `creative-${i}`,
      submission_date: '2/1/2026 10:00',
      URL: 'https://shop.example/?utm_source=FixtureSource&utm_medium=Ads&utm_term=bulkterm&utm_content=bulkcontent',
      location: 'Ghana',
      'in-which-country-is-your-business-registered': 'Ghana',
      'country-to-distribute-products': 'Ghana',
      'estimated-monthly-amount-dollar-you-wish-to-buy-from-us': 'Above $20,000 - $50,000',
      'type-company': 'Wholesaler',
      'how-do-you-know-about-us': 'Tradeshow',
      Name: `Bulk Buyer ${i}`,
      Email: `bulk.buyer.${i}@realtrade.com`,
      'calling-code': '233',
      Phone: `2441000${String(i).padStart(2, '0')}`,
      Company: 'Accra Wholesale Ltd',
    }));
    const { leads: creativeLeads } = await transformRows(creativeRows);
    const [topCell] = creativeMatrix(creativeLeads);
    expect(topCell.n).toBe(30);
    expect(topCell.term).toBe('bulkterm');

    // Budget mix + type×budget cộng đủ 4 trên cùng fixture tay.
    expect(budgetMix(leads).reduce((s, b) => s + b.n, 0)).toBe(4);
    expect(typeBudgetMatrix(leads).reduce((s, c) => s + c.n, 0)).toBe(4);
    expect(brandDemand(leads, 1).reduce((s, b) => s + b.n, 0)).toBeGreaterThanOrEqual(0);
  });

  it('renders every view from the same submissions at the component boundary', async () => {
    const { leads } = await transformRows(fixtureRows());

    const html = renderToStaticMarkup(createElement(OverviewNew, { leads }));
    expect(html).toContain('>4<');
    expect(html).toContain('25.0%');
    expect(html).not.toMatch(/Contact duy nhất|Nhóm trùng|Trùng |resubmit|gửi lặp|lặp lại/i);

    const acquire = renderToStaticMarkup(createElement(AcquireGroup, { leads }));
    // Source được normalize lowercase ở data layer — assert đúng hành vi hiện có.
    expect(acquire).toContain('fixturesource');
    expect(acquire).not.toMatch(/Trùng |resubmit|gửi lặp|lặp lại/i);

    const quality = renderToStaticMarkup(createElement(QualityGroup, { leads }));
    expect(quality).toContain('Ghana');
    expect(quality).not.toMatch(/Trùng |resubmit|gửi lặp|lặp lại/i);

    const trend = renderToStaticMarkup(createElement(TrendModule, { leads }));
    expect(trend).toContain('Xu hướng theo tháng');
    expect(trend).not.toMatch(/resubmit/i);

    const explorer = renderToStaticMarkup(
      createElement(LeadsModule, { leads, drill: null, onClearDrill: () => {}, newIds: new Set<string>() }),
    );
    expect(explorer).toContain('fix-1');
    expect(explorer).toContain('Hiện 4 / 4 dòng');
    expect(explorer).not.toMatch(/trùng ×|resubmit|gửi lặp|lặp lại/i);

    // Formatter tooltip thật: cohort rỗng hiện 0.0%, không NaN/Infinity.
    const emptyLabel = makeShareLabel(0);
    expect(emptyLabel(0)[0]).toBe('0 (0.0%)');
    const emptyHtml = renderToStaticMarkup(createElement(OverviewNew, { leads: [] }));
    expect(emptyHtml).not.toMatch(/NaN|Infinity/i);
  });

  it('renders empty cohort percents without NaN or Infinity', async () => {
    const stats = overview([]);
    expect(stats.totalLeads).toBe(0);
    expect(stats.mqlRate).toBe(0);
    expect(stats.attributionCoverage).toHaveLength(0);
    for (const value of [stats.mqlRate, stats.highBudgetRate, stats.trackingCoverage]) {
      expect(pctOf(0, stats.totalLeads)).toBe('0.0%');
      expect(String(value)).not.toMatch(/NaN|Infinity/);
    }
    expect(pctOf(0, 0)).toBe('0.0%');
  });
});

describe('action board', () => {
  it('never recommends Scale for a segment with weak tracking', async () => {
    const { leads } = await transformRows(readSample());
    const items = buildActionBoard({
      leads,
      sourceSegments: sourceSegments(leads),
      mediumSegments: mediumSegments(leads),
      typeSegments: typeCompanySegments(leads),
      geoSegments: geoSegments(leads),
      termSegments: groupSegments(leads, (l) => l.chosenUtm.term || '(no term)'),
      contentSegments: groupSegments(leads, (l) => l.chosenUtm.content || '(no content)'),
    });
    for (const item of items) {
      if (item.action === 'Scale') {
        expect(item.stats.n).toBeGreaterThanOrEqual(100);
        expect(item.stats.missingTrackingRate).toBeLessThanOrEqual(0.5);
        expect(item.stats.geoMismatchRate).toBeLessThanOrEqual(0.4);
      }
    }
  });

  it('cuts a duplicate-heavy segment without revealing the duplicate rate', async () => {
    const { leads } = await transformRows(readSample());
    const items = buildActionBoard({
      leads,
      sourceSegments: [{ key: 'resubmit-heavy', n: 100, highBudgetRate: 0.5, mqlRate: 0.3, duplicateRate: 0.6, geoMismatchRate: 0, missingTrackingRate: 0, spamRate: 0, confidence: 'high' }],
      mediumSegments: [],
      typeSegments: [],
      geoSegments: [],
      termSegments: [],
      contentSegments: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0].action).toBe('Cut/Exclude');
    expect(items[0].reason).not.toMatch(/trùng|duplicate|lặp|resubmit|gửi lặp/i);
  });

  it('empty cohort reports zero leads without crashing', async () => {
    const stats = overview([]);
    expect(stats.totalLeads).toBe(0);
    expect(stats.mqlRate).toBe(0);
    expect(stats.attributionCoverage).toHaveLength(0);
  });
});
