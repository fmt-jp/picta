# Picta

写真を撮ったついでに、一言残す。

Pictaは、撮影した直後に短いメモとタグを添えて残すための軽量な記録アプリです。
日記アプリでも写真編集アプリでもありません。大切にしているのは次の3点だけです。

1. アプリを開いたらすぐ撮れる
2. 写真に一言を添えられる
3. 後から簡単に見つけられる

## 主な機能

- 起動直後にカメラ（ホーム画面やダッシュボードを挟まない）
- 撮影後にメモ（キーボード / 音声入力）とタグを付けて保存
- 登録済みタグの複数選択と、その場での新規タグ追加
- 写真をアプリ内と端末側の両方に保存
- 撮影日時の新しい順・日付グループの記録一覧
- 記録の詳細 / 編集 / 削除
- メモとタグの検索、タグからの絞り込み
- CSVエクスポートと、写真付きZIPバックアップ
- PWA（オフライン起動可能）

## 技術構成

| 領域 | 採用 | 理由 |
| --- | --- | --- |
| UI | React 19 + TypeScript | 画面数が少なく状態も素直なため、追加の状態管理ライブラリは不要 |
| ビルド | Vite 8 | 起動・ビルドが速く、PWA / Capacitor どちらにもそのまま載る |
| PWA | vite-plugin-pwa (Workbox) | manifestとService Workerを構成から自動生成できる |
| ネイティブ | Capacitor 8 | **Webの成果物をそのまま** iOS/Androidで動かせる。3ターゲットで共通コードを最大化するという要件に最も合う |
| ルーティング | react-router (HashRouter) | 静的配信・サブパス配信・WebView のいずれでもリロードに強い |
| DB | IndexedDB (`idb`) | 写真を扱うためlocalStorageは不可。容量・構造化・トランザクションの要件を満たす |
| 写真本体 | Web: IndexedDB(ArrayBuffer) / ネイティブ: ファイルシステム | 下記「データの保存場所」を参照 |
| ZIP | fflate | 軽量でストリーミング圧縮に対応。写真を1枚ずつ処理できる |
| テスト | Vitest + Testing Library / Playwright | 単体・画面テストと、実ブラウザでのE2E |

React Nativeではなく**Capacitor**を選んだのは、要件が「まずWeb/PWAで動作確認できる構成を基本とし、
iOS/Androidでは必要なネイティブ機能を適切に実装する」ものであり、
Web実装が第一級の成果物になるためです。カメラ・音声認識・写真保存といったOS依存部分だけを
`src/platform/` の薄いアダプタで切り替えます。

## セットアップ

```bash
npm install
npm run dev          # http://localhost:5173
```

カメラはセキュアコンテキストでのみ動作します。`localhost` はセキュア扱いですが、
スマートフォン実機からLAN経由で確認する場合はHTTPSが必要です。

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run build` | 型チェック + 本番ビルド（`dist/`） |
| `npm run preview` | 本番ビルドのローカル確認 |
| `npm run typecheck` | 型チェックのみ |
| `npm test` | 単体・画面テスト（Vitest） |
| `npm run test:e2e` | 実ブラウザでのE2E（要 `npm run build`） |
| `npm run cap:sync` | ビルドしてネイティブプロジェクトへ反映 |
| `npm run setup:native` | ネイティブの権限設定を追記 |

## ビルドと配信（Web / PWA）

```bash
npm run build
# dist/ を任意の静的ホスティングへ配置（HTTPS必須）
```

`base` は相対パスなので、サブディレクトリ配信でもそのまま動作します。
Service Workerによりオフラインでも起動でき、記録の閲覧・検索・エクスポートが可能です。

## iOS / Android（Capacitor）

```bash
npm run build
npx cap add ios          # 初回のみ（macOS + Xcode が必要）
npx cap add android      # 初回のみ（Android Studio が必要）
npm run setup:native     # Info.plist / AndroidManifest.xml に権限を追記
npm run cap:sync
npx cap open ios         # または npx cap open android
```

`npm run setup:native` が追記する内容:

- iOS: `NSCameraUsageDescription` / `NSMicrophoneUsageDescription` /
  `NSSpeechRecognitionUsageDescription` / `NSPhotoLibraryAddUsageDescription`
- Android: `CAMERA` / `RECORD_AUDIO` / `INTERNET` /
  `WRITE_EXTERNAL_STORAGE`(maxSdkVersion=28) と カメラfeature（任意）

権限は起動時に一括要求せず、**その機能を初めて使うとき**に要求します
（カメラ画面を開いたとき、マイクボタンを押したとき、端末へ保存するとき）。

## プラットフォーム別の制約

同じ機能がすべてのプラットフォームで同じようには実現できません。
Pictaは無理に同一実装にせず、各プラットフォームで可能な最善の方法を選んでいます。

### カメラ

| | 実装 | 備考 |
| --- | --- | --- |
| Web/PWA | `getUserMedia` によるアプリ内ビューファインダー | HTTPSまたはlocalhostが必須 |
| iOS | 同上（WKWebView） | ホーム画面追加のPWAでは環境によりカメラが使えないことがあるため、`<input type="file" capture>` へフォールバックします |
| Android | 同上 | |

撮影画像は長辺2048px・JPEG品質0.9に正規化して保存します（容量対策）。

### 音声入力

| | 実装 | 備考 |
| --- | --- | --- |
| Web/PWA | Web Speech API (`ja-JP`) | **Chrome/Edge/Safariで利用可。Firefoxは非対応** |
| iOS | `@capacitor-community/speech-recognition` | 端末の音声認識を使用 |
| Android | 同上 | Google音声認識が必要 |

いずれも認識結果のテキストのみを扱い、**音声データは保存しません**。
利用できない環境ではマイクボタンを表示せず、キーボード入力のみになります。

### 端末フォトライブラリへの保存

| | 実装 | 保存先 |
| --- | --- | --- |
| iOS (ネイティブ) | Mediaプラグイン | カメラロール（「追加のみ」権限） |
| Android (ネイティブ) | Mediaプラグイン | ギャラリー |
| Web/PWA | ブラウザのダウンロード | Android: ダウンロード（多くの端末でギャラリーに反映） / iOS Safari: ファイルApp |

**Webから写真App（カメラロール）へ直接書き込むAPIは存在しません。**
iOS SafariのPWAで写真Appに入れたい場合は、記録詳細の「端末に保存」から共有シートを使います。
この挙動は設定画面でOFFにもできます。

アプリ内の写真と端末側の写真は独立しています。
**Pictaの記録を削除しても、端末に保存された写真は削除されません。**

### エクスポートの受け渡し

| | 実装 |
| --- | --- |
| Web/PWA | ファイルのダウンロード |
| iOS/Android | 一時領域へ書き出して共有シート（ファイルApp・メール・クラウド等） |

## データの保存場所

初期版ではアカウント登録もクラウド同期も必要ありません。すべて端末内に保存されます。

```
IndexedDB (picta)
 ├─ records   記録のメタデータ（写真は含まない）
 ├─ photos    写真の実体または実ファイルへの参照
 └─ tags      登録済みタグ

Web/PWA      : photos ストアに ArrayBuffer として保存
iOS/Android  : アプリ専用領域に .jpg ファイルとして保存し、DBにはパスのみ保持
```

記録一覧や検索では写真のバイト列を読み込まないため、枚数が増えても一覧表示は軽量です。
写真の枚数と概算容量は設定画面で確認できます。

古いiOS SafariにはIndexedDB内のBlobを失う既知の不具合があるため、Webでは
Blobではなく**ArrayBuffer**で保存しています。

## エクスポート形式

### CSV

```csv
id,capturedAt,memo,tags,photoFileName
001,2026-09-21T12:31:00,"この店また来たい","旅行|グルメ","20260921_123100.jpg"
```

- 文字コードは**BOM付きUTF-8**（Excelで日本語が化けないため）
- タグは `|` 区切り
- 撮影日時は端末のローカル時刻
- 写真そのものは含まれません

### 写真付きZIP（バックアップ）

```
Picta_Export_20260921.zip
├── manifest.json
├── records.csv
└── photos/
    ├── 20260921_123100.jpg
    └── 20260920_183000.jpg
```

`manifest.json` は将来のインポートで互換性を保つためのバージョン情報を持ちます。

```json
{
  "format": "picta-export",
  "version": 1,
  "app": "Picta 1.0",
  "exportedAt": "2026-09-21T03:31:00.000Z",
  "recordCount": 2,
  "timezoneOffsetMinutes": 540,
  "csv": {
    "file": "records.csv",
    "encoding": "utf-8-bom",
    "columns": ["id", "capturedAt", "memo", "tags", "photoFileName"],
    "tagSeparator": "|"
  },
  "photoDir": "photos/"
}
```

同じ秒に撮影された写真はファイル名が衝突するため `_2`, `_3` を付与し、
`records.csv` の `photoFileName` と必ず一致させています。

## テスト

```bash
npm test          # 単体・画面テスト
npm run build && npm run test:e2e   # 実ブラウザでの通し確認
```

E2Eは Chromium の擬似カメラデバイスを使い、
撮影 → メモ → タグ → 保存 → 一覧 → 詳細 → 編集 → 検索 → タグ絞り込み →
ZIP/CSVエクスポート → 削除 までを実際に操作して検証します。

E2Eには Playwright のブラウザが必要です（未取得の場合は `npx playwright install chromium`）。

## ディレクトリ構成

```
src/
├── capture/    カメラ・画像エンコード・音声入力
├── db/         IndexedDB スキーマと記録/タグ/写真のリポジトリ
├── export/     CSV・ZIP・manifest・受け渡し
├── platform/   実行環境判定と、OS依存機能のアダプタ
├── screens/    画面
├── ui/         画面間で共有するUI部品
├── format.ts   日本語の日付表記
├── settings.ts 端末保存などの設定
└── types.ts    ドメイン型
```

## v1で実装していないもの

クラウド同期、アカウント、SNS的な機能、AIによる画像認識や自動メモ生成、写真編集、
フィルター、地図・GPS、カレンダー連携、タスク管理、リマインダー、音声ファイルの保存。
ZIPからのインポート（復元）も未実装ですが、`manifest.json` にバージョンを持たせることで
将来対応できる形式にしてあります。

## 開発ログ

各Phaseの実装・テスト・確認内容と既知の問題は [docs/DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md) にあります。
