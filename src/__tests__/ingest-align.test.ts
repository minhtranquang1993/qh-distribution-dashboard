import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { transformRows } from '@/lib/transform';
import { sanitizeUrlQuery, sanitizeUtmSet } from '@/lib/sanitizeUrlQuery';
import { dedupeForSave, saveKeyOf } from '@/lib/ingestApi';
import type { RawRow } from '@/types/raw';
import type { RawPassthrough } from '@/workers/messages';

const SAMPLE_CSV = fileURLToPath(new URL('../../public/sample.csv', import.meta.url));

/** Copy logic trích raw của csvParser.worker.ts (dev, noPii=false). */
function extractRaw(collected: RawRow[], noPii: boolean): RawPassthrough[] {
  const raw: RawPassthrough[] = [];
  for (const row of collected) {
    if (!(row.submission_id ?? '').trim()) continue;
    raw.push({
      URL: row.URL,
      first_source_url: row.first_source_url,
      Company: noPii ? '' : row.Company,
      Name: noPii ? '' : row.Name,
      Email: noPii ? '' : row.Email,
      'calling-code': noPii ? '' : row['calling-code'],
      Phone: noPii ? '' : row.Phone,
      'your-type-of-business-or-the-website': noPii
        ? ''
        : row['your-type-of-business-or-the-website'],
      'top-brands-you-are-looking-for': row['top-brands-you-are-looking-for'],
      'estimated-monthly-amount-dollar-you-wish-to-buy-from-us':
        row['estimated-monthly-amount-dollar-you-wish-to-buy-from-us'],
      Week: row.Week,
      Month: row.Month,
      Day: row.Day,
    });
  }
  return raw;
}

describe('raw passthrough aligns with leads', () => {
  it('dev: raw.length === leads.length, PII giữ lại', async () => {
    const text = readFileSync(SAMPLE_CSV, 'utf-8');
    const collected = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: 'greedy' }).data;
    const { leads } = await transformRows(collected, { noPii: false });
    const raw = extractRaw(collected, false);
    expect(raw.length).toBe(leads.length);
    expect(raw[0].Email).toBeTruthy();
  });

  it('prod: raw.length === leads.length, PII blank', async () => {
    const text = readFileSync(SAMPLE_CSV, 'utf-8');
    const collected = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: 'greedy' }).data;
    const { leads } = await transformRows(collected, { noPii: true });
    const raw = extractRaw(collected, true);
    expect(raw.length).toBe(leads.length);
    expect(raw.every((r) => !r.Email && !r.Phone && !r.Name && !r.Company)).toBe(true);
    expect(leads.every((l) => !l.email && !l.phone && !l.name)).toBe(true);
  });
});

describe('dedupeForSave: global keep-first + seq file-order', () => {
  it('giữ dòng đầu khi trùng submission_id xuyên chunk, seq liên tục', async () => {
    const text = readFileSync(SAMPLE_CSV, 'utf-8');
    const collected = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: 'greedy' }).data;
    const { leads } = await transformRows(collected, { noPii: false });
    const raw = extractRaw(collected, false);
    // Nhân đôi leads để giả lập trùng xuyên chunk.
    const doubled = [...leads, ...leads];
    const doubledRaw = [...raw, ...raw];
    const items = dedupeForSave(doubled, doubledRaw);
    expect(items.length).toBe(leads.length);
    // seq = index liên tục, dòng đầu được giữ.
    items.forEach((it, i) => expect(it.seq).toBe(i));
    expect(items[0].lead.submissionId).toBe(doubled[0].submissionId);
    // raw align theo lead đã dedupe.
    expect(items[0].raw).toEqual(doubledRaw[0]);
  });

  it('saveKey phân biệt 2 file khác nhau cùng tên/count', async () => {
    const text = readFileSync(SAMPLE_CSV, 'utf-8');
    const collected = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: 'greedy' }).data;
    const { leads } = await transformRows(collected, { noPii: false });
    const raw = extractRaw(collected, false);
    const a = dedupeForSave(leads, raw);
    // Đảo thứ tự 2 dòng đầu → cùng count nhưng key khác.
    const swapped = [leads[1], leads[0], ...leads.slice(2)];
    const swappedRaw = [raw[1], raw[0], ...raw.slice(2)];
    const b = dedupeForSave(swapped, swappedRaw);
    expect(b.length).toBe(a.length);
    expect(saveKeyOf('same.csv', b)).not.toBe(saveKeyOf('same.csv', a));
    expect(saveKeyOf('same.csv', a)).toBe(saveKeyOf('same.csv', a));
  });
});

describe('sanitizeUrlQuery: value-level PII scrub (mirror function)', () => {
  it('scrub email trong utm_term, giữ param UTM', () => {
    const out = sanitizeUrlQuery('https://x.com/?utm_source=google&utm_term=email@example.com');
    const decoded = decodeURIComponent(out);
    expect(decoded).not.toContain('email@example.com');
    expect(out).toContain('utm_source=google');
    expect(decoded).toContain('[redacted]');
  });

  it('bỏ param lạ, scrub SĐT trong value', () => {
    const out = sanitizeUrlQuery(
      'https://x.com/?utm_campaign=sale&email=leak@example.com&utm_content=call%20%2B1%20555-123-4567',
    );
    const decoded = decodeURIComponent(out);
    expect(decoded).not.toContain('leak@example.com');
    expect(out).not.toContain('email=');
    expect(out).toContain('utm_campaign=sale');
    expect(decoded).toContain('[redacted]');
  });

  it('bản function vẫn chứa scrub value-level (chống drift)', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../supabase/functions/ingest-leads/index.ts', import.meta.url)),
      'utf-8',
    );
    expect(src).toContain('EMAIL_IN_VALUE');
    expect(src).toContain('PHONE_IN_VALUE');
    expect(src).toContain('[redacted]');
    // Round 2 đã bỏ seqBase / client-reported inserted.
    expect(src).not.toContain('seqBase');
    // Round 4: cột utm JSON phải scrub server-side, không ghi nguyên.
    expect(src).toContain('sanitizeUtmSet');
    expect(src).not.toContain('submit: lead.submitUtm,');
    // Round 5: sanitizeUtmValue phải decode trước regex (parseUtm không decode).
    expect(src).toMatch(/function sanitizeUtmValue[\s\S]*?decodeURIComponent/);
  });
});

describe('sanitizeUtmSet: scrub PII trong utm JSON (cột public)', () => {
  it('scrub email/SĐT trong term/content/campaign, giữ source/medium sạch', () => {
    const out = sanitizeUtmSet({
      source: 'google',
      medium: 'cpc',
      term: 'email@example.com',
      content: 'call +1 555-123-4567',
      campaign: 'sale 2026',
    });
    expect(out.term).toBe('[redacted]');
    expect(out.content).toContain('[redacted]');
    expect(out.content).not.toContain('555-123-4567');
    expect(out.source).toBe('google');
    expect(out.medium).toBe('cpc');
    expect(out.campaign).toBe('sale 2026');
  });

  it('scrub encoded email/SĐT (parseUtm không decode)', () => {
    // parseUtm() giữ nguyên encoding nên sanitizeUtmValue phải decode trước regex.
    const out = sanitizeUtmSet({
      source: 'google',
      medium: 'cpc',
      term: 'email%40example.com',
      content: 'call%20%2B1%20555-123-4567',
      campaign: 'sale',
    });
    expect(out.term).toBe('[redacted]');
    expect(out.term).not.toContain('%40');
    expect(out.content).toContain('[redacted]');
    expect(out.content).not.toContain('555-123-4567');
  });

  it('cắt value quá dài, chịu undefined', () => {
    const out = sanitizeUtmSet(undefined);
    expect(out).toEqual({ source: '', medium: '', term: '', content: '', campaign: '' });
    const long = sanitizeUtmSet({
      source: '',
      medium: '',
      term: 'x'.repeat(300),
      content: '',
      campaign: '',
    });
    expect(long.term.length).toBe(200);
  });

  it('seed script dùng chung sanitizer (chống drift function-only)', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../scripts/import-to-supabase.ts', import.meta.url)),
      'utf-8',
    );
    expect(src).toContain('sanitizeUtmSet');
    expect(src).toContain('sanitizeUrlQuery');
    expect(src).not.toContain('submit: lead.submitUtm,');
    expect(src).not.toContain('raw_url: str(raw.URL),');
  });
});
