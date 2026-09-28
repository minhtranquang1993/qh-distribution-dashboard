import { HIGH_BUDGET_MIN, type BudgetBucket, type LeadTier } from '@/types/lead';

/**
 * Lead score weights (max 100). Budget dominates because it is the strongest
 * available proxy for lead quality until real sales outcomes exist.
 */
export const SCORE_WEIGHTS = {
  budget: 40,
  type: 25,
  howKnow: 15,
  geo: 10,
  contact: 10,
} as const;

export const TIER_THRESHOLDS = { mql: 70, nurture: 45 } as const;

const BUDGET_SCORE: Record<BudgetBucket, number> = {
  'Below $5,000': 5,
  'Above $5,000 - $20,000': 20,
  'Above $20,000 - $50,000': 32,
  'Above $50,000 - $100,000': 37,
  'Above $100,000': 40,
};

const TYPE_SCORE: Record<string, number> = {
  Wholesaler: 25,
  'Retail Chain (More than 5 stores)': 22,
  'E-commerce (Amazon, Ebay, etc.)': 12,
  'Your own website': 12,
  'Pharmacy/ Drugstore': 12,
  'Boutique Store': 8,
  'Beauty Salon/ Spa': 8,
  Others: 8,
};

const HOW_KNOW_SCORE: Record<string, number> = {
  Tradeshow: 15,
  Linkedin: 15,
  WhatsApp: 15,
  'Refferal (vendors, friends, etc)': 15,
  Google: 10,
  'AI chatbot (ChatGPT, Gemini, etc)': 10,
  Others: 10,
  Facebook: 6,
  Instagram: 6,
};

/** Markets where a registered business is a stronger wholesale signal. */
const STRONG_MARKETS = new Set([
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'Germany',
  'France',
  'Netherlands',
  'Ireland',
]);

export const BUDGET_ORDER: BudgetBucket[] = [
  'Below $5,000',
  'Above $5,000 - $20,000',
  'Above $20,000 - $50,000',
  'Above $50,000 - $100,000',
  'Above $100,000',
];

export function isHighBudget(bucket: string): boolean {
  const idx = BUDGET_ORDER.indexOf(bucket as BudgetBucket);
  return idx >= BUDGET_ORDER.indexOf(HIGH_BUDGET_MIN);
}

export function budgetPoints(bucket: string): number {
  return BUDGET_SCORE[bucket as BudgetBucket] ?? 0;
}

export function typePoints(typeCompany: string): number {
  return TYPE_SCORE[typeCompany] ?? 8;
}

export function howKnowPoints(howKnow: string): number {
  return HOW_KNOW_SCORE[howKnow] ?? 8;
}

export function geoPoints(location: string, registered: string, distribute: string): number {
  const geo = [location, registered, distribute].map((g) => g.trim().toLowerCase());
  const present = geo.filter(Boolean);
  if (present.length === 0) return 0;
  const distinct = new Set(present);
  // All three agreeing is a consistent self-report; a single mismatch is weak.
  let points = distinct.size === 1 ? SCORE_WEIGHTS.geo : distinct.size === 2 ? 6 : 2;
  if (STRONG_MARKETS.has(registered)) points += 2;
  return Math.min(points, SCORE_WEIGHTS.geo);
}

export function contactPoints(emailValid: boolean, phoneValid: boolean, hasCompany: boolean): number {
  let points = 0;
  if (emailValid) points += 4;
  if (phoneValid) points += 4;
  if (hasCompany) points += 2;
  return Math.min(points, SCORE_WEIGHTS.contact);
}

export interface ScoreInput {
  budgetBucket: string;
  typeCompany: string;
  howKnow: string;
  location: string;
  registeredCountry: string;
  distributeCountry: string;
  emailValid: boolean;
  phoneValid: boolean;
  hasCompany: boolean;
}

export function computeScore(input: ScoreInput): number {
  return (
    budgetPoints(input.budgetBucket) +
    typePoints(input.typeCompany) +
    howKnowPoints(input.howKnow) +
    geoPoints(input.location, input.registeredCountry, input.distributeCountry) +
    contactPoints(input.emailValid, input.phoneValid, input.hasCompany)
  );
}

/**
 * Hard gates run before bucketing: a lead that fails any of these must never
 * reach MQL, no matter how attractive its declared budget looks.
 */
export function evaluateGates(input: {
  emailValid: boolean;
  phoneValid: boolean;
  isDuplicate: boolean;
  spamSignals: string[];
  severeGeoMismatch: boolean;
  hasName: boolean;
}): { passed: boolean; signals: string[] } {
  const signals: string[] = [];
  if (!input.emailValid) signals.push('invalid_email');
  if (!input.phoneValid) signals.push('invalid_phone');
  if (!input.hasName) signals.push('missing_name');
  if (input.spamSignals.length > 0) signals.push(...input.spamSignals);
  if (input.isDuplicate) signals.push('duplicate');
  if (input.severeGeoMismatch) signals.push('severe_geo_mismatch');
  return { passed: signals.length === 0, signals };
}

export function tierFor(score: number, gateFailed: boolean): LeadTier {
  if (gateFailed) return 'Review';
  if (score >= TIER_THRESHOLDS.mql) return 'MQL';
  if (score >= TIER_THRESHOLDS.nurture) return 'Nurture';
  return 'Low';
}
