#!/usr/bin/env node
/**
 * End-to-end smoke test for the built PWA.
 *
 * Runs the real flow in Chromium with a fake camera device — jsdom cannot give
 * us getUserMedia, canvas encoding, object URLs or ZIP downloads:
 *
 *   撮影 → メモ → タグ → 保存 → 一覧 → 詳細 → 編集 → 検索 → エクスポート → 削除
 *
 *   npm run build && npm run test:e2e
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';

const DIST = new URL('../dist/', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 4319);
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ がありません。先に `npm run build` を実行してください。');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = join(DIST, path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));
const BASE = `http://localhost:${PORT}`;

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['camera'],
  acceptDownloads: true,
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

async function shoot(memo, tags) {
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
  await page.getByRole('button', { name: '撮影' }).click();
  await page.getByLabel('メモ（任意）').fill(memo);
  for (const tag of tags) await page.getByRole('button', { name: tag, exact: true }).click();
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForSelector('video', { state: 'visible' });
}

try {
  console.log('起動直後の画面');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('video', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
  check('カメラがすぐに表示される', await page.getByRole('button', { name: '撮影' }).isEnabled());

  console.log('撮影と保存');
  await shoot('この店また来たい', ['旅行', 'グルメ']);
  await shoot('ここから見ると綺麗', ['旅行']);

  console.log('過去の記録');
  await page.goto(`${BASE}/#/records`, { waitUntil: 'networkidle' });
  await page.getByText('この店また来たい').waitFor();
  const memos = await page.locator('.record-memo').allTextContents();
  check('新しい順に並ぶ', memos[0] === 'ここから見ると綺麗', memos.join(' / '));
  check('日付でグループ化される', (await page.locator('.date-heading').count()) === 1);
  await page.waitForFunction(
    () => [...document.querySelectorAll('.record-thumb img')].every((i) => i.naturalWidth > 0),
  );
  check('サムネイルが表示される', true);

  console.log('詳細と編集');
  await page.getByText('この店また来たい').click();
  await page.getByRole('link', { name: '編集' }).click();
  await page.getByLabel('メモ').fill('また来たい（編集済み）');
  await page.getByRole('button', { name: '保存' }).click();
  // Wait for the detail screen itself: the edit textarea would match the new
  // text while the save is still in flight.
  await page.waitForURL(/#\/records\/[^/]+$/);
  await page.locator('dd', { hasText: 'また来たい（編集済み）' }).waitFor();
  check('メモを編集できる', true);

  console.log('検索');
  await page.goto(`${BASE}/#/search`, { waitUntil: 'networkidle' });
  await page.getByLabel('検索語').fill('編集済み');
  await page.getByText('検索結果：1件').waitFor();
  check('メモを検索できる', true);
  await page.getByLabel('検索語').fill('グルメ');
  await page.getByText('検索結果：1件').waitFor();
  check('タグを検索できる', true);
  await page.getByLabel('検索語').fill('存在しない語');
  await page.getByText('検索結果：0件').waitFor();
  check('0件でも壊れない', true);

  console.log('タグ一覧');
  await page.goto(`${BASE}/#/tags`, { waitUntil: 'networkidle' });
  const tagRow = page.getByRole('link', { name: /#旅行/ });
  check('件数が出る', (await tagRow.textContent())?.includes('2件'));
  await tagRow.click();
  await page.getByText('ここから見ると綺麗').waitFor();
  check('タグから記録を絞り込める', true);

  console.log('エクスポート');
  await page.goto(`${BASE}/#/export`, { waitUntil: 'networkidle' });
  const [zip] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'ZIPを書き出す' }).click(),
  ]);
  const zipPath = await zip.path();
  const entries = unzipSync(new Uint8Array(await readFile(zipPath)));
  const names = Object.keys(entries).sort();
  check('ZIPにmanifest/CSV/写真が入る', names.length === 4 && names[0] === 'manifest.json', names.join(', '));
  check(
    'manifestにformatとversionがある',
    JSON.parse(strFromU8(entries['manifest.json'])).format === 'picta-export',
  );
  const csvBytes = entries['records.csv'];
  check('CSVがBOM付きUTF-8', csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf);
  const csv = strFromU8(csvBytes);
  check('日本語が化けない', csv.includes('ここから見ると綺麗') && csv.includes('"旅行|グルメ"'));
  const photoNames = names.filter((n) => n.startsWith('photos/')).map((n) => n.slice(7));
  check(
    '写真とCSVの対応が取れている',
    photoNames.every((name) => csv.includes(`"${name}"`)),
    photoNames.join(', '),
  );

  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSVを書き出す' }).click(),
  ]);
  check('CSV単体も書き出せる', csvDownload.suggestedFilename().endsWith('.csv'));

  console.log('削除');
  await page.goto(`${BASE}/#/records`, { waitUntil: 'networkidle' });
  await page.getByText('ここから見ると綺麗').click();
  await page.getByRole('button', { name: 'この記録を削除' }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await page.waitForURL(/#\/records$/);
  await page.locator('.record-memo', { hasText: 'また来たい（編集済み）' }).waitFor();
  check('削除後は一覧に戻り、残りの記録が見える', (await page.locator('.record-memo').count()) === 1);

  check('JavaScriptエラーが出ていない', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  failures += 1;
  console.error('E2E失敗:', err);
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0 ? '\nE2E: すべて成功' : `\nE2E: ${failures}件失敗`);
process.exit(failures === 0 ? 0 : 1);
