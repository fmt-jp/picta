#!/usr/bin/env node
/**
 * Adds Picta's permission strings to the generated native projects.
 *
 * Capacitor creates ios/ and android/ from a template, so these edits have to
 * be applied once after `npx cap add ios` / `npx cap add android`. Running this
 * script again is safe — it only inserts what is missing.
 *
 *   npx cap add ios && npx cap add android
 *   node scripts/setup-native.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const IOS_PLIST = 'ios/App/App/Info.plist';
const ANDROID_MANIFEST = 'android/app/src/main/AndroidManifest.xml';

/** Why each permission is needed, shown in the iOS system prompt. */
const IOS_KEYS = {
  NSCameraUsageDescription: '写真を撮影するためにカメラを使用します。',
  NSMicrophoneUsageDescription: 'メモを音声で入力するためにマイクを使用します。',
  NSSpeechRecognitionUsageDescription: '音声をテキストに変換してメモに入力します。',
  NSPhotoLibraryAddUsageDescription: '撮影した写真を端末の写真アプリにも保存します。',
  NSLocationWhenInUseUsageDescription: '撮影した場所を記録に残します。',
};

const ANDROID_PERMISSIONS = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  // Saving into the gallery on Android 9 and older.
  '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />',
];

const ANDROID_FEATURES = [
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
];

let changed = 0;

function patchIos() {
  if (!existsSync(IOS_PLIST)) {
    console.log(`skip: ${IOS_PLIST} がありません（npx cap add ios を先に実行してください）`);
    return;
  }
  let plist = readFileSync(IOS_PLIST, 'utf8');
  const additions = Object.entries(IOS_KEYS)
    .filter(([key]) => !plist.includes(`<key>${key}</key>`))
    .map(([key, value]) => `\t<key>${key}</key>\n\t<string>${value}</string>`);

  if (additions.length === 0) {
    console.log(`ok: ${IOS_PLIST} は設定済み`);
    return;
  }
  const marker = plist.lastIndexOf('</dict>');
  plist = plist.slice(0, marker) + additions.join('\n') + '\n' + plist.slice(marker);
  writeFileSync(IOS_PLIST, plist);
  console.log(`updated: ${IOS_PLIST} (+${additions.length} keys)`);
  changed += 1;
}

function patchAndroid() {
  if (!existsSync(ANDROID_MANIFEST)) {
    console.log(
      `skip: ${ANDROID_MANIFEST} がありません（npx cap add android を先に実行してください）`,
    );
    return;
  }
  let manifest = readFileSync(ANDROID_MANIFEST, 'utf8');
  const additions = [...ANDROID_PERMISSIONS, ...ANDROID_FEATURES].filter((line) => {
    const name = /android:name="([^"]+)"/.exec(line)?.[1] ?? '';
    return !manifest.includes(name);
  });

  if (additions.length === 0) {
    console.log(`ok: ${ANDROID_MANIFEST} は設定済み`);
    return;
  }
  const marker = manifest.lastIndexOf('</manifest>');
  manifest =
    manifest.slice(0, marker) +
    additions.map((line) => `    ${line}`).join('\n') +
    '\n' +
    manifest.slice(marker);
  writeFileSync(ANDROID_MANIFEST, manifest);
  console.log(`updated: ${ANDROID_MANIFEST} (+${additions.length} entries)`);
  changed += 1;
}

patchIos();
patchAndroid();
console.log(changed ? '完了: ネイティブ権限を設定しました。' : '変更はありません。');
