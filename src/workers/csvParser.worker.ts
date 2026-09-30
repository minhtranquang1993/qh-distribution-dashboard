/**
 * CSV parsing worker. The 67MB source file is read, parsed, transformed and
 * scored entirely off the main thread, so the UI keeps rendering its progress
 * bar while this runs.
 */

import Papa from 'papaparse';
import type { RawRow } from '@/types/raw';
import { transformRows } from '@/lib/transform';
import type { ParseRequest, ParseResponse, RawPassthrough } from '@/workers/messages';

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
        // Giữ 10 cột raw cần cho DB (không recaptcha). Chỉ dòng có
        // submission_id mới đi tiếp, khớp semantics transformRows.
        // Bản production (noPii): blank cột PII thô trước khi gửi —
        // nếu không PII sẽ rò qua Edge Function dù leads đã strip.
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
        post({ type: 'done', payload: { leads, totalRows, warnings, raw } });
      },
      error: (err) => {
        post({ type: 'error', payload: err.message ?? 'Failed to parse CSV' });
      },
    });
  } catch (err) {
    post({ type: 'error', payload: err instanceof Error ? err.message : 'Unknown parse error' });
  }
};
