import type { Lead, ParseProgress } from '@/types/lead';

export interface ParseRequest {
  file: File;
  noPii: boolean;
}

export type ParseResponse =
  | { type: 'progress'; payload: ParseProgress }
  | { type: 'done'; payload: { leads: Lead[]; totalRows: number; warnings: string[] } }
  | { type: 'error'; payload: string };
