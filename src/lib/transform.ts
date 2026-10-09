/**
 * Pure transform from raw CSV rows to scored leads. Kept free of DOM and worker
 * APIs so the same code runs in the Web Worker, in tests, and in any future
 * Node-side ingest script.
 */

import {
  BUDGET_BUCKETS,
  type BudgetBucket,
  type Lead,
  type LeadTier,
  type UtmSet,
} from '@/types/lead';
import type { RawRow } from '@/types/raw';
import { computeScore, evaluateGates, isHighBudget, tierFor } from '@/lib/scoring';
import {
  chooseAttribution,
  detectSpamSignals,
  isGeoMismatch,
  isSevereGeoMismatch,
  isValidEmail,
  isValidPhone,
  leadKeyFor,
  newKeySalt,
  normalizeBrand,
  normalizeEmail,
  normalizePhone,
  normalizeSource,
  normalizeUtm,
  parseUtm,
  splitBrands,
} from '@/lib/normalize';

const BUDGET_SET = new Set<string>(BUDGET_BUCKETS);

function str(value: string | undefined): string {
  return (value ?? '').trim();
}

function budgetOf(raw: string): BudgetBucket {
  const v = str(raw);
  return BUDGET_SET.has(v) ? (v as BudgetBucket) : 'Below $5,000';
}

/** Prefer the precise submission_date; fall back to the split Month/Day columns. */
function submittedAtOf(row: RawRow): string {
  const raw = str(row.submission_date);
  if (raw) return raw;
  const month = str(row.Month).padStart(2, '0');
  const day = str(row.Day).padStart(2, '0');
  if (month && day) return `${month}/${day}/2026`;
  return '';
}

export interface TransformOptions {
  /** Drop PII fields; used by the public build and for aggregate-only exports. */
  noPii?: boolean;
}

export interface TransformResult {
  leads: Lead[];
  totalRows: number;
  warnings: string[];
}

export async function transformRows(
  rows: RawRow[],
  options: TransformOptions = {},
): Promise<TransformResult> {
  const noPii = options.noPii ?? false;
  const warnings: string[] = [];
  const leads: Lead[] = [];

  // One random salt per parse. It makes the derived lead keys unusable outside
  // this run, and is never rendered, exported, or stored.
  const salt = newKeySalt();

  // Pass 1: derive each contact's dedupe key once and count their submissions, so
  // each lead carries its contact's final submission count for scoring gates.
  // A single streaming pass would leave duplicateCount stuck at 1.
  const keyCounts = new Map<string, number>();
  const keyByIndex = new Array<string>(rows.length);
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const submissionId = str(row.submission_id);
    if (!submissionId) continue;
    const key = await leadKeyFor(
      salt,
      normalizeEmail(str(row.Email)),
      normalizePhone(str(row['calling-code'] ?? ''), str(row.Phone ?? '')),
      submissionId,
    );
    keyByIndex[i] = key;
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }

  const seenKeys = new Set<string>();

  // Pass 2: build the leads now that each contact's total count is known.
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const submissionId = str(row.submission_id);
    if (!submissionId) continue;

    const email = normalizeEmail(str(row.Email));
    const phone = normalizePhone(str(row['calling-code'] ?? ''), str(row.Phone ?? ''));
    const name = str(row.Name);
    const company = str(row.Company);
    const website = str(row['your-type-of-business-or-the-website']);

    const emailValid = isValidEmail(email);
    const phoneValid = isValidPhone(phone);
    const location = str(row.location);
    const registered = str(row['in-which-country-is-your-business-registered']);
    const distribute = str(row['country-to-distribute-products']);
    const budgetBucket = budgetOf(str(row['estimated-monthly-amount-dollar-you-wish-to-buy-from-us'] ?? ''));
    const typeCompany = str(row['type-company']) || 'Others';
    const howKnow = str(row['how-do-you-know-about-us']);
    const contactPref = str(row['preferred-method-of-contact']);

    const submitUtm: UtmSet = normalizeUtm(parseUtm(str(row.URL ?? '')));
    const firstTouchUtm: UtmSet = normalizeUtm(parseUtm(str(row.first_source_url ?? '')));
    const { chosenUtm, attributionBasis } = chooseAttribution(submitUtm, firstTouchUtm);

    const geoMismatch = isGeoMismatch(location, registered, distribute);
    const severeGeoMismatch = isSevereGeoMismatch(location, registered, distribute);
    const spamSignals = detectSpamSignals(name, website, emailValid, phoneValid);
    const leadKey = keyByIndex[rowIndex];

    const isRepeat = seenKeys.has(leadKey);
    seenKeys.add(leadKey);

    const score = computeScore({
      budgetBucket,
      typeCompany,
      howKnow,
      location,
      registeredCountry: registered,
      distributeCountry: distribute,
      emailValid,
      phoneValid,
      hasCompany: Boolean(company || website),
    });

    // Gates run before bucketing; a failing lead can never be bucketed as MQL.
    const { passed, signals } = evaluateGates({
      emailValid,
      phoneValid,
      isDuplicate: isRepeat,
      spamSignals,
      severeGeoMismatch,
      hasName: Boolean(name),
    });

    leads.push({
      submissionId,
      submittedAt: submittedAtOf(row),
      email: noPii ? '' : email,
      phone: noPii ? '' : phone,
      name: noPii ? '' : name,
      company: noPii ? '' : company,
      location,
      registeredCountry: registered,
      distributeCountry: distribute,
      budgetBucket,
      typeCompany,
      howKnow,
      contactPref,
      website: noPii ? '' : website,
      brands: splitBrands(str(row['top-brands-you-are-looking-for'])),
      submitUtm,
      firstTouchUtm,
      chosenUtm,
      attributionBasis,
      firstUserSource: normalizeSource(str(row.first_user_source)),
      firstUserMedium: str(row.first_user_medium),
      firstSourceUrl: str(row.first_source_url),
      geoMismatch,
      severeGeoMismatch,
      emailValid,
      phoneValid,
      isDuplicate: isRepeat,
      duplicateCount: keyCounts.get(leadKey) ?? 1,
      spamSignals: signals,
      score,
      tier: tierFor(score, !passed),
      gateFailed: !passed,
      leadKey,
    });
  }

  if (leads.length !== rows.length) {
    warnings.push(`Skipped ${rows.length - leads.length} row(s) missing submission_id`);
  }

  return { leads, totalRows: rows.length, warnings };
}

export { isHighBudget, normalizeBrand };
export type { LeadTier };
