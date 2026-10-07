/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useDataSource } from '@/hooks/useDataSource';
import type { Lead } from '@/types/lead';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface PendingFetch {
  opts: { preset: string; monthFrom?: string | null; monthTo?: string | null; anchorIso?: string | null };
  onProgress?: (loaded: number, leads: unknown[], total: number) => void;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

const { hookState } = vi.hoisted(() => ({
  hookState: {
    anchorIso: '2026-09-15T10:00:00+07:00',
    fetches: [] as PendingFetch[],
    fetchCalls: [] as unknown[],
  },
}));

vi.mock('@/lib/supabaseLeads', () => ({
  fetchRangeAnchor: () => Promise.resolve({ maxSubmittedAtTs: hookState.anchorIso }),
  fetchLeadsByRange: (opts: unknown, onProgress?: PendingFetch['onProgress']) =>
    new Promise((resolve, reject) => {
      hookState.fetchCalls.push(opts);
      hookState.fetches.push({
        opts: opts as PendingFetch['opts'],
        onProgress,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
    }),
}));

const { ingestState } = vi.hoisted(() => ({
  ingestState: { state: { status: 'idle' as const, leads: [] as unknown[] } },
}));

vi.mock('@/hooks/useIngest', () => ({
  useIngest: () => ({ state: ingestState.state, parseFile: () => {}, reset: () => {} }),
  IS_PRODUCTION_BUILD: false,
}));

vi.mock('@/lib/supabase', () => ({
  supabaseClient: () => null,
  isSupabaseConfigured: () => true,
}));

function makeLead(i: number, month: string): Lead {
  return {
    submissionId: `s-${i}`,
    submittedAt: `${month}-15T10:00:00+07:00`,
    leadKey: `g-${i}`,
  } as unknown as Lead;
}

function makeResult(rows: Lead[], total?: number) {
  return {
    rows,
    totalCount: total ?? rows.length,
    loadedCount: rows.length,
    rangePreset: 'x',
    undatedCount: 0,
  };
}

function renderDataSource() {
  const ref: { current: ReturnType<typeof useDataSource> | null } = { current: null };
  function Probe() {
    ref.current = useDataSource();
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Probe));
  });
  return {
    get current(): ReturnType<typeof useDataSource> {
      if (!ref.current) throw new Error('hook chưa mount');
      return ref.current;
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const flush = () => act(async () => {});

beforeEach(() => {
  hookState.fetches = [];
  hookState.fetchCalls = [];
  hookState.anchorIso = '2026-09-15T10:00:00+07:00';
});

describe('useDataSource progressive: publish page đầu ngay, giữ snapshot cũ trong gap', () => {
  it('onProgress commit dần prefix (first paint sau page đầu, partial gắn cờ chưa đủ)', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      expect(hookState.fetches).toHaveLength(1);
      const partial = [makeLead(1, '2026-09'), makeLead(2, '2026-09')];
      act(() => {
        hookState.fetches[0].onProgress?.(2, partial, 700);
      });
      // First paint: loading nhưng đã hiện 2 dòng + label MỚI + cờ partial.
      expect(ui.current.dbStatus).toBe('loading');
      expect(ui.current.combined).toHaveLength(2);
      expect(ui.current.visibleLeads).toHaveLength(2);
      expect(ui.current.dbPartial).toBe(true);
      expect(ui.current.rangeLabel).toBe('2026-09 → 2026-09');
      expect(ui.current.dbLoaded).toBe(2);
      expect(ui.current.dbTotal).toBe(700);
      act(() => {
        hookState.fetches[0].onProgress?.(500, partial, 700);
      });
      expect(ui.current.combined).toHaveLength(2);
      expect(ui.current.dbLoaded).toBe(500);
      const full = Array.from({ length: 700 }, (_, i) => makeLead(i, '2026-09'));
      await act(async () => {
        hookState.fetches[0].resolve(makeResult(full, 700));
      });
      expect(ui.current.dbStatus).toBe('ready');
      expect(ui.current.combined).toHaveLength(700);
      expect(ui.current.dbTotal).toBe(700);
      expect(ui.current.dbPartial).toBe(false);
      expect(ui.current.rangeLabel).toBe('2026-09 → 2026-09');
    } finally {
      ui.unmount();
    }
  });

  it('reload lỗi trong gap giữ snapshot cũ + banner, restore counters (không cặp total mới + rows cũ)', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      await act(async () => {
        hookState.fetches[0].resolve(makeResult(Array.from({ length: 10 }, (_, i) => makeLead(i, '2026-09')), 10));
      });
      const labelBefore = ui.current.rangeLabel;
      const totalBefore = ui.current.dbTotal;
      await act(async () => {
        ui.current.setPreset('3m');
      });
      expect(hookState.fetches).toHaveLength(2);
      expect(ui.current.dbStatus).toBe('loading');
      // Gap chờ page đầu: vẫn hiện snapshot cũ nguyên vẹn, chưa partial.
      expect(ui.current.combined).toHaveLength(10);
      expect(ui.current.dbPartial).toBe(false);
      expect(ui.current.rangeLabel).toBe(labelBefore);
      await act(async () => {
        hookState.fetches[1].reject(new Error('boom'));
      });
      expect(ui.current.dbStatus).toBe('ready');
      expect(ui.current.dbError).toBe('boom');
      expect(ui.current.combined).toHaveLength(10);
      expect(ui.current.rangeLabel).toBe(labelBefore);
      expect(ui.current.dbTotal).toBe(totalBefore);
      expect(ui.current.dbPartial).toBe(false);
    } finally {
      ui.unmount();
    }
  });

  it('reload lỗi SAU partial restore lastComplete (snapshot cũ), không giữ partial mới', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      await act(async () => {
        hookState.fetches[0].resolve(makeResult(Array.from({ length: 10 }, (_, i) => makeLead(i, '2026-09')), 10));
      });
      await act(async () => {
        ui.current.setPreset('3m');
      });
      // Partial của range mới: chuyển sang rows + label MỚI + cờ partial.
      const partialB = [makeLead(100, '2026-07'), makeLead(101, '2026-08')];
      act(() => {
        hookState.fetches[1].onProgress?.(2, partialB, 500);
      });
      expect(ui.current.combined).toHaveLength(2);
      expect(ui.current.dbPartial).toBe(true);
      expect(ui.current.rangeLabel).toBe('2026-07 → 2026-09');
      await act(async () => {
        hookState.fetches[1].reject(new Error('fail-sau-partial'));
      });
      // Restore nguyên bộ snapshot hoàn chỉnh A, không giữ partial B.
      expect(ui.current.dbStatus).toBe('ready');
      expect(ui.current.dbError).toBe('fail-sau-partial');
      expect(ui.current.combined).toHaveLength(10);
      expect(ui.current.rangeLabel).toBe('2026-09 → 2026-09');
      expect(ui.current.dbTotal).toBe(10);
      expect(ui.current.dbPartial).toBe(false);
      // Progress muộn cùng request sau terminal bị loại, không đụng snapshot.
      act(() => {
        hookState.fetches[1].onProgress?.(500, partialB, 500);
      });
      expect(ui.current.combined).toHaveLength(10);
      expect(ui.current.rangeLabel).toBe('2026-09 → 2026-09');
    } finally {
      ui.unmount();
    }
  });

  it('S xong → A pending → B partial → B lỗi → A lỗi muộn: terminal B còn hiệu lực, progress B muộn bị loại', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      // S success tạo snapshot hoàn chỉnh.
      await act(async () => {
        hookState.fetches[0].resolve(makeResult([makeLead(0, '2026-09')], 1));
      });
      // A bắt đầu, giữ pending (KHÔNG resolve/reject — promise còn sống).
      await act(async () => {
        ui.current.setPreset('3m');
      });
      // B thay thế A.
      await act(async () => {
        ui.current.setPreset('6m');
      });
      expect(hookState.fetches).toHaveLength(3);
      // B publish partial rồi lỗi → restore S + terminal B.
      const partialB = [makeLead(100, '2026-04')];
      act(() => {
        hookState.fetches[2].onProgress?.(1, partialB, 900);
      });
      expect(ui.current.dbPartial).toBe(true);
      await act(async () => {
        hookState.fetches[2].reject(new Error('B fail'));
      });
      expect(ui.current.dbStatus).toBe('ready');
      expect(ui.current.combined).toHaveLength(1);
      expect(ui.current.combined[0].submissionId).toBe('s-0');
      expect(ui.current.rangeLabel).toBe('2026-09 → 2026-09');
      expect(ui.current.dbError).toBe('B fail');
      // A (pending, đã bị supersede) lỗi muộn: catch của A phải return im lặng,
      // KHÔNG được đổi terminal của B sang A.
      await act(async () => {
        hookState.fetches[1].reject(new Error('A late fail'));
      });
      // Progress muộn của B sau terminal vẫn bị loại, snapshot S giữ nguyên.
      act(() => {
        hookState.fetches[2].onProgress?.(900, [makeLead(101, '2026-04')], 900);
      });
      expect(ui.current.combined).toHaveLength(1);
      expect(ui.current.combined[0].submissionId).toBe('s-0');
      expect(ui.current.rangeLabel).toBe('2026-09 → 2026-09');
      expect(ui.current.dbPartial).toBe(false);
      // Banner lỗi vẫn là của B (không bị A muộn ghi đè).
      expect(ui.current.dbError).toBe('B fail');
    } finally {
      ui.unmount();
    }
  });

  it('đổi preset trong lúc partial: gap của C giữ cờ chưa đủ của snapshot B', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      await act(async () => {
        hookState.fetches[0].resolve(makeResult([makeLead(0, '2026-09')], 1));
      });
      await act(async () => {
        ui.current.setPreset('3m');
      });
      const partialB = [makeLead(100, '2026-07'), makeLead(101, '2026-08')];
      act(() => {
        hookState.fetches[1].onProgress?.(2, partialB, 500);
      });
      expect(ui.current.dbPartial).toBe(true);
      await act(async () => {
        ui.current.setPreset('6m');
      });
      // Gap của C: vẫn hiện partial B + cờ chưa đủ (loaded/total của B), không
      // rớt về nhánh snapshot cũ gây hiểu nhầm 8.610 dòng là số đủ.
      expect(ui.current.dbPartial).toBe(true);
      expect(ui.current.combined).toHaveLength(2);
      expect(ui.current.dbLoaded).toBe(2);
      expect(ui.current.dbTotal).toBe(500);
      expect(ui.current.rangeLabel).toBe('2026-07 → 2026-09');
      // Page đầu C về → chuyển sang partial C.
      const partialC = [makeLead(200, '2026-04')];
      act(() => {
        hookState.fetches[2].onProgress?.(1, partialC, 900);
      });
      expect(ui.current.dbPartial).toBe(true);
      expect(ui.current.combined).toHaveLength(1);
      expect(ui.current.rangeLabel).toBe('2026-04 → 2026-09');
    } finally {
      ui.unmount();
    }
  });
  it('chuỗi chồng A xong → B partial → C lỗi: restore A, không restore partial B', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      await act(async () => {
        hookState.fetches[0].resolve(makeResult([makeLead(0, '2026-09')], 1));
      });
      await act(async () => {
        ui.current.setPreset('3m');
      });
      const partialB = [makeLead(100, '2026-07')];
      act(() => {
        hookState.fetches[1].onProgress?.(1, partialB, 300);
      });
      expect(ui.current.dbPartial).toBe(true);
      await act(async () => {
        ui.current.setPreset('6m');
      });
      // Gap của C: vẫn hiện partial B + cờ chưa đủ của B (không rớt về nhánh
      // snapshot cũ), nhưng lastComplete vẫn là A.
      expect(ui.current.combined).toHaveLength(1);
      expect(ui.current.dbPartial).toBe(true);
      await act(async () => {
        hookState.fetches[2].reject(new Error('C fail'));
      });
      expect(ui.current.dbStatus).toBe('ready');
      expect(ui.current.combined).toHaveLength(1);
      expect(ui.current.combined[0].submissionId).toBe('s-0');
      expect(ui.current.rangeLabel).toBe('2026-09 → 2026-09');
      expect(ui.current.dbPartial).toBe(false);
    } finally {
      ui.unmount();
    }
  });

  it('lần đầu lỗi sau partial: clear partial, hiện lỗi + retry, KHÔNG gán ready', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      expect(hookState.fetches).toHaveLength(1);
      const partial = [makeLead(1, '2026-09')];
      act(() => {
        hookState.fetches[0].onProgress?.(1, partial, 700);
      });
      expect(ui.current.combined).toHaveLength(1);
      await act(async () => {
        hookState.fetches[0].reject(new Error('first fail'));
      });
      expect(ui.current.dbStatus).toBe('error');
      expect(ui.current.dbError).toBe('first fail');
      // Fix ISSUE-3 impl-REV1: partial DB bị loại khỏi hiển thị, không trình
      // bày aggregate thiếu như số cuối.
      expect(ui.current.combined).toHaveLength(0);
      expect(ui.current.visibleLeads).toHaveLength(0);
      expect(ui.current.dbPartial).toBe(false);
      expect(ui.current.dbTotal).toBe(0);
    } finally {
      ui.unmount();
    }
  });

  it('range rỗng (count = 0) là success có commit: rows rỗng + label mới + ready', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      await act(async () => {
        hookState.fetches[0].resolve(makeResult(Array.from({ length: 5 }, (_, i) => makeLead(i, '2026-09')), 5));
      });
      await act(async () => {
        ui.current.setPreset('3m');
      });
      await act(async () => {
        hookState.fetches[1].resolve(makeResult([], 0));
      });
      expect(ui.current.dbStatus).toBe('ready');
      expect(ui.current.combined).toHaveLength(0);
      expect(ui.current.dbTotal).toBe(0);
      expect(ui.current.dbLoaded).toBe(0);
      expect(ui.current.rangeLabel).toBe('2026-07 → 2026-09');
      expect(ui.current.dbPartial).toBe(false);
    } finally {
      ui.unmount();
    }
  });

  it('progress của request cũ sau khi đã đổi preset bị bỏ qua', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      await act(async () => {
        hookState.fetches[0].resolve(makeResult([makeLead(0, '2026-09')], 1));
      });
      await act(async () => {
        ui.current.setPreset('3m');
      });
      // Progress muộn của request 1m cũ (đã supersede) không đụng state mới.
      act(() => {
        hookState.fetches[0].onProgress?.(99, [makeLead(9, '2026-09')], 99);
      });
      expect(ui.current.combined).toHaveLength(1);
      expect(ui.current.combined[0].submissionId).toBe('s-0');
    } finally {
      ui.unmount();
    }
  });

  it('request cũ resolve sau bị bỏ qua (out-of-order success)', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      await act(async () => {
        hookState.fetches[0].resolve(makeResult([makeLead(0, '2026-09')], 1));
      });
      await act(async () => {
        ui.current.setPreset('3m');
      });
      await act(async () => {
        ui.current.setPreset('6m');
      });
      expect(hookState.fetches).toHaveLength(3);
      const rows3m = [makeLead(1, '2026-07'), makeLead(2, '2026-08')];
      await act(async () => {
        hookState.fetches[1].resolve(makeResult(rows3m, 2));
      });
      // Request 3m đã supersede: giữ snapshot A, vẫn loading chờ 6m.
      expect(ui.current.dbStatus).toBe('loading');
      expect(ui.current.combined).toHaveLength(1);
      expect(ui.current.combined[0].submissionId).toBe('s-0');
      expect(ui.current.rangeLabel).toBe('2026-09 → 2026-09');
      const rows6m = [makeLead(3, '2026-04')];
      await act(async () => {
        hookState.fetches[2].resolve(makeResult(rows6m, 1));
      });
      expect(ui.current.dbStatus).toBe('ready');
      expect(ui.current.combined).toHaveLength(1);
      expect(ui.current.rangeLabel).toBe('2026-04 → 2026-09');
    } finally {
      ui.unmount();
    }
  });

  it('request cũ reject sau khi request mới success thì bị bỏ qua', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      await act(async () => {
        hookState.fetches[0].resolve(makeResult([makeLead(0, '2026-09')], 1));
      });
      await act(async () => {
        ui.current.setPreset('3m');
      });
      await act(async () => {
        ui.current.setPreset('6m');
      });
      await act(async () => {
        hookState.fetches[2].resolve(makeResult([makeLead(3, '2026-04')], 1));
      });
      expect(ui.current.dbStatus).toBe('ready');
      await act(async () => {
        hookState.fetches[1].reject(new Error('stale'));
      });
      expect(ui.current.dbError).toBeNull();
      expect(ui.current.combined).toHaveLength(1);
      expect(ui.current.rangeLabel).toBe('2026-04 → 2026-09');
    } finally {
      ui.unmount();
    }
  });
});

describe('useDataSource custom: draft/applied tách bạch', () => {
  it('mở Custom không fetch, prefill từ snapshot đã commit', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      await act(async () => {
        hookState.fetches[0].resolve(makeResult([makeLead(0, '2026-09')], 1));
      });
      const callsBefore = hookState.fetchCalls.length;
      act(() => {
        ui.current.openCustom();
      });
      expect(hookState.fetchCalls.length).toBe(callsBefore);
      expect(ui.current.preset).toBe('custom');
      expect(ui.current.customDraft).toEqual({ from: '2026-09', to: '2026-09' });
    } finally {
      ui.unmount();
    }
  });

  it('draft thiếu/đảo apply là no-op; draft hợp lệ mới fetch bounds custom', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      await act(async () => {
        hookState.fetches[0].resolve(makeResult([makeLead(0, '2026-09')], 1));
      });
      const callsBefore = hookState.fetchCalls.length;
      act(() => {
        ui.current.openCustom();
      });
      act(() => {
        ui.current.setCustomDraft({ from: '2026-09', to: '2026-07' });
      });
      expect(ui.current.customValid).toBe(false);
      act(() => {
        ui.current.applyCustom();
      });
      expect(hookState.fetchCalls.length).toBe(callsBefore);
      act(() => {
        ui.current.setCustomDraft({ from: '2026-07', to: '2026-08' });
      });
      expect(ui.current.customValid).toBe(true);
      await act(async () => {
        ui.current.applyCustom();
      });
      expect(hookState.fetchCalls.length).toBe(callsBefore + 1);
      expect(hookState.fetchCalls[hookState.fetchCalls.length - 1]).toMatchObject({
        preset: 'custom',
        monthFrom: '2026-07',
        monthTo: '2026-08',
      });
      await act(async () => {
        const last = hookState.fetches[hookState.fetches.length - 1];
        last.resolve(makeResult([makeLead(1, '2026-07'), makeLead(2, '2026-08')], 2));
      });
      expect(ui.current.rangeLabel).toBe('2026-07 → 2026-08');
      expect(ui.current.combined).toHaveLength(2);
    } finally {
      ui.unmount();
    }
  });

  it('reload (đường CSV-save) dùng applied, không dùng draft đang mở', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      await act(async () => {
        hookState.fetches[0].resolve(makeResult([makeLead(0, '2026-09')], 1));
      });
      act(() => {
        ui.current.openCustom();
      });
      act(() => {
        ui.current.setCustomDraft({ from: '2026-01', to: '2026-02' });
      });
      const callsBefore = hookState.fetchCalls.length;
      await act(async () => {
        ui.current.reloadDb();
      });
      expect(hookState.fetchCalls.length).toBe(callsBefore + 1);
      expect(hookState.fetchCalls[hookState.fetchCalls.length - 1]).toMatchObject({ preset: '1m' });
    } finally {
      ui.unmount();
    }
  });

  it('xem Tất cả rồi mở Custom thì draft rỗng (không dùng range cũ)', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      await act(async () => {
        hookState.fetches[0].resolve(makeResult([makeLead(0, '2026-09')], 1));
      });
      await act(async () => {
        ui.current.setPreset('all');
      });
      await act(async () => {
        hookState.fetches[1].resolve(makeResult([makeLead(0, '2026-09'), makeLead(1, '2026-07')], 2));
      });
      expect(ui.current.rangeLabel).toBeNull();
      act(() => {
        ui.current.openCustom();
      });
      expect(ui.current.customDraft).toEqual({ from: '', to: '' });
    } finally {
      ui.unmount();
    }
  });

  it('custom apply lỗi rồi mở lại Custom thì prefill snapshot cũ (không phải applied lỗi)', async () => {
    const ui = renderDataSource();
    try {
      await flush();
      await act(async () => {
        hookState.fetches[0].resolve(makeResult([makeLead(0, '2026-09')], 1));
      });
      act(() => {
        ui.current.openCustom();
      });
      act(() => {
        ui.current.setCustomDraft({ from: '2026-07', to: '2026-08' });
      });
      await act(async () => {
        ui.current.applyCustom();
      });
      await act(async () => {
        const last = hookState.fetches[hookState.fetches.length - 1];
        last.reject(new Error('custom fail'));
      });
      expect(ui.current.dbStatus).toBe('ready');
      expect(ui.current.rangeLabel).toBe('2026-09 → 2026-09');
      act(() => {
        ui.current.openCustom();
      });
      expect(ui.current.customDraft).toEqual({ from: '2026-09', to: '2026-09' });
    } finally {
      ui.unmount();
    }
  });
});
