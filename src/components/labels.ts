/** Human-readable labels for dashboard tables, kept out of component files
 *  so React Fast Refresh keeps working. */

const TIER_LABELS: Record<string, string> = {
  MQL: 'MQL — ưu tiên gọi',
  Nurture: 'Nurture — nuôi dưỡng',
  Low: 'Low — recycle',
  Review: 'Review — cần kiểm tra',
};

export function tierLabel(tier: string): string {
  return TIER_LABELS[tier] ?? tier;
}

export function basisLabel(basis: string): string {
  if (basis === 'submit_url') return 'Submit URL (tốt nhất)';
  if (basis === 'first_source_fallback') return 'Fallback first_source_url';
  return 'Không rõ nguồn';
}
