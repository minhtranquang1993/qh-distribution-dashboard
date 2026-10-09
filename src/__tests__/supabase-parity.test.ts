import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { transformRows } from '@/lib/transform';
import { applyFilters, EMPTY_FILTER, monthKeyOf } from '@/lib/cohort';
import { drillKeyOf, leadsForDrill } from '@/lib/drill';
import { overview, sourceSegments } from '@/lib/metrics';
import { assignDuplicates, publicRowToLead, type PublicLeadRow } from '@/lib/supabaseLeads';
import type { RawRow } from '@/types/raw';
import type { Lead } from '@/types/lead';

const SAMPLE_CSV = fileURLToPath(new URL('../../public/sample.csv', import.meta.url));

function readSample(): RawRow[] {
  const text = readFileSync(SAMPLE_CSV, 'utf-8');
  return Papa.parse<RawRow>(text, { header: true, skipEmptyLines: 'greedy' }).data;
}

/** Giả lập 1 dòng leads_public từ Lead đã transform (khớp import script). */
function toPublicRow(lead: Lead, contactGroup: string): PublicLeadRow {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    batch_id: '11111111-1111-1111-1111-111111111111',
    submission_id: lead.submissionId,
    submitted_at: lead.submittedAt,
    submitted_at_ts: null,
    raw_url: '',
    raw_first_source_url: '',
    first_user_source: lead.firstUserSource,
    first_user_medium: lead.firstUserMedium,
    location: lead.location,
    brands_raw: lead.brands.join(', '),
    budget_raw: '',
    budget_bucket: lead.budgetBucket,
    registered_country: lead.registeredCountry,
    distribute_country: lead.distributeCountry,
    type_company: lead.typeCompany,
    how_know: lead.howKnow,
    contact_pref: lead.contactPref,
    week_num: null,
    month_num: null,
    day_num: null,
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
    contact_group: contactGroup,
    seq: 0,
    utm: { submit: lead.submitUtm, first_touch: lead.firstTouchUtm, chosen: lead.chosenUtm },
  };
}

describe('AC6 parity CSV = Supabase', () => {
  it('produces identical aggregates after publicRowToLead round-trip', async () => {
    const { leads } = await transformRows(readSample());
    // Mỗi lead 1 group riêng như import thật (dedupe đã có duplicateCount).
    const rows = leads.map((l, i) => toPublicRow(l, `group-${i}`));
    // Khôi phục group trùng: cùng leadKey gốc → cùng contact_group.
    const groupByKey = new Map<string, string>();
    leads.forEach((l, i) => {
      if (!groupByKey.has(l.leadKey)) groupByKey.set(l.leadKey, rows[i].contact_group);
      else rows[i].contact_group = groupByKey.get(l.leadKey)!;
    });
    const roundTripped = assignDuplicates(rows.map(publicRowToLead));

    const before = overview(leads);
    const after = overview(roundTripped);
    expect(after.totalSubmissions).toBe(before.totalSubmissions);
    expect(after.totalLeads).toBe(before.totalLeads);
    expect(after.mqlCount).toBe(before.mqlCount);
    expect(after.mqlRate).toBeCloseTo(before.mqlRate, 10);

    const topBefore = sourceSegments(leads).slice(0, 5).map((s) => `${s.key}:${s.n}:${s.mqlRate.toFixed(4)}`);
    const topAfter = sourceSegments(roundTripped).slice(0, 5).map((s) => `${s.key}:${s.n}:${s.mqlRate.toFixed(4)}`);
    expect(topAfter).toEqual(topBefore);
  });

  it('never exposes PII in the mapped lead', async () => {
    const { leads } = await transformRows(readSample());
    const mapped = publicRowToLead(toPublicRow(leads[0], 'g'));
    expect(mapped.email).toBe('');
    expect(mapped.phone).toBe('');
    expect(mapped.name).toBe('');
    expect(mapped.company).toBe('');
    expect(mapped.website).toBe('');
  });
});

describe('AC7 filtered cohort', () => {
  it('filters by budget tier and keeps confidence on filtered n', async () => {
    const { leads } = await transformRows(readSample());
    const filtered = applyFilters(leads, { ...EMPTY_FILTER, budgets: ['Above $20,000 - $50,000', 'Above $50,000 - $100,000', 'Above $100,000'] });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(leads.length);
    expect(filtered.every((l) => l.budgetBucket !== 'Below $5,000' && l.budgetBucket !== 'Above $5,000 - $20,000')).toBe(true);
    // Confidence dùng filtered n: segment toàn filtered set phải high khi đủ 100.
    const { confidenceFor } = await import('@/lib/metrics');
    expect(confidenceFor(filtered.length)).toBe(filtered.length >= 100 ? 'high' : filtered.length >= 30 ? 'medium' : 'exploratory');
  });

  it('parses month keys for the date filter', () => {
    expect(monthKeyOf('1/1/2026 0:20')).toBe('2026-01');
    expect(monthKeyOf('12/31/2026 23:59')).toBe('2026-12');
    expect(monthKeyOf('')).toBe('');
  });
});

describe('segment drill', () => {
  it('resolves the same segments as metrics grouping', async () => {
    const { leads } = await transformRows(readSample());
    const [top] = sourceSegments(leads);
    const drilled = leadsForDrill(leads, { dimension: 'source', key: top.key, title: top.key });
    expect(drilled.length).toBe(top.n);
    expect(drilled.every((l) => drillKeyOf('source', l) === top.key)).toBe(true);
  });
});
