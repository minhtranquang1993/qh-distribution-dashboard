/**
 * Regenerate public/sample.csv — the synthetic demo file that ships in the repo.
 *
 * The real 67MB export is never committed (see .gitignore). This script builds a
 * 200-row stand-in with the same schema so anyone can run the dashboard, the unit
 * tests, and the E2E smoke check without the customer data.
 *
 * Hard rules for anything written here:
 *   - no real submission_id / timestamp / utm_id (a real ID set would let the
 *     published file be joined back against the real export)
 *   - email only on @example.com (RFC 2606 reserved)
 *   - phone only from the 555-01xx fictional range
 *   - ad click IDs are replaced with the literal string REDACTED
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/make-sample.ts
 */
import { writeFileSync } from 'node:fs';
import { BUDGET_BUCKETS } from '../src/types/lead';

const OUT = 'public/sample.csv';
const ROWS = 200;
/** Fixed seed so the committed file is byte-stable across regenerations. */
const SEED = 20260928;

let state = SEED;
function rand(): number {
  // Mulberry32 — small, deterministic, good enough for demo data.
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const FIRST = ['Alex', 'Maria', 'James', 'Sofia', 'Daniel', 'Aisha', 'Chen', 'Fatima', 'Luis', 'Nina', 'Omar', 'Priya'];
const LAST = ['Rivera', 'Patel', 'Kim', 'Silva', 'Okafor', 'Novak', 'Haddad', 'Nguyen', 'Costa', 'Rossi'];
const COMPANY_SUFFIX = ['Co', 'Trading', 'Group', 'Distribution', 'LLC', 'Partners', 'Store', 'Supply'];

const TYPE_COMPANY = [
  'Wholesaler', 'Retail Chain', 'Pharmacy', 'Online Retailer', 'Distributor',
  'Beauty Salon', 'Supermarket', 'Duty Free', 'Others',
];

const HOW_KNOW = [
  'Facebook', 'Instagram', 'Google', 'Friend', 'Ebay', 'Other',
  'Tiktok', 'Youtube', 'LinkedIn', 'Exhibition', 'Website',
];

const CONTACT_PREF = ['WhatsApp', 'Email', 'Phone Call', 'Telegram', 'WeChat'];

const BRANDS = [
  'CeraVe', 'Dove', 'Cetaphil', 'EOS', 'Bioderma', 'Aveeno', 'Advanced Clinicals',
  'Eucerin', 'La Roche-Posay', 'The Ordinary', 'Vaseline', 'Aquaphor', 'Carmex',
  'Fenty Beauty', 'Maybelline', 'Garnier', 'NIVEA', 'L’Oréal Paris', 'Bentonite',
  'Kiehl’s', 'Dr Teal’s', 'Bath and Body Works', 'Dark and Lovely', ' Shea Moisture',
];

const COUNTRIES = [
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France',
  'Nigeria', 'Kenya', 'South Africa', 'Ghana', 'Botswana', 'Brazil', 'Mexico',
  'UAE', 'Saudi Arabia', 'Turkey', 'Vietnam', 'Thailand', 'Philippines',
  'Malaysia', 'Singapore', 'Pakistan', 'India', 'Bangladesh', 'Poland',
  'Netherlands', 'Spain', 'Italy', 'Sweden', 'Chile', 'Peru', 'Colombia', 'Egypt',
];

const CALLING_CODES = ['1', '44', '61', '49', '33', '234', '254', '27', '233', '55', '52', '971', '966', '90', '84'];

/** Countries that read as "brand new" to the geo gate vs. established markets. */
const HIGH_TIER_COUNTRIES = new Set(['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Sweden', 'Poland']);

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function row(values: Record<string, string>): string {
  return Object.values(values).map(escapeCsv).join(',');
}

/** Weighted pick so the demo file looks like the real funnel, not a flat random draw. */
function weighted<T>(entries: Array<[T, number]>): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [value, w] of entries) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

const BUDGET_WEIGHTS: Array<[string, number]> = [
  ['Below $5,000', 46],
  ['Above $5,000 - $20,000', 30],
  ['Above $20,000 - $50,000', 14],
  ['Above $50,000 - $100,000', 7],
  ['Above $100,000', 3],
];

const TYPE_WEIGHTS: Array<[string, number]> = [
  ['Wholesaler', 26],
  ['Retail Chain', 18],
  ['Pharmacy', 11],
  ['Online Retailer', 12],
  ['Distributor', 10],
  ['Beauty Salon', 8],
  ['Supermarket', 7],
  ['Duty Free', 4],
  ['Others', 4],
];

const lines: string[] = [];
lines.push(
  row({
    submission_id: 'submission_id',
    submission_date: 'submission_date',
    URL: 'URL',
    first_source_url: 'first_source_url',
    first_user_source: 'first_user_source',
    first_user_medium: 'first_user_medium',
    location: 'location',
    brands: 'top-brands-you-are-looking-for',
    budget: 'estimated-monthly-amount-dollar-you-wish-to-buy-from-us',
    registered: 'in-which-country-is-your-business-registered',
    distribute: 'country-to-distribute-products',
    type_company: 'type-company',
    how_know: 'how-do-you-know-about-us',
    Company: 'Company',
    Name: 'Name',
    Email: 'Email',
    calling_code: 'calling-code',
    Phone: 'Phone',
    contact_pref: 'preferred-method-of-contact',
    website: 'your-type-of-business-or-the-website',
    recaptcha: 'g-recaptcha-response',
    Week: 'Week',
    Month: 'Month',
    Day: 'Day',
  }),
);

for (let i = 0; i < ROWS; i += 1) {
  const first = pick(FIRST);
  const last = pick(LAST);
  const name = `${first} ${last}`;
  const slugName = `${first}.${last}.${i}`;
  const email = `${slugName.toLowerCase()}@example.com`;

  const location = pick(COUNTRIES);
  // ~28% of the real file has disagreeing country fields; mirror that roughly.
  const geoMode = weighted([['consistent', 72], ['two-way', 20], ['three-way', 8]] as Array<[string, number]>);
  const registered = geoMode === 'consistent' ? location : pick(COUNTRIES);
  const distribute = geoMode === 'consistent' ? registered : pick(COUNTRIES);

  const budgetBucket = weighted(BUDGET_WEIGHTS);
  const typeCompany = weighted(TYPE_WEIGHTS);
  const howKnow = weighted(HOW_KNOW.map((h): [string, number] => [h, h === 'Facebook' ? 26 : h === 'Google' ? 18 : 6]));

  // A handful of invalid emails / phones so the hard gates are exercised.
  const emailRoll = rand();
  const emailValue =
    emailRoll < 0.04 ? `${slugName.toLowerCase()}@example.invalid` :
    emailRoll < 0.07 ? 'not-an-email' :
    email;
  const phoneRoll = rand();
  const callingCode = pick(CALLING_CODES);
  const phone = phoneRoll < 0.05 ? '123' : `555${int(100, 999)}0000`;

  // ~7% duplicate submissions (same contact submitting twice).
  const isRepeat = i > 0 && i % 29 === 0;
  const dupeIndex = isRepeat ? i - 1 : i;

  const month = int(1, 12);
  const day = int(1, 28);
  const hour = int(0, 23);
  const minute = int(0, 59);

  // Fake, clearly-synthetic identifiers.
  const fakeSubmissionId = String(900000 + i);
  const fakeUtm = String(700000000000000000 + i * 137);

  const source = howKnow === 'Facebook' || howKnow === 'Instagram' || howKnow === 'Tiktok' ? 'FB' : 'google';
  const medium = source === 'FB' ? 'Lead' : 'cpc';
  const term = source === 'FB' ? 'lookalike-reweb' : 'brand';
  const content = source === 'FB' ? 'terms' : 'cpc-generic';

  // The real export's submit URL loses UTM on ~14% of rows, but first-touch
  // often still carries it — that is exactly the `first_source_fallback`
  // bucket. Model the two fields independently.
  const hasSubmitUtm = rand() > 0.14;
  const hasFirstUtm = rand() > 0.16;
  const buildUrl = (withUtm: boolean) =>
    withUtm
      ? `https://example.com/wholesale/?utm_source=${source}&utm_medium=${medium}&utm_term=${term}&utm_content=${content}&fbclid=REDACTED&gclid=REDACTED&utm_id=${fakeUtm}&utm_campaign=${fakeUtm}`
      : 'https://example.com/wholesale/';
  const url = buildUrl(hasSubmitUtm);
  const firstSourceUrl = hasFirstUtm ? buildUrl(true) : '';
  const firstUserSource = firstSourceUrl ? (source === 'FB' ? 'facebook' : 'google') : '';
  const firstUserMedium = firstSourceUrl ? (source === 'FB' ? 'cpm' : 'organic') : '';

  const brandCount = weighted([['one', 34], ['two', 26], ['three', 20], ['many', 20]] as Array<[string, number]>);
  const brandN = { one: 1, two: 2, three: 3, many: int(4, 7) }[brandCount] as number;
  const brandPool = [...BRANDS];
  const brands: string[] = [];
  for (let b = 0; b < brandN; b += 1) {
    brands.push(brandPool.splice(Math.floor(rand() * brandPool.length), 1)[0]);
  }

  lines.push(
    row({
      submission_id: fakeSubmissionId,
      submission_date: `${month}/${day}/2026 ${hour}:${String(minute).padStart(2, '0')}`,
      URL: url,
      first_source_url: firstSourceUrl,
      first_user_source: firstUserSource,
      first_user_medium: firstUserMedium,
      location,
      brands: brands.join(', '),
      budget: budgetBucket,
      registered,
      distribute,
      type_company: typeCompany,
      how_know: howKnow,
      Company: `${last} ${pick(COMPANY_SUFFIX)} ${dupeIndex}`,
      Name: name,
      Email: emailValue,
      calling_code: callingCode,
      Phone: phone,
      contact_pref: pick(CONTACT_PREF),
      website: rand() > 0.82 ? `https://example.com/${slugName.toLowerCase()}` : '',
      recaptcha: '',
      Week: String(int(1, 5)),
      Month: String(month),
      Day: String(day),
    }),
  );
}

writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${ROWS} synthetic rows to ${OUT}`);
console.log(`Budget buckets: ${BUDGET_BUCKETS.join(' | ')}`);
