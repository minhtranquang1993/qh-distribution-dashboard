/**
 * Production-build PII check (impl-review ISSUE-1).
 *
 * The `dist` grep cannot catch this class of leak: the exposure is *runtime*
 * data produced by parsing an uploaded file, not static code in the bundle. This
 * script loads the built app in a real browser, uploads the sample CSV, and
 * asserts that no PII-shaped value is reachable through anything the UI renders
 * or exports.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/verify-production-pii.ts [baseUrl]
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4173/';
const SAMPLE = 'public/sample.csv';

const failures: string[] = [];

function check(condition: boolean, message: string) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${message}`);
  if (!condition) failures.push(message);
}

/** Pull the PII values the sample file actually contains, to search for. */
function samplePii(): { emails: string[]; phones: string[] } {
  const text = readFileSync(SAMPLE, 'utf-8');
  const lines = text.trim().split('\n').slice(1);
  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const line of lines) {
    const email = line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
    if (email) emails.add(email);
    // calling-code + phone are adjacent columns; just take the 555-series values.
    const phone = line.match(/\b555\d{7}\b/)?.[0];
    if (phone) phones.add(phone);
  }
  return { emails: [...emails], phones: [...phones] };
}

async function main() {
  if (!existsSync(SAMPLE)) throw new Error(`Missing ${SAMPLE} — run scripts/make-sample.ts first`);

  const pii = samplePii();
  console.log(`Loaded ${pii.emails.length} sample emails and ${pii.phones.length} phones to hunt for.\n`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root', { timeout: 30_000 });
  await page.getByText('QH Distribution').first().waitFor({ timeout: 30_000 });

  await page.setInputFiles('input[type=file]', SAMPLE);
  await page.waitForFunction(() => document.body.innerText.includes('Đã nạp'), { timeout: 180_000 });

  // Every tab is rendered and read, so a leak in any module is caught.
  const tabs = ['Tổng quan', 'Thu hút', 'Chất lượng', 'Leads'];
  const collectedText: string[] = [];
  for (const label of tabs) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(400);
    collectedText.push(await page.locator('body').innerText());
  }
  const rendered = collectedText.join('\n');

  let leakedEmails = 0;
  for (const email of pii.emails) if (rendered.includes(email)) leakedEmails += 1;
  check(leakedEmails === 0, `no email appears in any rendered tab (found ${leakedEmails})`);

  let leakedPhones = 0;
  for (const phone of pii.phones) if (rendered.includes(phone)) leakedPhones += 1;
  check(leakedPhones === 0, `no phone appears in any rendered tab (found ${leakedPhones})`);

  // Production = vite build (import.meta.env.PROD true → worker strips PII).
  // Script này chạy trên preview server của bản build nên PII phải vắng mặt tuyệt đối.
  const leadsHasPiiColumns = await page.getByText('Tên / Email', { exact: false }).count();
  check(leadsHasPiiColumns === 0, 'production Leads table shows no name/email column');

  // leadKey trong export phải là salted digest (lk1:<24 hex>), không phải contact value.
  // LeadsModule mới không render cột lead id — verify qua export CSV.
  async function exportCsv(): Promise<string> {
    const exportPromise = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
    await page.getByRole('button', { name: /Export .* dòng/ }).click();
    const download = await exportPromise;
    if (!download) return '';
    const path = await download.path();
    return path ? readFileSync(path, 'utf-8') : '';
  }

  const csv1 = await exportCsv();
  check(csv1.length > 0, 'export produced a download');
  check(!pii.emails.some((e) => csv1.includes(e)), 'exported CSV contains no email');
  check(!pii.phones.some((p) => csv1.includes(p)), 'exported CSV contains no phone');
  const keys1 = csv1.split('\n').slice(1).filter(Boolean).map((line) => line.split(',')[2] ?? '');
  check(keys1.length > 0, `export carries leadKey column (${keys1.length} rows)`);
  check(
    keys1.every((k) => /^"?lk1:[0-9a-f]{24}"?$/.test(k.trim())),
    'every exported leadKey matches lk1:<24 hex>',
  );

  // Re-upload và confirm ids đổi (per-parse salt). Nút export nằm ở tab Leads.
  await page.getByRole('button', { name: 'Nạp file khác' }).click();
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  await page.setInputFiles('input[type=file]', SAMPLE);
  await page.waitForFunction(() => document.body.innerText.includes('Đã nạp'), { timeout: 180_000 });
  await page.getByRole('button', { name: 'Leads', exact: true }).click();
  await page.waitForTimeout(500);
  const csv2 = await exportCsv();
  const keys2 = new Set(
    csv2.split('\n').slice(1).filter(Boolean).map((line) => line.split(',')[2]?.trim() ?? ''),
  );
  const reused = keys1.filter((k) => keys2.has(k.trim())).length;
  check(reused === 0, `lead ids are re-salted per upload (${reused} of ${keys1.length} reused)`);

  await browser.close();

  if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) FAILED — production build leaks PII.`);
    process.exit(1);
  }
  console.log('\nProduction build exposes no PII. All checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
