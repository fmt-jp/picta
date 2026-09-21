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

---

## Phase 3: 撮影後画面（メモ・音声入力・タグ）

### 実装

- `/review` 画面：写真プレビュー → メモ → タグ → 保存
- メモは任意。空欄のまま保存できる（保存ボタンは常に有効）
- 音声入力 `src/capture/useSpeech.ts`
  - Web: Web Speech API（`webkitSpeechRecognition` も考慮）、`ja-JP`
  - iOS/Android: `@capacitor-community/speech-recognition` を動的import
  - 認識したテキストのみメモへ追記。音声データは保存しない（仕様§6, §23）
  - マイク権限はマイクボタンを押した時点で要求する
- `src/ui/TagPicker.tsx`：登録済みタグの複数選択＋「＋ 新しいタグ」
  - その場で追加したタグは即座に登録済みタグになる
- 破棄時はメモ／タグ入力済みなら確認ダイアログ

### テスト

- `review.test.tsx`：空欄保存／日本語メモ＋タグ／タグ再選択で解除／
  新規タグ追加／音声入力非対応時の案内／音声認識結果の反映

---

## Phase 4: ローカル保存

### 実装

- IndexedDB（`idb`）にスキーマを定義
  - `records`（メタデータのみ）／`photos`（画像本体）／`tags`
  - 記録一覧・検索で画像バイト列を読み込まない構造にした
- 写真の保存先はプラットフォームで切り替える（仕様§20の検討結果）
  - Web/PWA: `photos` ストアに **ArrayBuffer** として保存
    （古いiOS SafariはIndexedDB内のBlobを失う既知の問題があるため）
  - iOS/Android: アプリ専用領域に実ファイル(.jpg)として保存し、
    DBにはパスのみ保持（`@capacitor/filesystem`）
- `src/db/records.ts`：作成・一覧・取得・更新・削除・検索・タグ別一覧・件数集計
- `src/db/tags.ts`：登録済みタグ、名称変更（記録側も追従／同名は統合）、削除
- 初回起動時に仕様§7.1の9タグを初期登録
- `usePhotoUrl`：ObjectURLを参照カウントで共有し、確実に解放する

### テスト

- `db.test.ts` 23件：初期タグ、重複タグ、空欄保存、長文(5000字)、
  新しい順、編集、削除（写真も削除）、タグ別一覧、件数、
  検索（メモ／タグ／0件／全角半角同一視）、タグ名変更・統合・削除

### 動作確認

- Chromium E2E：撮影 → メモ入力 → タグ2件選択 → 新規タグ追加 → 保存
  - IndexedDBに記録1件・写真40KBが保存されることを確認
  - `photoFileName` が `YYYYMMDD_HHMMSS.jpg` 形式であることを確認

### 問題点

- fake-indexeddb + jsdom ではBlobの構造化複製が不完全だったため、
  ArrayBuffer保存に変更した（結果的にSafari対策にもなった）

### 次Phaseへの引き継ぎ

- 端末フォトライブラリへの保存はまだ未実装（保存はアプリ内のみ）

---

## Phase 5: フォトライブラリへの保存

### 実装

- `src/platform/photoLibrary.ts`：端末側への保存をプラットフォーム別に実装
  - iOS/Android（ネイティブ）：`@capacitor-community/media` の `savePhoto` で
    カメラロールへ直接保存。アルバム未指定にすることで、iOS 14+ では
    「追加のみ」権限で済む（必要最小限の権限）
  - Web/PWA：ブラウザのダウンロードとして保存
    （Android はダウンロード先がギャラリーに取り込まれる。
      iOS Safari はファイルApp に保存される）
  - iOS Safari から写真Appへ入れる唯一の方法は共有シートのため、
    記録詳細の「端末に保存」で `navigator.share({files})` を使う
- 保存失敗は記録の保存を巻き戻さない（記録が主、端末コピーは従）
- `src/settings.ts`：端末保存のON/OFF設定（localStorage、写真は保存しない）

### テスト

- `photoLibrary.test.ts`：Webダウンロード／共有シート／共有不可時の
  フォールバック／共有キャンセル／**記録削除が端末側の写真に触れないこと**

### 問題点（プラットフォーム制約）

- Web/PWAから「写真App（カメラロール）」へ直接書き込むAPIは存在しない。
  そのためWebでは「ダウンロード」＋「共有シート」が上限となる
- iOS Safari の共有はユーザー操作から直接呼ぶ必要があるため、
  撮影時の自動保存ではなく記録詳細の明示的なボタンとして提供する

### 次Phaseへの引き継ぎ

- 記録詳細画面に「端末に保存」ボタンを置く（Phase 7で実装）

---

## Phase 6-7: 過去の記録・詳細・編集・削除

### 実装

- `src/format.ts`：`2026年9月21日` / `12:31` の日本語表記、日付グループキー
- `src/ui/RecordList.tsx`：撮影日でグループ化した新しい順リスト
  - 同一日の中も撮影時刻の新しい順
  - サムネイルは `usePhotoUrl`（ObjectURLを参照カウントで共有）
  - 検索結果・タグ絞り込みでも同じ表示を使う
- `/records`：一覧、`/tags/:name`：タグ絞り込み（メニューからも遷移）
- `/records/:id`：写真・撮影日時・メモ・タグ・編集・削除・端末に保存
  - 削除は確認ダイアログ。「端末のフォトライブラリの写真は削除されません」と明示
  - タグをタップするとそのタグの記録一覧へ
- `/records/:id/edit`：メモ（音声入力可）・メモ削除・タグ追加削除
  - 写真自体は編集しない

### テスト

- `records.test.tsx` 10件：日付グループと並び順、空表示、メモなし表示、
  タグ絞り込み、詳細表示、削除の確認／キャンセル、編集、メモ削除、新規タグ追加

### 問題点

- 一覧は全件をメモリに読み込む。数千件規模では仮想スクロールが必要になるが、
  写真本体は読み込まないためメタデータのみで軽量。v1では見送り

### 次Phaseへの引き継ぎ

- 検索は `searchRecords`（Phase 4で実装済）をUIに接続するだけでよい

---

## Phase 8-9: 検索・タグ管理

### 実装

- `/search`：メモとタグを対象に検索（どちらかに含まれれば結果に入る）
  - 結果は撮影日時の新しい順、件数を表示
  - 日本語変換中の再検索を避けるため150msのデバウンス
  - 全角／半角・大文字小文字はNFKC + 小文字化で同一視
- `/tags`：登録済みタグと件数の一覧。タップでそのタグの記録一覧へ
- `/settings`：
  - タグ管理（追加・名称変更・削除、削除は確認ダイアログ）
    - 名称変更・削除は過去の記録側にも反映（記録自体は残す）
  - 端末への保存ON/OFFとプラットフォーム別の説明
  - 保存容量（写真枚数と概算バイト数）
  - アプリ情報

### テスト

- `searchTags.test.tsx` 8件：メモ検索／タグ検索／0件、タグ一覧と遷移、
  タグ追加・名称変更（記録追従）・削除（記録は残る）、端末保存設定の切替

### 問題点

- タグ名変更で既存タグ名に統合した場合、統合されたことをUIでは明示していない
  （結果は正しく統合される）

### 次Phaseへの引き継ぎ

- エクスポートはCSV → ZIPの順。ZIPにはmanifest.jsonでバージョンを持たせる
