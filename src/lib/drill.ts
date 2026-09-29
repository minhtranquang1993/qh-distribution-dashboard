/** Segment drill: click bất kỳ segment/chart nào → xem lead mẫu ở tab Leads. */
import type { Lead } from '@/types/lead';

export type DrillDimension =
  | 'source'
  | 'medium'
  | 'howKnow'
  | 'type'
  | 'geo'
  | 'term'
  | 'content'
  | 'budget'
  | 'tier'
  | 'brand';

export interface Drill {
  dimension: DrillDimension;
  key: string;
  title: string;
}

export const DIMENSION_LABEL: Record<DrillDimension, string> = {
  source: 'Source',
  medium: 'Medium',
  howKnow: 'Biết qua',
  type: 'Loại hình',
  geo: 'Quốc gia',
  term: 'Term',
  content: 'Content',
  budget: 'Ngân sách',
  tier: 'Tier',
  brand: 'Thương hiệu',
};

export function drillKeyOf(dimension: DrillDimension, lead: Lead): string {
  switch (dimension) {
    case 'source':
      return lead.chosenUtm.source || lead.firstUserSource || '(unknown)';
    case 'medium':
      return lead.chosenUtm.medium || lead.firstUserMedium || '(unknown)';
    case 'howKnow':
      return lead.howKnow || '(unknown)';
    case 'type':
      return lead.typeCompany || 'Others';
    case 'geo':
      return lead.registeredCountry || '(unknown)';
    case 'term':
      return lead.chosenUtm.term || '(no term)';
    case 'content':
      return lead.chosenUtm.content || '(no content)';
    case 'budget':
      return lead.budgetBucket;
    case 'tier':
      return lead.tier;
    case 'brand':
      return '';
  }
}

export function leadsForDrill(leads: Lead[], drill: Drill): Lead[] {
  if (drill.dimension === 'brand') return leads.filter((l) => l.brands.includes(drill.key));
  return leads.filter((l) => drillKeyOf(drill.dimension, l) === drill.key);
}

/** Map dimension label của ActionBoard engine → DrillDimension. */
export function actionDimensionToDrill(dimension: string): DrillDimension | null {
  switch (dimension) {
    case 'Source':
      return 'source';
    case 'Medium':
      return 'medium';
    case 'Type':
      return 'type';
    case 'Geo':
      return 'geo';
    case 'Term':
      return 'term';
    case 'Content':
      return 'content';
    default:
      return null;
  }
}
