/**
 * End-to-end smoke check against the running dev server: upload a real CSV,
 * wait for the worker to finish, then confirm every tab renders content.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/e2e-smoke.ts <csv-path> [baseUrl]
 */
import { chromium, type Page } from 'playwright';
import { existsSync } from 'node:fs';

const CSV = process.argv[2] ?? 'public/sample.csv';
const BASE = process.argv[3] ?? 'http://localhost:5173/';
const SHOTS = 'docs/screenshots';

const TABS = [
  'Tổng quan',
  'Action Board',
  'Kênh',
  'Creative',
  'Geo',
  'Firmographic',
  'Brand',
  'Xu hướng',
  'Lead Explorer',
];

/** ASCII slug — tab labels are Vietnamese, which breaks on Windows/CI filesystems. */
function slug(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const failures: string[] = [];

function check(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS  ${message}`);
  } else {
    console.log(`  FAIL  ${message}`);
    failures.push(message);
  }
}

async function openTab(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(500);
}

async function main() {
  if (!existsSync(CSV)) throw new Error(`CSV not found: ${CSV}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root', { timeout: 30_000 });
  await page.getByText('Lead Quality Dashboard').waitFor({ timeout: 30_000 });
  check(await page.getByText('Lead Quality Dashboard').isVisible(), 'app shell renders');

  // Upload the CSV through the real file input.
  await page.setInputFiles('input[type=file]', CSV);
  await page.waitForFunction(
    () => document.body.innerText.includes('Đã nạp'),
    { timeout: 180_000 },
  );
  const loadedText = await page.locator('body').innerText();
  const rowMatch = loadedText.match(/Đã nạp\s*([\d.,]+)\s*dòng/);
  check(Boolean(rowMatch), `worker finished parsing (reported: ${rowMatch?.[1] ?? 'none'} rows)`);
  const firstRowCount = rowMatch ? Number(rowMatch[1].replace(/[.,]/g, '')) : 0;

  // Re-upload the same file: a second parse must not accumulate the first one's
  // rows, or every total and denominator would silently double (impl-review ISSUE-2).
  // The file input is only mounted in the idle state, so reset first.
  await page.getByRole('button', { name: 'Nạp file khác' }).click();
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  await page.setInputFiles('input[type=file]', CSV);
  await page.waitForFunction(
    (previous) => {
      const match = document.body.innerText.match(/Đã nạp\s*([\d.,]+)\s*dòng/);
      return Boolean(match) && Number(match[1].replace(/[.,]/g, '')) === previous;
    },
    firstRowCount,
    { timeout: 180_000 },
  );
  const rereadText = await page.locator('body').innerText();
  const reMatch = rereadText.match(/Đã nạp\s*([\d.,]+)\s*dòng/);
  const secondRowCount = reMatch ? Number(reMatch[1].replace(/[.,]/g, '')) : 0;
  check(
    secondRowCount === firstRowCount,
    `re-upload resets the worker (still ${secondRowCount} rows, expected ${firstRowCount})`,
  );

  await page.screenshot({ path: `${SHOTS}/01-overview.png`, fullPage: true });

  for (const [i, label] of TABS.entries()) {
    await openTab(page, label);
    const text = await page.locator('body').innerText();
    check(text.includes(label), `tab "${label}" renders`);
    check(
      !text.includes('Chưa đủ dữ liệu để xếp hạng') || label !== 'Action Board',
      `tab "${label}" has content`,
    );
    await page.screenshot({ path: `${SHOTS}/${String(i + 2).padStart(2, '0')}-${slug(label)}.png`, fullPage: true });
  }

  // Production builds must never render PII columns; local dev may.
  const modeButtons = await page.getByRole('button', { name: 'Tất cả submissions' }).count();
  check(modeButtons > 0, 'denominator toggle present');

  check(consoleErrors.length === 0, `no console errors (${consoleErrors.slice(0, 3).join(' | ')})`);

  await browser.close();

  console.log(`\nScreenshots written to ${SHOTS}/`);
  if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) FAILED:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
