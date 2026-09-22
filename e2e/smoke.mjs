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
const TOKYO = { latitude: 35.681236, longitude: 139.767125 };
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['camera', 'geolocation'],
  geolocation: TOKYO,
  acceptDownloads: true,
});
// Chromium has no speech recognition, so stub it: the mic button only renders
// when the platform offers one.
await context.addInitScript(() => {
  class FakeRecognition {
    start() {
      this.onstart?.();
    }
    stop() {
      this.onend?.();
    }
    abort() {}
  }
  window.SpeechRecognition = FakeRecognition;
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
  check('上部にトリコトのアイコンと文字が出る', await page.locator('.camera-wordmark svg').isVisible());
  check('シャッターがアプリのマークになっている', await page.locator('.shutter svg').isVisible());
  const frame = await page.locator('.camera-frame').boundingBox();
  check(
    'ビューファインダーが1:1',
    Math.abs(frame.width - frame.height) <= 1,
    `${frame.width}x${frame.height}`,
  );
  const grid = await page.locator('.camera-grid').boundingBox();
  check(
    '9分割グリッドが枠にぴったり重なる',
    grid.x === frame.x && grid.y === frame.y && grid.width === frame.width,
    JSON.stringify(grid),
  );

  console.log('復帰時のカメラ再起動');
  // OSがバックグラウンドでカメラを閉じた状態を作り、復帰イベントを送る。
  // 止まった映像が隠れるのは一瞬なので、変化を監視して捉える。
  const hidFrozenFrame = await page.evaluate(async () => {
    const video = document.querySelector('video');
    let sawHidden = false;
    const observer = new MutationObserver(() => {
      if (video.style.display === 'none') sawHidden = true;
    });
    observer.observe(video, { attributes: true, attributeFilter: ['style'] });

    video.srcObject.getVideoTracks().forEach((track) => track.stop());
    window.dispatchEvent(new Event('pageshow'));

    await new Promise((resolve) => setTimeout(resolve, 400));
    observer.disconnect();
    return sawHidden;
  });
  check('止まった映像をそのまま見せない', hidFrozenFrame);
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    const track = video?.srcObject?.getVideoTracks?.()[0];
    return track?.readyState === 'live' && video.videoWidth > 0 && video.style.display !== 'none';
  }, null, { timeout: 15000 });
  check('復帰するとカメラが取り直される', true);

  console.log('撮影と保存');
  await page.getByRole('button', { name: '撮影' }).click();
  await page.getByLabel('メモ（任意）').waitFor();
  check(
    '撮影後画面のヘッダーにもトリコトが出る',
    await page.locator('.header .camera-wordmark svg').isVisible(),
  );
  check('音声入力ボタンがマイクのマークになっている', await page.locator('.mic-button svg').isVisible());
  await page.getByRole('button', { name: '音声入力を開始' }).click();
  check(
    '押すと聞き取り中の表示になる',
    await page.getByRole('button', { name: '音声入力を停止' }).isVisible(),
  );
  await page.getByRole('button', { name: '破棄' }).click();
  await page.waitForSelector('video', { state: 'visible' });
  check('破棄でカメラに戻る', true);

  await shoot('この店また来たい', ['旅行', 'グルメ']);
  await shoot('ここから見ると綺麗', ['旅行']);

  const shot = await page.evaluate(
    () =>
      new Promise((resolve) => {
        // The store name intentionally keeps the app's former name.
        const request = indexedDB.open('picta');
        request.onsuccess = () => {
          const rows = request.result.transaction('photos').objectStore('photos').getAll();
          rows.onsuccess = () => {
            const row = rows.result[0];
            const img = new Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.src = URL.createObjectURL(new Blob([row.bytes], { type: row.mimeType }));
          };
        };
      }),
  );
  check('保存された写真も1:1', shot.w === shot.h, `${shot.w}x${shot.h}`);

  const stored = await page.evaluate(
    () =>
      new Promise((resolve) => {
        // The store name intentionally keeps the app's former name.
        const request = indexedDB.open('picta');
        request.onsuccess = () => {
          const rows = request.result.transaction(['records', 'photos']);
          const records = rows.objectStore('records').getAll();
          records.onsuccess = () => {
            const record = records.result[0];
            const photo = rows.objectStore('photos').get(record.photoId);
            photo.onsuccess = () =>
              resolve({
                location: record.location,
                head: Array.from(new Uint8Array(photo.result.bytes).slice(0, 10)),
              });
          };
        };
      }),
  );
  check(
    '撮影地点が記録される',
    Math.abs(stored.location?.latitude - TOKYO.latitude) < 0.001 &&
      Math.abs(stored.location?.longitude - TOKYO.longitude) < 0.001,
    JSON.stringify(stored.location),
  );
  const exifHead =
    stored.head[2] === 0xff &&
    stored.head[3] === 0xe1 &&
    String.fromCharCode(...stored.head.slice(6, 10)) === 'Exif';
  check('保存写真にEXIFが書き込まれる', exifHead, stored.head.join(','));

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
    JSON.parse(strFromU8(entries['manifest.json'])).format === 'torikoto-export',
  );
  const csvBytes = entries['records.csv'];
  check('CSVがBOM付きUTF-8', csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf);
  const csv = strFromU8(csvBytes);
  check('日本語が化けない', csv.includes('ここから見ると綺麗') && csv.includes('"旅行|グルメ"'));
  const photoEntries = names.filter((n) => n.startsWith('photos/')).map((n) => entries[n]);
  check(
    'ZIP内の写真にもEXIFが残る',
    photoEntries.every(
      (photo) =>
        photo[2] === 0xff &&
        photo[3] === 0xe1 &&
        String.fromCharCode(...photo.slice(6, 10)) === 'Exif',
    ),
  );
  // Which photo gets which file name depends on the capture seconds, so look
  // for each memo across all of them rather than assuming an order.
  const photoTexts = photoEntries.map((photo) => strFromU8(photo.slice(0, 8192)));
  check(
    'ZIP内の写真にメモがキャプションとして入る',
    photoTexts.every((text) => text.includes('http://ns.adobe.com/xap/1.0/')) &&
      photoTexts.some((text) => text.includes('また来たい（編集済み）')) &&
      photoTexts.some((text) => text.includes('ここから見ると綺麗')),
    names.join(', '),
  );
  const header = strFromU8(entries['records.csv']).split('\r\n')[0].replace(/^\uFEFF/, '');
  check(
    'CSVに緯度経度の列がある',
    header.endsWith('latitude,longitude') && csv.includes(String(TOKYO.latitude.toFixed(6))),
    header,
  );

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
  check(
    '単体削除も2択になっている',
    (await page.getByRole('button', { name: /アプリ内から削除/ }).isEnabled()) &&
      (await page.getByRole('button', { name: /アプリ内と端末の写真を削除/ }).isDisabled()),
  );
  await page.getByRole('button', { name: /アプリ内から削除/ }).click();
  await page.waitForURL(/#\/records$/);
  await page.locator('.record-memo', { hasText: 'また来たい（編集済み）' }).waitFor();
  check('削除後は一覧に戻り、残りの記録が見える', (await page.locator('.record-memo').count()) === 1);

  console.log('設定');
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
  await page.getByText('自動削除からの保護：').waitFor();
  check(
    '保存データの保護状態を表示する',
    /保護されて(います|いません)|アプリ専用領域に保存/.test(
      await page.locator('strong').first().textContent(),
    ),
  );
  await page.getByRole('checkbox', { name: '撮影した写真を端末にも保存する' }).click();
  check(
    '端末保存をOFFにするとバックアップの注意が出る',
    await page.getByText(/OFFの間は端末にコピーが作られません/).isVisible(),
  );
  await page.getByRole('checkbox', { name: '撮影した写真を端末にも保存する' }).click();
  await page.goto(`${BASE}/#/records`, { waitUntil: 'networkidle' });
  await page.locator('.record-memo').first().waitFor();

  console.log('複数選択して削除');
  await page.getByRole('button', { name: '選択' }).click();
  await page.getByRole('checkbox').first().click();
  await page.getByRole('button', { name: '1件を削除' }).click();
  await page.getByRole('dialog').waitFor();
  check(
    '確認画面に3つの選択肢が出る',
    (await page.getByRole('button', { name: /メモだけ削除/ }).isEnabled()) &&
      (await page.getByRole('button', { name: /アプリ内から削除/ }).isEnabled()) &&
      // Webでは端末の写真を消せないので選べない状態で理由を出す
      (await page.getByRole('button', { name: /アプリ内と端末の写真を削除/ }).isDisabled()),
  );
  await page.getByRole('button', { name: /メモだけ削除/ }).click();
  await page.getByText('1件のメモを削除しました').waitFor();
  const afterMemoDelete = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open('picta');
        request.onsuccess = () => {
          const rows = request.result.transaction('records').objectStore('records').getAll();
          rows.onsuccess = () =>
            resolve(rows.result.map((r) => ({ memo: r.memo, tags: r.tags.length })));
        };
      }),
  );
  check(
    'メモだけ削除では記録とタグが残る',
    afterMemoDelete.length === 1 && afterMemoDelete[0].memo === '' && afterMemoDelete[0].tags > 0,
    JSON.stringify(afterMemoDelete),
  );

  await page.getByRole('button', { name: '選択' }).click();
  await page.getByRole('checkbox').first().click();
  await page.getByRole('button', { name: '1件を削除' }).click();
  await page.getByRole('button', { name: /アプリ内から削除/ }).click();
  await page.getByText('1件の記録を削除しました').waitFor();
  const afterRecordDelete = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open('picta');
        request.onsuccess = () => {
          const tx = request.result.transaction(['records', 'photos']);
          const records = tx.objectStore('records').getAll();
          const photos = tx.objectStore('photos').getAll();
          records.onsuccess = () => {
            photos.onsuccess = () =>
              resolve({ records: records.result.length, photos: photos.result.length });
          };
        };
      }),
  );
  check(
    'アプリ内から削除すると写真も消える',
    afterRecordDelete.records === 0 && afterRecordDelete.photos === 0,
    JSON.stringify(afterRecordDelete),
  );

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
