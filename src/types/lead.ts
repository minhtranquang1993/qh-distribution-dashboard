/** Core domain types for the wholesale lead quality dashboard. */

export const BUDGET_BUCKETS = [
  'Below $5,000',
  'Above $5,000 - $20,000',
  'Above $20,000 - $50,000',
  'Above $50,000 - $100,000',
  'Above $100,000',
] as const;

export type BudgetBucket = (typeof BUDGET_BUCKETS)[number];

/** Budget >= $20k is the working proxy for "qualified" while no sales outcome exists. */
export const HIGH_BUDGET_MIN: BudgetBucket = 'Above $20,000 - $50,000';

export const LEAD_TIERS = ['MQL', 'Nurture', 'Low', 'Review'] as const;
export type LeadTier = (typeof LEAD_TIERS)[number];

export const ATTRIBUTION_BASES = ['submit_url', 'first_source_fallback', 'unknown'] as const;
export type AttributionBasis = (typeof ATTRIBUTION_BASES)[number];

export const METRIC_MODES = ['raw', 'unique', 'dupe_groups'] as const;
export type MetricMode = (typeof METRIC_MODES)[number];

/** A single normalized lead. PII fields are omitted in the public-safe build. */
export interface Lead {
  submissionId: string;
  submittedAt: string;
  email: string;
  phone: string;
  name: string;
  company: string;

  location: string;
  registeredCountry: string;
  distributeCountry: string;

  budgetBucket: BudgetBucket;
  typeCompany: string;
  howKnow: string;
  contactPref: string;
  website: string;
  brands: string[];

  submitUtm: UtmSet;
  firstTouchUtm: UtmSet;
  chosenUtm: UtmSet;
  attributionBasis: AttributionBasis;

  firstUserSource: string;
  firstUserMedium: string;
  firstSourceUrl: string;

  geoMismatch: boolean;
  /** All three geo fields disagree — the pattern that tracks proxy/VPN traffic. */
  severeGeoMismatch: boolean;
  emailValid: boolean;
  phoneValid: boolean;
  isDuplicate: boolean;
  duplicateCount: number;
  spamSignals: string[];

  score: number;
  tier: LeadTier;
  gateFailed: boolean;
  /**
   * Salted digest identifying this contact within a single parse. Rendered and
   * exported, so it is neither the contact value nor derivable from it. Not
   * stable across parses — a fresh salt is generated per upload.
   */
  leadKey: string;
}

export interface UtmSet {
  source: string;
  medium: string;
  term: string;
  content: string;
  campaign: string;
}

export const EMPTY_UTM: UtmSet = { source: '', medium: '', term: '', content: '', campaign: '' };

/** Lead with every PII field blanked — the only shape the public build ever holds. */
export type SafeLead = Omit<Lead, 'email' | 'phone' | 'name' | 'company' | 'website'>;

export interface ParseOptions {
  /** When true, PII is dropped and only SafeLead rows are returned. */
  noPii: boolean;
}

export interface ParseProgress {
  stage: 'reading' | 'normalizing' | 'scoring' | 'done';
  rowsProcessed: number;
  totalRows: number;
}

export interface ParseResult {
  leads: Lead[];
  /** Row count from the source file, for verification against processed leads. */
  totalRows: number;
  warnings: string[];
}
