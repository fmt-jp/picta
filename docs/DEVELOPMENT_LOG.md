# トリコト / Torikoto 開発ログ

各Phaseの「実装 → テスト → 動作確認 → 問題点 → 次Phaseへの引き継ぎ」を記録する。

> Phase 1 以降の記録は、アプリ名が「Picta」だった当時のものをそのまま残している。
> 改名の経緯は末尾の「アプリ名を変更」を参照。

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

---

## Phase 10-11: CSV / ZIPエクスポート

### 実装

- CSV（仕様§18.1）
  - 列：`id,capturedAt,memo,tags,photoFileName`
  - タグは `|` 区切り、メモ・タグ・ファイル名はダブルクォートで囲みエスケープ
  - **BOM付きUTF-8**（Excelでの文字化け対策）、改行はCRLF
  - 撮影日時はローカル時刻の `2026-09-21T12:31:00`
- ZIP（仕様§19・§24）
  - `manifest.json`（`format: picta-export` / `version: 1` / タイムゾーン等）
  - `records.csv`
  - `photos/<photoFileName>`
  - 同一秒に撮影された写真は `_2`, `_3` を付けて衝突回避（CSVと必ず一致）
  - fflateのストリーミングZipを使い、写真は1枚ずつ処理して
    メモリピークを抑える。JPEGは再圧縮せず格納（ZipPassThrough）
  - 進捗（何枚目か）を画面に表示
- 受け渡し `src/export/deliver.ts`
  - Web：ダウンロード
  - iOS/Android：キャッシュに書き出して共有シートへ

### テスト

- `export.test.ts` 14件：CSV書式・BOM・カンマ/引用符/改行・タグ無し・
  ファイル名衝突・日時書式・manifest・ZIP構成・CSVと写真の対応・
  日本語が化けないこと・進捗通知・0件エクスポート

### 動作確認（Chromium E2E）

- 2件撮影 → ZIP出力：
  `manifest.json, photos/20260921_092918.jpg, photos/20260921_092918_2.jpg, records.csv`
- CSV出力：`Picta_Export_20260921.csv`
- 同一秒撮影の `_2` 付与を実環境でも確認

### 問題点

- ネイティブでのZIP受け渡しは base64 を経由するため、
  非常に大きなバックアップでは時間とメモリを要する
  （必要になれば `capacitor-blob-writer` 等での改善余地あり）
- インポート（復元）はv1では未実装。manifest.jsonにより将来対応可能な構造

### 次Phaseへの引き継ぎ

- iOS/Androidの権限記述とREADME整備

---

## Phase 12: プラットフォーム確認・テスト・README

### 実装

- `scripts/setup-native.mjs`：`npx cap add` 後のネイティブ権限設定を自動追記
  - iOS: カメラ／マイク／音声認識／写真追加の各 UsageDescription
  - Android: CAMERA / RECORD_AUDIO / INTERNET / WRITE_EXTERNAL_STORAGE(≤28)
  - 何度実行しても安全（不足分のみ追記）。fixtureで冪等性を確認済み
- `e2e/smoke.mjs`：実ブラウザでの通し確認をリポジトリに同梱
  - 静的サーバーを内蔵し、`npm run build && npm run test:e2e` で実行
- README：セットアップ、ビルド、各プラットフォームの制約、
  データ保存方式、エクスポート形式、テスト手順を記載

### テスト結果

- 型チェック：エラーなし
- 単体・画面テスト：9ファイル / 77件 すべて成功
- E2E（Chromium・擬似カメラ）：18項目すべて成功
  - 起動直後のカメラ表示／撮影・保存／新しい順・日付グループ／サムネイル表示
  - 詳細・編集／メモ検索・タグ検索・0件／タグ件数・絞り込み
  - ZIP構成・manifest・BOM付きUTF-8・日本語・写真とCSVの対応／CSV単体
  - 削除後の一覧／JSエラーなし
- PWAオフライン確認：Service Worker制御下で、オフラインでも起動して
  保存済みの記録を閲覧できることを確認

### 問題点・未確認事項

- **iOS / Android の実機ビルドはこの環境では未実施**
  （Xcode / Android Studio / CocoaPods が無いため）。
  ネイティブ側のコードと権限設定は用意済みで、
  `npx cap add` → `npm run setup:native` → `npx cap sync` で組み込める状態
- Web Speech API は Firefox では利用できない（マイクボタンを非表示にして対応）
- 記録が数千件規模になった場合の一覧表示は仮想スクロールが必要になる可能性
- ZIPインポート（復元）はv1未実装。manifest.json で将来対応可能

### v1.0 完成条件の達成状況

1. 起動で即カメラ ✓ / 2. 撮影 ✓ / 3. メモ ✓ / 4. 音声メモ ✓（対応環境）
5. 登録済みタグ選択 ✓ / 6. 新規タグ ✓ / 7. 写真+メモ+タグ+日時の保存 ✓
8. 端末フォトライブラリ保存 ✓（プラットフォーム毎の最善手段）
9. 新しい順表示 ✓ / 10. 編集 ✓ / 11. 削除 ✓ / 12. メモ・タグ検索 ✓
13. タグから検索 ✓ / 14. CSV ✓ / 15. 写真付きZIP ✓ / 16. 日本語 ✓
17. PWAは実動作確認済み。iOS/Androidは実装済みだが実機確認は未実施
18. README ✓

---

## v1.0後の改善: 撮影を1:1に統一

### 背景

ビューファインダーが画面いっぱい（実質16:9）なのに対し、
保存される写真はカメラが返すストリームの比率のままで、見えている範囲と
保存される範囲が一致していなかった。

### 実装

- `centeredSquareCrop()` を追加し、`encodeFrame()` が既定で中央の正方形を切り出すようにした
  - ビューファインダーの `object-fit: cover` と同じ切り出しなので、
    **枠に見えている範囲＝保存される範囲** になる
  - ファイル選択のフォールバックで取り込んだ画像も同じ扱い
- `getUserMedia` の要求解像度を 1920x1920 から 1920x1440（4:3）に変更
  - 正方形は短辺基準で切り出すため、16:9より4:3のほうが画素を多く残せる
- 撮影画面のレイアウトを変更
  - 上部にPictaのアイコン（`PictaMark`）と文字を表示するヘッダー
  - その直下に1:1のビューファインダー
  - 余白は下側に寄せ、シャッターは画面下部に固定（端末の正方形モードと同じ配置）

### テスト

- `centeredSquareCrop` の単体テスト4件（横長・縦長・正方形・上限）
- カメラ画面：ヘッダーのアイコンと文字、1:1枠の存在
- E2E：ビューファインダーが1:1であること、**保存された写真も1:1**であること
- 単体・画面テスト 83件成功 / E2E 21項目成功

### 動作確認

- 擬似カメラのストリーム 1920x1440 → 枠 390x390 → 保存画像 1440x1440
- 390x844 と 360x640 の両方でヘッダー・枠・シャッターが収まることを確認

---

## v1.0後の改善: 撮影日時と撮影地点（EXIF）

### 背景

「EXIFの日付と場所が欲しい」という要望。ただし `getUserMedia` + canvas で
生成した画像には **EXIFが一切付かない**（canvas出力にメタデータは残らない）。
そのため「EXIFを読む」のではなく、日時と位置を自前で取得して記録し、
書き出すJPEGにEXIFとして**書き込む**方針で実装した。

### 実装

- `src/capture/exif.ts`：依存ライブラリなしのEXIF読み書き
  - 読み：APP1/TIFF/IFDを辿り `DateTimeOriginal`・`OffsetTimeOriginal`・
    `DateTime`・GPS緯度経度（度分秒＋Ref）を取得。壊れた入力は `{}` を返す
  - 書き：IFD0 / Exif IFD / GPS IFD を組み立ててAPP1として SOI 直後に挿入。
    既存のAPP1は置き換える（二重に付けない）
- `src/capture/geolocation.ts`：Geolocation APIのラッパー
  - 拒否・タイムアウト・非対応はすべて `null`（例外にしない）
  - `maximumAge: 60s` で直近の測位を再利用
- 取得タイミング：**シャッターと同時**に測位を開始し、保存時に最大2秒だけ待つ
  （メモを書いている間に測位が終わるため、実際にはほぼ待たない）
- ファイル選択で取り込んだ画像は、その画像のEXIF（日時・GPS）を優先
- 記録に `location?: GeoPoint` を追加（IndexedDBはスキーマ変更不要）
- UI
  - 撮影後画面：日時バッジと位置情報バッジ（その1枚だけ位置を付けない選択が可能）
  - 記録詳細：座標と「地図で開く」（外部の地図サービス。タップ時のみ遷移）
  - 記録編集：位置情報だけを削除できる
  - 設定：位置情報の記録ON/OFF
- エクスポート：CSVに `latitude,longitude` を追加し、**形式version 2** に更新
  - 先頭5列の並びはversion 1と同一なので、旧列だけを読む処理も動く
  - manifest.jsonの `csv.columns` に反映
- ネイティブ権限：iOS `NSLocationWhenInUseUsageDescription`、
  Android `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` を追加

### テスト

- `exif.test.ts` 14件：日時書式、往復（日時・位置・南緯西経）、
  JPEG構造を壊さないこと、APP1の二重付与防止、非JPEG・壊れた入力
- `geolocation.test.ts` 7件：非対応・取得成功・拒否・期限切れ・座標表示
- `review.test.tsx`：位置を記録して**写真のEXIFにも入る**こと、
  オフにすると記録にもEXIFにも入らないこと、取得失敗でも保存できること
- `db.test.ts`：位置の保存、メモ編集で消えないこと、位置だけの削除
- E2E：Playwrightで位置情報を与え、記録に座標が入ること、
  保存写真とZIP内の写真にAPP1/Exifがあること、CSVに緯度経度列があること
- 単体・画面テスト 111件成功 / E2E 25項目成功

### 独立検証

自作パーサだけでは循環参照になるため、**Pillow（Python）** で実アプリが
保存したJPEGを読み、以下を確認した。

```
画像: (1440, 1440) JPEG
DateTime: 2026:09:21 14:42:53
DateTimeOriginal: 2026:09:21 14:42:53 | Offset: +00:00
GPS: 35.68123611111111 139.76712500000002
```

### 仕様との関係

仕様§23では「地図表示」「GPS情報を利用した検索」をv1対象外としている。
今回追加したのは**位置の記録・表示・書き出し**のみで、
アプリ内地図と位置での検索は引き続き未実装。

### 問題点

- Web/PWAでは測位精度が端末・環境に依存する（屋内では数十m〜数百m）
- EXIFに書くのは日時と座標のみ。方位・標高・カメラ機種などは扱わない

---

## v1.0後の改善: 撮影後画面のヘッダーにもPictaを表示

### 実装

- `ScreenHeader` に `brand` を追加し、タイトル文字の代わりに
  Pictaのアイコン（`PictaMark`）と文字を中央に表示できるようにした
  - 画面名（「記録する」）は読み上げ用の見出しとして残す（`sr-only`）
  - 左側に何も無い場合は同じ幅のスペーサーを置いてロックアップを中央に保つ
- 撮影後画面（`/review`）のヘッダーに適用。カメラ画面と同じ見え方に揃えた

### テスト

- `review.test.tsx`：ヘッダーにアイコンと文字があり、見出しは残ること
- E2E：撮影後画面のヘッダーにPictaが出ること、破棄でカメラに戻ること
- 単体・画面テスト 112件成功 / E2E 27項目成功

---

## v1.0後の改善: 撮影画面に9分割グリッド

### 実装

- ビューファインダーに三分割法のガイド（縦2本・横2本）を重ねた
  - 1つの要素の背景レイヤー4枚として描画し、`pointer-events: none` で
    シャッターやメニューの操作を一切邪魔しない
  - 線色は `--grid-line`（白35%）。1pxで、被写体を隠さない濃さにした
  - 映像が出ているとき（`status === 'ready'`）だけ表示し、
    権限エラーなどのメッセージには重ねない
- ガイドはオーバーレイなので、**保存される写真には写り込まない**

### テスト

- `camera.test.tsx`：映像が無いときはグリッドを描画しないこと
- E2E：グリッドが枠にぴったり重なること、
  グリッド越しでもシャッターが押せること
- 単体・画面テスト 113件成功 / E2E 28項目成功

---

## v1.0後の変更: アプリ名を「トリコト / Torikoto」に変更

### 方針

| 用途 | 表記 |
| --- | --- |
| 画面表示・PWA名・ネイティブアプリ名 | トリコト |
| ファイル名・識別子（ASCIIが必要な場所） | Torikoto / torikoto |

### 変更したもの

- 画面のロックアップ（カメラ画面・撮影後画面）、メニュー見出し、設定のバージョン表示
- `index.html` のタイトルとiOSのホーム画面名、PWA manifest の `name` / `short_name`
- Capacitor の `appName`（トリコト）と `appId`（`com.picta.app` → `com.torikoto.app`）
- `package.json` の `name`（`torikoto`）と説明
- エクスポートのファイル名（`Torikoto_Export_YYYYMMDD`）
- ZIPの `manifest.json` の `format`（`picta-export` → `torikoto-export`）と `app`
  - 旧名のアーカイブも読めるよう `LEGACY_EXPORT_FORMAT` を定義。
    中身は同一なので、将来のインポートは両方を受け付ける
- コード内の識別子：`PictaMark` → `AppMark`、`PictaSchema`/`PictaDB` → `AppSchema`/`AppDB`
  （中立な名前にして、次に改名しても表示文字列だけで済むようにした）

### 意図的に変更していないもの

- **IndexedDBの名前 `picta`**
- **設定の保存キー `picta.settings.v1`**

どちらも利用者に見えない内部識別子で、変更すると既に端末に保存されている
記録と設定が参照されなくなる。改名のために利用者のデータを失わせる理由はないため、
コメントで理由を明記したうえで据え置いた。

### テスト

- 単体・画面テスト 113件成功 / E2E 28項目成功
- 表示名・エクスポートのファイル名・manifestの `format` を新名で検証

---

## v1.0後の改善: メモを写真のキャプションに書き込む

### 調査

「キャプション」に当たるフィールドは1つではなく、日本語が確実に残るものは限られる。

| フィールド | 文字コード | 判断 |
| --- | --- | --- |
| EXIF `UserComment` | 8バイトの文字コード前置（`UNICODE\0` = UTF-16） | 採用。EXIF標準で日本語を扱える |
| XMP `dc:description` | UTF-8 | 採用。写真アプリが「説明」として表示するのはここ |
| EXIF `ImageDescription` | 宣言なし（ASCII前提で読まれる） | ASCIIのメモのときだけ採用 |
| IPTC `Caption-Abstract` | — | 見送り（APP13/Photoshop IRBが必要で、XMPと役割が重なる） |

`ImageDescription` にUTF-8を書いた場合の挙動をPillowで実測したところ、
latin-1として解釈され文字化けした。化けた文字を残すより空のほうがましなため、
ASCIIのメモに限定した。

### 実装

- `withExif` がEXIFとXMPの2つのAPP1セグメントを書くようにした
  - 既存のEXIF/XMPセグメントは走査して除去してから書き直す（積み重ならない）
  - `UserComment` は `UNICODE\0` + UTF-16LE（TIFFのバイト順に合わせる）
  - XMPは `dc:description` のみの最小パケット。XMLエスケープあり
- 読み側も対応：`UserComment`（前置の文字コードを見て復号）と
  `ImageDescription` を読み、ファイル選択で取り込んだ画像のキャプションを
  メモの初期値にする
- ASCII型タグの読み取りをUTF-8デコードに変更（ASCIIはその部分集合なので安全）
- メモを2000文字で切り詰める（APP1は64KBまで。サロゲートペアは割らない）
- **メモ・位置を編集したら保存済みの写真も刻印し直す**（`restampPhoto`）
  - タグだけの編集では書き直さない

### テスト

- `exif.test.ts` 25件：日本語・絵文字の往復、XMPの内容とエスケープ、
  ASCII/日本語での `ImageDescription` の出し分け、切り詰め、
  書き直しでセグメントが二重にならないこと、メモを空にすると消えること
- `db.test.ts`：メモ編集で写真のキャプションが追従／空にすると消える／
  位置削除でGPSも消える／タグだけの編集では写真を書き換えない
- `review.test.tsx`：保存した写真にメモがキャプションとして入る
- E2E：**ZIP内の写真に編集後のメモがキャプションとして入っている**こと
- 単体・画面テスト 129件成功 / E2E 30項目成功

### 独立検証（Pillow + defusedxml）

```
=== 日本語のメモ
 ImageDescription : None                      ← 文字化け回避のため書かない
 UserComment      : この店また来たい。紅葉が綺麗🍁
 XMP description  : この店また来たい。紅葉が綺麗🍁
=== ASCIIのメモ
 ImageDescription : 'nice cafe, come back'
 UserComment      : nice cafe, come back
 XMP description  : nice cafe, come back
```

### 見送ったもの

- タグを `dc:subject` / `XPKeywords` に書くこと（今回の要望はキャプションのみ）
- Windows専用の `XPComment` / `XPTitle`
