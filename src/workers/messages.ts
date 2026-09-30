import type { Lead, ParseProgress } from '@/types/lead';

export interface ParseRequest {
  file: File;
  noPii: boolean;
}

export interface RawPassthrough {
  URL?: string;
  first_source_url?: string;
  Company?: string;
  Name?: string;
  Email?: string;
  'calling-code'?: string;
  Phone?: string;
  'your-type-of-business-or-the-website'?: string;
  'top-brands-you-are-looking-for'?: string;
  'estimated-monthly-amount-dollar-you-wish-to-buy-from-us'?: string;
  Week?: string;
  Month?: string;
  Day?: string;
}

export type ParseResponse =
  | { type: 'progress'; payload: ParseProgress }
  | { type: 'done'; payload: { leads: Lead[]; totalRows: number; warnings: string[]; raw: RawPassthrough[] } }
  | { type: 'error'; payload: string };
