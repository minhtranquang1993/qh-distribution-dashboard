/**
 * Client cho Edge Function `ingest-leads`: ghi leads đã parse vào Supabase.
 * Protocol 3 action, chunk 500 dòng:
 * create_batch → append × N → finalize.
 *
 * Dedupe `submission_id` global (giữ dòng đầu, khớp import script) TRƯỚC khi
 * chunk — function chỉ dedupe trong chunk như safety net, không đảm bảo
 * xuyên chunk. `seq` = index trong payload đã dedupe (khớp file-order).
 */

import type { Lead } from '@/types/lead';
import type { RawPassthrough } from '@/workers/messages';

const CHUNK = 500;

export interface AppendItem {
  lead: Lead;
  raw: RawPassthrough;
  /** Vị trí trong payload đã dedupe global (file-order). */
  seq: number;
}

function functionUrl(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return null;
  return `${url.replace(/\/$/, '')}/functions/v1/ingest-leads`;
}

async function call(action: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = functionUrl();
  if (!url) throw new Error('Supabase chưa cấu hình');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  if (!res.ok) throw new Error(`Lưu DB thất bại (${res.status})`);
  return (await res.json()) as Record<string, unknown>;
}

export interface SaveProgress {
  saved: number;
  total: number;
}

/**
 * Dedupe global theo submission_id (giữ dòng đầu), trả về items kèm seq.
 * Khớp logic import-to-supabase.ts:51-65.
 */
export function dedupeForSave(leads: Lead[], raw: RawPassthrough[]): AppendItem[] {
  const seen = new Set<string>();
  const out: AppendItem[] = [];
  for (let i = 0; i < leads.length; i += 1) {
    const lead = leads[i];
    if (!lead?.submissionId || seen.has(lead.submissionId)) continue;
    seen.add(lead.submissionId);
    out.push({ lead, raw: raw[i] ?? {}, seq: out.length });
  }
  return out;
}

/** Checksum đơn giản của submissionIds đã dedupe — key chống lưu trùng. */
export function saveKeyOf(fileName: string, items: AppendItem[]): string {
  let h = 0;
  const s = `${fileName}::${items.length}::${items.map((it) => it.lead.submissionId).join(',')}`;
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `${fileName}::${items.length}::${(h >>> 0).toString(16)}`;
}

/**
 * Lưu leads + raw vào DB qua Edge Function. Function enforce no-PII
 * server-side nên client cứ gửi đủ (worker prod đã strip PII).
 */
export async function saveLeadsToDb(
  leads: Lead[],
  raw: RawPassthrough[],
  fileName: string,
  fileRowCount: number,
  onProgress?: (p: SaveProgress) => void,
): Promise<{ batchId: string; saveKey: string }> {
  const items = dedupeForSave(leads, raw);
  const total = items.length;
  const created = (await call('create_batch', { fileName, fileRowCount })) as { batch_id: string };
  const batchId = created.batch_id;
  if (!batchId) throw new Error('Tạo batch thất bại');

  let saved = 0;
  for (let from = 0; from < total; from += CHUNK) {
    const chunk = items.slice(from, from + CHUNK);
    await call('append', { batch_id: batchId, items: chunk });
    saved += chunk.length;
    onProgress?.({ saved, total });
  }

  await call('finalize', { batch_id: batchId });
  return { batchId, saveKey: saveKeyOf(fileName, items) };
}
