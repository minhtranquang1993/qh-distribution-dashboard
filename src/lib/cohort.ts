/** Global cohort filter (FIX-5): mọi metric hiển thị tính trên filtered cohort. */
import type { BudgetBucket, Lead, LeadTier } from '@/types/lead';

export interface CohortFilter {
  /** YYYY-MM, rỗng = không giới hạn */
  monthFrom: string;
  monthTo: string;
  /** Rỗng = tất cả */
  budgets: BudgetBucket[];
  tiers: LeadTier[];
}

export const EMPTY_FILTER: CohortFilter = { monthFrom: '', monthTo: '', budgets: [], tiers: [] };

export function isFiltered(f: CohortFilter): boolean {
  return Boolean(f.monthFrom || f.monthTo || f.budgets.length > 0 || f.tiers.length > 0);
}

/** "1/1/2026 0:20" → "2026-01". Trả '' khi không parse được (dòng đó luôn giữ lại). */
export function monthKeyOf(submittedAt: string): string {
  const m = /^\s*(\d{1,2})\/\d{1,2}\/(\d{4})/.exec(submittedAt ?? '');
  if (!m) return '';
  return `${m[2]}-${m[1].padStart(2, '0')}`;
}

export function applyFilters(leads: Lead[], f: CohortFilter): Lead[] {
  if (!isFiltered(f)) return leads;
  return leads.filter((l) => {
    if (f.budgets.length > 0 && !f.budgets.includes(l.budgetBucket)) return false;
    if (f.tiers.length > 0 && !f.tiers.includes(l.tier)) return false;
    if (f.monthFrom || f.monthTo) {
      const key = monthKeyOf(l.submittedAt);
      if (!key) return true;
      if (f.monthFrom && key < f.monthFrom) return false;
      if (f.monthTo && key > f.monthTo) return false;
    }
    return true;
  });
}

/** Nhãn chip hiển thị filter đang active (FIX-5: filter context). */
export function activeFilterLabels(f: CohortFilter): string[] {
  const out: string[] = [];
  if (f.monthFrom || f.monthTo) out.push(`Tháng ${f.monthFrom || '…'} → ${f.monthTo || '…'}`);
  for (const b of f.budgets) out.push(shortBudget(b));
  for (const t of f.tiers) out.push(t);
  return out;
}

export function shortBudget(bucket: string): string {
  if (bucket === 'Below $5,000') return '<$5k';
  if (bucket === 'Above $5,000 - $20,000') return '$5–20k';
  if (bucket === 'Above $20,000 - $50,000') return '$20–50k';
  if (bucket === 'Above $50,000 - $100,000') return '$50–100k';
  if (bucket === 'Above $100,000') return '>$100k';
  return bucket;
}
