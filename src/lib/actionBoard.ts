/**
 * Action Board: ranks every segment into a decision bucket so the dashboard
 * answers "where do I cut, where do I scale" without needing spend data.
 *
 * Buckets are deliberately conservative — anything uncertain falls into
 * Investigate or Needs Spend Data rather than being recommended to scale.
 */

import {
  MIN_N_ACTIONABLE,
  MIN_N_EXPLORATORY,
  type SegmentStats,
} from '@/lib/metrics';
import type { Lead } from '@/types/lead';

export const ACTIONS = ['Scale', 'Watch', 'Investigate', 'Fix Tracking', 'Cut/Exclude', 'Needs Spend Data'] as const;
export type ActionBucket = (typeof ACTIONS)[number];

export interface ActionItem {
  dimension: string;
  segment: string;
  action: ActionBucket;
  reason: string;
  stats: SegmentStats;
}

export interface ActionBoardInput {
  leads: Lead[];
  sourceSegments: SegmentStats[];
  mediumSegments: SegmentStats[];
  typeSegments: SegmentStats[];
  geoSegments: SegmentStats[];
  termSegments: SegmentStats[];
  contentSegments: SegmentStats[];
}

function decide(stats: SegmentStats): { action: ActionBucket; reason: string } {
  const { n, mqlRate, duplicateRate, spamRate, geoMismatchRate, missingTrackingRate, confidence } = stats;

  if (confidence === 'exploratory') {
    return {
      action: 'Investigate',
      reason: `Chỉ ${n} lead (< ${MIN_N_EXPLORATORY}) — cần thêm dữ liệu trước khi kết luận`,
    };
  }

  if (missingTrackingRate > 0.5) {
    return {
      action: 'Fix Tracking',
      reason: `${(missingTrackingRate * 100).toFixed(0)}% thiếu UTM — sửa tracking trước khi đánh giá`,
    };
  }

  if (confidence === 'medium' || mqlRate < 0.1) {
    return {
      action: 'Watch',
      reason:
        mqlRate < 0.1
          ? `MQL rate ${(mqlRate * 100).toFixed(1)}% dưới ngưỡng 10% — theo dõi thêm`
          : `Mẫu ${n} lead chưa đủ tin cậy để scale`,
    };
  }

  if (duplicateRate > 0.3 || spamRate > 0.2) {
    if (spamRate > 0.2) {
      return {
        action: 'Cut/Exclude',
        reason: `Rác ${(spamRate * 100).toFixed(0)}% — loại khỏi target`,
      };
    }
    return {
      action: 'Cut/Exclude',
      reason: 'Chất lượng thấp — loại khỏi target',
    };
  }

  if (geoMismatchRate > 0.4) {
    return {
      action: 'Investigate',
      reason: `${(geoMismatchRate * 100).toFixed(0)}% geo không nhất quán — nghi proxy/VPN`,
    };
  }

  if (mqlRate >= 0.18 && n >= MIN_N_ACTIONABLE) {
    return {
      action: 'Scale',
      reason: `MQL rate ${(mqlRate * 100).toFixed(1)}% trên ${n} lead — ứng viên scale`,
    };
  }

  return {
    action: 'Needs Spend Data',
    reason: `MQL rate ${(mqlRate * 100).toFixed(1)}% ổn — cần CPL/CP-MQL mới chốt có scale không`,
  };
}

export function buildActionBoard(input: ActionBoardInput): ActionItem[] {
  const dimensions: Array<[string, SegmentStats[]]> = [
    ['Source', input.sourceSegments],
    ['Medium', input.mediumSegments],
    ['Type', input.typeSegments],
    ['Geo', input.geoSegments],
    ['Term', input.termSegments],
    ['Content', input.contentSegments],
  ];

  const items: ActionItem[] = [];
  for (const [dimension, segments] of dimensions) {
    for (const stats of segments) {
      if (stats.n < MIN_N_EXPLORATORY) continue;
      const { action, reason } = decide(stats);
      items.push({ dimension, segment: stats.key, action, reason, stats });
    }
  }

  const order = new Map(ACTIONS.map((a, i) => [a, i]));
  return items.sort(
    (a, b) => order.get(a.action)! - order.get(b.action)! || b.stats.n - a.stats.n,
  );
}
