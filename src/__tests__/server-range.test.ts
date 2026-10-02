import { describe, expect, it, vi } from 'vitest';
import {
  anchorMonthOf,
  daysInMonth,
  monthRangeFromAnchor,
  parseSubmittedAtTs,
  rangeBounds,
} from '@/lib/submittedAt';
import type { PublicLeadRow } from '@/lib/supabaseLeads';

const { mockState } = vi.hoisted(() => ({
  mockState: { client: null as unknown },
}));

vi.mock('@/lib/supabase', () => ({
  supabaseClient: () => mockState.client as never,
  isSupabaseConfigured: () => true,
}));

function makeRow(i: number, ts: string | null, month: string): PublicLeadRow {
  const emptyUtm = { source: '', medium: '', term: '', content: '', campaign: '' };
  return {
    id: `id-${i}`,
    batch_id: 'b',
    submission_id: `s-${i}`,
    submitted_at: ts ?? '',
    submitted_at_ts: ts,
    raw_url: '',
    raw_first_source_url: '',
    first_user_source: 'google',
    first_user_medium: 'organic',
    location: '',
    brands_raw: '',
    budget_raw: '',
    budget_bucket: 'Below $5,000',
    registered_country: 'Vietnam',
    distribute_country: 'Vietnam',
    type_company: 'Others',
    how_know: '',
    contact_pref: '',
    week_num: null,
    month_num: month === '2026-07' ? 7 : month === '2026-08' ? 8 : month === '2026-09' ? 9 : null,
    day_num: null,
    score: 0,
    tier: 'Review',
    gate_failed: true,
    spam_signals: [],
    geo_mismatch: false,
    severe_geo_mismatch: false,
    email_valid: true,
    phone_valid: true,
    duplicate_count: 1,
    attribution_basis: 'unknown',
    contact_group: `g-${i}`,
    seq: i,
    utm: { submit: { ...emptyUtm }, first_touch: { ...emptyUtm }, chosen: { ...emptyUtm } },
  };
}

interface Filter {
  kind: 'gte' | 'lt' | 'is' | 'not-is-null';
  col: string;
  val?: string;
}

/** Giả lập PostgREST: count exact + paging, NULL không bao giờ match gte/lt. */
function createMockClient(allRows: PublicLeadRow[]) {
  function newQuery() {
    const filters: Filter[] = [];
    const q: Record<string, unknown> = {};
    let selectCols = '*';
    let selectOpts: { count?: string; head?: boolean } | undefined;
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;

    const api = {
      select(cols: string, opts?: { count?: string; head?: boolean }) {
        selectCols = cols;
        selectOpts = opts;
        return api;
      },
      not(col: string, op: string, val: unknown) {
        if (col === 'submitted_at_ts' && op === 'is') filters.push({ kind: 'not-is-null', col });
        void val;
        return api;
      },
      is(col: string, val: unknown) {
        filters.push({ kind: 'is', col, val: String(val) });
        return api;
      },
      gte(col: string, val: string) {
        filters.push({ kind: 'gte', col, val });
        return api;
      },
      lt(col: string, val: string) {
        filters.push({ kind: 'lt', col, val });
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAsc = opts?.ascending ?? true;
        return api;
      },
      limit(n: number) {
        limitN = n;
        return api;
      },
      range(from: number, to: number) {
        rangeFrom = from;
        rangeTo = to;
        return api;
      },
      then(
        onFulfilled?: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) {
        try {
          const result = execute();
          return Promise.resolve(result).then(onFulfilled, onRejected);
        } catch (e) {
          return Promise.reject(e).then(onFulfilled, onRejected);
        }
      },
    };
    void q;

    function execute() {
      let rows = [...allRows];
      const cellOf = (r: PublicLeadRow, col: string): unknown =>
        (r as unknown as Record<string, unknown>)[col];
      for (const f of filters) {
        if (f.kind === 'not-is-null') rows = rows.filter((r) => r.submitted_at_ts !== null);
        else if (f.kind === 'is') rows = rows.filter((r) => cellOf(r, f.col) === null);
        else if (f.kind === 'gte')
          rows = rows.filter((r) => {
            const v = cellOf(r, f.col) as string | null;
            return v !== null && v >= (f.val as string);
          });
        else if (f.kind === 'lt')
          rows = rows.filter((r) => {
            const v = cellOf(r, f.col) as string | null;
            return v !== null && v < (f.val as string);
          });
      }
      if (orderCol === 'submitted_at_ts') {
        rows.sort((a, b) => {
          const av = a.submitted_at_ts ?? '';
          const bv = b.submitted_at_ts ?? '';
          return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      } else if (orderCol === 'seq') {
        rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      }
      if (selectOpts?.count === 'exact' && selectOpts?.head) {
        return { count: rows.length, error: null };
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      if (rangeFrom !== null && rangeTo !== null) rows = rows.slice(rangeFrom, rangeTo + 1);
      void selectCols;
      return { data: rows, error: null };
    }
    return api;
  }

  return {
    from(_table: string) {
      void _table;
      return newQuery();
    },
  };
}

describe('parseSubmittedAtTs: wall-clock +07, không normalize', () => {
  it('parse đủ giờ phút sang ISO +07', () => {
    expect(parseSubmittedAtTs('3/9/2026 13:58')).toBe('2026-03-09T13:58:00+07:00');
  });

  it('thiếu giờ về 00:00', () => {
    expect(parseSubmittedAtTs('3/9/2026')).toBe('2026-03-09T00:00:00+07:00');
  });

  it('ngày không tồn tại về null (2/31/2026, năm thường)', () => {
    expect(parseSubmittedAtTs('2/31/2026')).toBeNull();
  });

  it('tháng 13 về null', () => {
    expect(parseSubmittedAtTs('13/1/2026')).toBeNull();
  });

  it('giờ 25 về null', () => {
    expect(parseSubmittedAtTs('3/9/2026 25:00')).toBeNull();
  });

  it('năm nhuận 2/29/2024 hợp lệ, 2/29/2026 null', () => {
    expect(parseSubmittedAtTs('2/29/2024')).toBe('2024-02-29T00:00:00+07:00');
    expect(parseSubmittedAtTs('2/29/2026')).toBeNull();
  });

  it('chuỗi rỗng / sai format về null', () => {
    expect(parseSubmittedAtTs('')).toBeNull();
    expect(parseSubmittedAtTs('2026-03-09')).toBeNull();
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });
});

describe('preset range: calendar neo dữ liệu, biên +07', () => {
  it('neo theo max dữ liệu, không neo now()', () => {
    const anchor = '2026-09-15T10:00:00+07:00';
    expect(monthRangeFromAnchor(anchor, '1m')).toEqual({ monthFrom: '2026-09', monthTo: '2026-09' });
    expect(monthRangeFromAnchor(anchor, '3m')).toEqual({ monthFrom: '2026-07', monthTo: '2026-09' });
    expect(monthRangeFromAnchor(anchor, '6m')).toEqual({ monthFrom: '2026-04', monthTo: '2026-09' });
    expect(monthRangeFromAnchor(anchor, 'all')).toBeNull();
  });

  it('biên server [gte đầu tháng, lt đầu tháng sau)', () => {
    expect(rangeBounds('2026-09', '2026-09')).toEqual({
      gte: '2026-09-01T00:00:00+07:00',
      lt: '2026-10-01T00:00:00+07:00',
    });
  });

  it('case biên 31/08 23:59 +07 vs 01/09 00:00 +07 rơi đúng tháng', () => {
    expect(anchorMonthOf('2026-08-31T23:59:00+07:00')).toBe('2026-08');
    expect(anchorMonthOf('2026-09-01T00:00:00+07:00')).toBe('2026-09');
  });
});

describe('fetchLeadsByRange: dừng theo totalCount, header phân biệt total/loaded', () => {
  it('preset all tải đủ 2500 qua nhiều page, không break sớm kiểu 1000', async () => {
    const rows: PublicLeadRow[] = [];
    for (let i = 0; i < 2500; i += 1) {
      const month = i < 1000 ? '2026-07' : i < 1800 ? '2026-08' : '2026-09';
      const day = String((i % 28) + 1).padStart(2, '0');
      rows.push(makeRow(i, `2026-${month.slice(5)}-${day}T10:00:00+07:00`, month));
    }
    mockState.client = createMockClient(rows);
    const { fetchLeadsByRange } = await import('@/lib/supabaseLeads');
    const progress: Array<{ loaded: number; total: number }> = [];
    const result = await fetchLeadsByRange({ preset: 'all' }, (loaded, _leads, total) => {
      progress.push({ loaded, total });
    });
    // totalCount đúng ngay từ page đầu, không phải rows.length từng page.
    expect(progress[0].total).toBe(2500);
    expect(progress[0].loaded).toBe(1000);
    expect(result.totalCount).toBe(2500);
    expect(result.loadedCount).toBe(2500);
    expect(result.rows.length).toBe(2500);
    expect(result.rangePreset).toBe('all');
  });

  it('preset 1m chỉ lấy tháng 09 + đếm riêng dòng không ngày', async () => {
    const rows: PublicLeadRow[] = [];
    for (let i = 0; i < 1000; i += 1) {
      rows.push(makeRow(i, `2026-07-${String((i % 28) + 1).padStart(2, '0')}T10:00:00+07:00`, '2026-07'));
    }
    for (let i = 1000; i < 1800; i += 1) {
      rows.push(makeRow(i, `2026-08-${String((i % 28) + 1).padStart(2, '0')}T10:00:00+07:00`, '2026-08'));
    }
    for (let i = 1800; i < 2500; i += 1) {
      rows.push(makeRow(i, `2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:00:00+07:00`, '2026-09'));
    }
    for (let i = 2500; i < 2505; i += 1) {
      rows.push(makeRow(i, null, ''));
    }
    mockState.client = createMockClient(rows);
    const { fetchLeadsByRange, fetchRangeAnchor } = await import('@/lib/supabaseLeads');
    const anchor = await fetchRangeAnchor();
    expect(anchor.maxSubmittedAtTs?.startsWith('2026-09')).toBe(true);
    const result = await fetchLeadsByRange({ preset: '1m' });
    expect(result.totalCount).toBe(700);
    expect(result.loadedCount).toBe(700);
    expect(result.rows.length).toBe(700);
    expect(result.undatedCount).toBe(5);
    expect(result.rows.every((l) => l.submittedAt.startsWith('2026-09'))).toBe(true);
  });

  it('pre-migration (không anchor): preset tháng fallback về all, dashboard vẫn chạy', async () => {
    const rows: PublicLeadRow[] = [];
    for (let i = 0; i < 10; i += 1) {
      rows.push(makeRow(i, null, ''));
    }
    mockState.client = createMockClient(rows);
    const { fetchLeadsByRange } = await import('@/lib/supabaseLeads');
    const result = await fetchLeadsByRange({ preset: '1m' });
    expect(result.rangePreset).toBe('all');
    expect(result.totalCount).toBe(10);
    expect(result.rows.length).toBe(10);
  });
});
