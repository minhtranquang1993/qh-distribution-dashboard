/**
 * Aggregation layer. Every ranking function counts each submission as one lead.
 */

import { BUDGET_ORDER, isHighBudget } from '@/lib/scoring';
import type { Lead } from '@/types/lead';

/** Minimum sample before a segment is treated as actionable. */
export const MIN_N_ACTIONABLE = 100;
export const MIN_N_EXPLORATORY = 30;

export type Confidence = 'high' | 'medium' | 'exploratory';

export interface SegmentStats {
  key: string;
  n: number;
  highBudgetRate: number;
  mqlRate: number;
  duplicateRate: number;
  geoMismatchRate: number;
  missingTrackingRate: number;
  spamRate: number;
  confidence: Confidence;
}

export function confidenceFor(n: number): Confidence {
  if (n >= MIN_N_ACTIONABLE) return 'high';
  if (n >= MIN_N_EXPLORATORY) return 'medium';
  return 'exploratory';
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

export function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Guarded percent-of-total for UI tooltips: empty cohort renders 0.0%, never NaN. */
export function pctOf(value: number, total: number, digits = 1): string {
  return pct(total === 0 ? 0 : value / total, digits);
}

/** Tooltip label factory for funnel/budget charts sharing the guarded percent. */
export function makeShareLabel(total: number) {
  return (value: number) => [`${value.toLocaleString('vi-VN')} (${pctOf(value, total)})`, 'Số lượng'] as const;
}

function hasTracking(lead: Lead): boolean {
  return Boolean(lead.chosenUtm.source || lead.chosenUtm.medium || lead.chosenUtm.campaign);
}

function statsFor(leads: Lead[]): Omit<SegmentStats, 'key'> {
  const n = leads.length;
  const highBudget = leads.filter((l) => isHighBudget(l.budgetBucket)).length;
  const mql = leads.filter((l) => l.tier === 'MQL').length;
  const dupes = leads.filter((l) => l.duplicateCount > 1).length;
  const mismatch = leads.filter((l) => l.geoMismatch).length;
  const noTracking = leads.filter((l) => !hasTracking(l)).length;
  const spam = leads.filter((l) => l.spamSignals.length > 0).length;
  return {
    n,
    highBudgetRate: rate(highBudget, n),
    mqlRate: rate(mql, n),
    duplicateRate: rate(dupes, n),
    geoMismatchRate: rate(mismatch, n),
    missingTrackingRate: rate(noTracking, n),
    spamRate: rate(spam, n),
    confidence: confidenceFor(n),
  };
}

/** Generic grouping used by the channel, geo, and firmographic modules. */
export function groupSegments(
  leads: Lead[],
  keyFn: (lead: Lead) => string,
  { minN = 1 }: { minN?: number } = {},
): SegmentStats[] {
  const groups = new Map<string, Lead[]>();
  for (const lead of leads) {
    const key = keyFn(lead) || '(unknown)';
    const bucket = groups.get(key);
    if (bucket) bucket.push(lead);
    else groups.set(key, [lead]);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length >= minN)
    .map(([key, group]) => ({ key, ...statsFor(group) }))
    .sort((a, b) => b.mqlRate - a.mqlRate || b.n - a.n);
}

export function sourceSegments(leads: Lead[]): SegmentStats[] {
  return groupSegments(leads, (l) => l.chosenUtm.source || l.firstUserSource || '(unknown)');
}

export function mediumSegments(leads: Lead[]): SegmentStats[] {
  return groupSegments(leads, (l) => l.chosenUtm.medium || l.firstUserMedium || '(unknown)');
}

export function howKnowSegments(leads: Lead[]): SegmentStats[] {
  return groupSegments(leads, (l) => l.howKnow || '(unknown)');
}

export function typeCompanySegments(leads: Lead[]): SegmentStats[] {
  return groupSegments(leads, (l) => l.typeCompany || 'Others');
}

export function geoSegments(leads: Lead[]): SegmentStats[] {
  return groupSegments(leads, (l) => l.registeredCountry || '(unknown)');
}

export interface CreativeCell extends SegmentStats {
  term: string;
  content: string;
}

/** utm_term × utm_content matrix, restricted to combinations with enough rows. */
export function creativeMatrix(leads: Lead[], minN = MIN_N_EXPLORATORY): CreativeCell[] {
  return groupSegments(leads, (l) => `${l.chosenUtm.term || '(no term)'}||${l.chosenUtm.content || '(no content)'}`, {
    minN,
  })
    .map((segment) => {
      const [term, content] = segment.key.split('||');
      return { ...segment, key: segment.key, term, content };
    })
    .sort((a, b) => b.mqlRate - a.mqlRate || b.n - a.n);
}

export interface BrandStats {
  brand: string;
  n: number;
  highBudgetRate: number;
  mqlRate: number;
}

/** Brand demand counts each lead once per distinct brand it listed. */
export function brandDemand(leads: Lead[], minN = MIN_N_EXPLORATORY): BrandStats[] {
  const groups = new Map<string, Lead[]>();
  for (const lead of leads) {
    for (const brand of new Set(lead.brands)) {
      const bucket = groups.get(brand);
      if (bucket) bucket.push(lead);
      else groups.set(brand, [lead]);
    }
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length >= minN)
    .map(([brand, group]) => ({
      brand,
      n: group.length,
      highBudgetRate: rate(group.filter((l) => isHighBudget(l.budgetBucket)).length, group.length),
      mqlRate: rate(group.filter((l) => l.tier === 'MQL').length, group.length),
    }))
    .sort((a, b) => b.n - a.n);
}

export interface TypeBudgetCell {
  typeCompany: string;
  budgetBucket: string;
  n: number;
}

/** type-company × budget cross-tab for the firmographic module. */
export function typeBudgetMatrix(leads: Lead[]): TypeBudgetCell[] {
  const groups = new Map<string, number>();
  for (const lead of leads) {
    const key = `${lead.typeCompany}||${lead.budgetBucket}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([key, n]) => {
      const [typeCompany, budgetBucket] = key.split('||');
      return { typeCompany, budgetBucket, n };
    })
    .sort((a, b) => b.n - a.n);
}

export interface BudgetMix {
  bucket: string;
  n: number;
  share: number;
}

export function budgetMix(leads: Lead[]): BudgetMix[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    counts.set(lead.budgetBucket, (counts.get(lead.budgetBucket) ?? 0) + 1);
  }
  const total = leads.length;
  return BUDGET_ORDER.filter((bucket) => counts.has(bucket)).map((bucket) => ({
    bucket,
    n: counts.get(bucket) ?? 0,
    share: rate(counts.get(bucket) ?? 0, total),
  }));
}

export interface OverviewStats {
  totalLeads: number;
  totalSubmissions: number;
  mqlCount: number;
  mqlRate: number;
  highBudgetCount: number;
  highBudgetRate: number;
  geoMismatchRate: number;
  spamRate: number;
  attributionCoverage: { basis: string; n: number; share: number }[];
  trackingCoverage: number;
  tierCounts: Record<string, number>;
}

export function overview(leads: Lead[]): OverviewStats {
  const total = leads.length;
  const basisCounts = new Map<string, number>();
  for (const lead of leads) {
    basisCounts.set(lead.attributionBasis, (basisCounts.get(lead.attributionBasis) ?? 0) + 1);
  }
  const tierCounts: Record<string, number> = {};
  for (const lead of leads) {
    tierCounts[lead.tier] = (tierCounts[lead.tier] ?? 0) + 1;
  }
  return {
    totalLeads: total,
    totalSubmissions: total,
    mqlCount: tierCounts.MQL ?? 0,
    mqlRate: rate(tierCounts.MQL ?? 0, total),
    highBudgetCount: leads.filter((l) => isHighBudget(l.budgetBucket)).length,
    highBudgetRate: rate(leads.filter((l) => isHighBudget(l.budgetBucket)).length, total),
    geoMismatchRate: rate(leads.filter((l) => l.geoMismatch).length, total),
    spamRate: rate(leads.filter((l) => l.spamSignals.length > 0).length, total),
    attributionCoverage: [...basisCounts.entries()]
      .map(([basis, n]) => ({ basis, n, share: rate(n, total) }))
      .sort((a, b) => b.n - a.n),
    trackingCoverage: rate(leads.filter(hasTracking).length, total),
    tierCounts,
  };
}

export interface TrendPoint {
  label: string;
  n: number;
  mql: number;
  highBudget: number;
}

/** Monthly trend from the submission_date string, e.g. "1/1/2026 0:20". */
export function monthlyTrend(leads: Lead[]): TrendPoint[] {
  const groups = new Map<string, Lead[]>();
  for (const lead of leads) {
    const month = lead.submittedAt.split('/')[0];
    if (!month) continue;
    const key = `2026-${month.padStart(2, '0')}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(lead);
    else groups.set(key, [lead]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, group]) => ({
      label,
      n: group.length,
      mql: group.filter((l) => l.tier === 'MQL').length,
      highBudget: group.filter((l) => isHighBudget(l.budgetBucket)).length,
    }));
}
