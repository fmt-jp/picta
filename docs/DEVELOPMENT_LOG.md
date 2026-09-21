# Picta 開発ログ

各Phaseの「実装 → テスト → 動作確認 → 問題点 → 次Phaseへの引き継ぎ」を記録する。

---

## Phase 1: プロジェクト作成と基本UI

### 実装

- Vite 8 + React 19 + TypeScript の構成を作成
- `vite-plugin-pwa` によるPWA設定（manifest / Service Worker / アイコン）
- `HashRouter` による画面ルーティング（全画面のルートを先に定義）
- アプリシェル：メニュードロワー、画面ヘッダー、確認ダイアログ
- カメラ画面の外枠（メニューボタン・シャッターボタン配置）
- Capacitor 設定ファイル（appId: `com.picta.app`, webDir: `dist`）
- ダークテーマ前提のスタイル。セーフエリア（ノッチ）対応

### テスト

- `src/test/shell.test.tsx`：メニュー開閉と全メニュー項目の表示
- `npm run typecheck` / `npm run build` / `npm test` すべて成功

### 動作確認

- 本番ビルド成功（PWA precache 16 entries）
- 起動時のルート `/` がカメラ画面

### 問題点

- カメラ映像・保存は未実装（Phase 2以降）
- 画面はすべてスタブ

### 次Phaseへの引き継ぎ

- カメラは `getUserMedia` を使い、Web/iOS/Android で同一コードを使う方針
- 撮影結果はメモリ上のドラフトとして撮影後画面へ渡す

---

## Phase 2: カメラ撮影

### 実装

- `src/platform/env.ts`：実行環境判定（native / web、セキュアコンテキスト、iOS判定）
- `src/capture/useCamera.ts`：`getUserMedia` によるライブビューファインダー
  - カメラ権限は「カメラ画面を開いたとき」に要求する（起動時一括要求はしない）
  - `NotAllowedError` / `NotFoundError` などを日本語メッセージに変換
  - 前面／背面切替（`enumerateDevices` でカメラが2台以上のときのみ表示）
  - アンマウント時に必ず `MediaStreamTrack.stop()`
- `src/capture/imageUtil.ts`：長辺2048pxへの縮小・JPEG(品質0.9)エンコード
  - 前面カメラはプレビューが鏡像のため、保存画像も同じ向きに反転する
- `src/capture/pendingCapture.ts`：撮影後画面へ渡すドラフト（ObjectURLを確実に解放）
- カメラが使えない環境向けに `<input type="file" capture>` のフォールバック

### テスト

- `imageUtil.test.ts`：縮小ロジック、ファイル名タイムスタンプ
- `camera.test.tsx`：API非対応／権限拒否／カメラ未検出の各表示
- 全11テスト成功

### 動作確認

- Chromium（fake media stream）で実機相当の確認
  - ビューファインダー 1920x1920 再生、シャッター有効
  - 起動直後にカメラ画面が表示されることを確認

### 問題点

- jsdom には `canvas.toBlob` が無いため、エンコード自体の単体テストは
  ブラウザ実行（E2E）側で担保する
- iOS の Safari / PWA では `getUserMedia` が使えない場面があるため、
  ファイル入力フォールバックを常に残す

### 次Phaseへの引き継ぎ

- 撮影結果は `EncodedPhoto`（Blob + 寸法）として `/review` に渡る
