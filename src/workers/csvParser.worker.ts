/**
 * CSV parsing worker. The 67MB source file is read, parsed, transformed and
 * scored entirely off the main thread, so the UI keeps rendering its progress
 * bar while this runs.
 */

import Papa from 'papaparse';
import type { RawRow } from '@/types/raw';
import { transformRows } from '@/lib/transform';
import type { ParseRequest, ParseResponse } from '@/workers/messages';

const ctx = self as unknown as Worker;

function post(message: ParseResponse) {
  ctx.postMessage(message);
}

ctx.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { file, noPii } = event.data;
  try {
    // Scoped to this request: a second upload must not inherit the first
    // upload's rows, or every total, denominator, and decision is corrupted.
    const collected: RawRow[] = [];
    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      chunkSize: 1024 * 1024,
      chunk: (results, parser) => {
        // Chunks stream in and are accumulated so the dedupe pass can see every
        // lead before scoring is finalized.
        collected.push(...results.data);
        post({
          type: 'progress',
          payload: { stage: 'reading', rowsProcessed: collected.length, totalRows: 0 },
        });
        parser.pause();
        // Yield to the event loop so progress messages actually flush.
        setTimeout(() => parser.resume(), 0);
      },
      complete: async () => {
        post({
          type: 'progress',
          payload: { stage: 'scoring', rowsProcessed: collected.length, totalRows: collected.length },
        });
        const { leads, totalRows, warnings } = await transformRows(collected, { noPii });
        post({ type: 'done', payload: { leads, totalRows, warnings } });
      },
      error: (err) => {
        post({ type: 'error', payload: err.message ?? 'Failed to parse CSV' });
      },
    });
  } catch (err) {
    post({ type: 'error', payload: err instanceof Error ? err.message : 'Unknown parse error' });
  }
};
