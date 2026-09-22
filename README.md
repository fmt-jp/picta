# トリコト / Torikoto

写真を撮ったついでに、一言残す。

トリコトは、撮影した直後に短いメモとタグを添えて残すための軽量な記録アプリです。
日記アプリでも写真編集アプリでもありません。大切にしているのは次の3点だけです。

1. アプリを開いたらすぐ撮れる
2. 写真に一言を添えられる
3. 後から簡単に見つけられる

## 主な機能

- 起動直後にカメラ（ホーム画面やダッシュボードを挟まない）
- 1:1のビューファインダー。**見えている枠がそのまま保存される**
- 撮影後にメモ（キーボード / 音声入力）とタグを付けて保存
- 撮影日時と撮影地点を記録し、**写真のEXIFにも書き込む**
- 登録済みタグの複数選択と、その場での新規タグ追加
- 写真をアプリ内と端末側の両方に保存
- 撮影日時の新しい順・日付グループの記録一覧
- 記録の詳細 / 編集 / 削除
- 一覧から複数選択して、メモだけ／記録ごと まとめて削除
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

## もうひとつの公開先（fmt-jp/open）へ自動反映

このアプリは [fmt-jp/open](https://github.com/fmt-jp/open) のアプリ置き場でも
`torikoto/` として公開しています。`main` に push すると
`.github/workflows/publish-to-open.yml` がビルドし、`open` 側の `torikoto/` を
更新します（`open` の他のアプリや `index.html` には触れません）。

### 必要な設定

別リポジトリへ push するため、`GITHUB_TOKEN` では権限が足りません。
次のシークレットを **このリポジトリ** に登録してください。

| | |
| --- | --- |
| 場所 | Settings → Secrets and variables → Actions → New repository secret |
| 名前 | `OPEN_REPO_TOKEN` |
| 値 | `fmt-jp/open` に対する **Contents: Read and write** を持つトークン |

fine-grained PAT で「Repository access」を `fmt-jp/open` だけに絞るのが安全です。
アカウント全体に効くトークンを置きたくない場合は、代わりに
`open` 側のデプロイキー（書き込み許可）を作り、秘密鍵をシークレットに入れて
SSH で push する形にもできます。

**シークレットが未設定の間、このワークフローは何もせずに終了します**
（失敗扱いにはしません）。設定した時点から自動反映が始まります。

初回のみ、`open/index.html` のアプリ一覧にカードを1件追加する必要があります
（一覧は自動更新の対象外）。

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
  `NSSpeechRecognitionUsageDescription` / `NSPhotoLibraryAddUsageDescription` /
  `NSLocationWhenInUseUsageDescription`
- Android: `CAMERA` / `RECORD_AUDIO` / `INTERNET` /
  `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` /
  `WRITE_EXTERNAL_STORAGE`(maxSdkVersion=28) と カメラfeature（任意）

権限は起動時に一括要求せず、**その機能を初めて使うとき**に要求します
（カメラ画面を開いたとき、マイクボタンを押したとき、初めて撮影したとき、
端末へ保存するとき）。

## プラットフォーム別の制約

同じ機能がすべてのプラットフォームで同じようには実現できません。
トリコトは無理に同一実装にせず、各プラットフォームで可能な最善の方法を選んでいます。

### カメラ

| | 実装 | 備考 |
| --- | --- | --- |
| Web/PWA | `getUserMedia` によるアプリ内ビューファインダー | HTTPSまたはlocalhostが必須 |
| iOS | 同上（WKWebView） | ホーム画面追加のPWAでは環境によりカメラが使えないことがあるため、`<input type="file" capture>` へフォールバックします |
| Android | 同上 | |

撮影画面はヘッダー（トリコトのアイコンと文字）・1:1のビューファインダー・シャッターの構成です。
カメラ映像は4:3などで届くため中央を正方形に切り出しますが、切り出す範囲は
ビューファインダーに映っている範囲と完全に一致します（`object-fit: cover` と同じ切り出し）。
保存時は長辺2048px・JPEG品質0.9に正規化します（容量対策）。
ファイル選択のフォールバックで取り込んだ画像も、同じく中央を正方形に切り出します。

### 撮影日時・位置情報・メモ（EXIF / XMP）

`getUserMedia` で撮影した画像はcanvas経由で生成されるため、**EXIFが一切付きません**。
そのためトリコトは日時・位置・メモを自分で用意し、記録として保存したうえで、
保存する写真のメタデータにも書き込みます。

| 項目 | 取得元 |
| --- | --- |
| 撮影日時 | シャッターを押した時刻。ファイル選択で取り込んだ画像は、その画像の `DateTimeOriginal` を優先 |
| 撮影地点 | Geolocation API。ファイル選択で取り込んだ画像は、その画像のGPS EXIFを優先 |
| キャプション | 入力したメモ。ファイル選択で取り込んだ画像にキャプションがあれば、メモの初期値にする |

#### メモをどこに書くか

「キャプション」に相当するフィールドは複数あり、日本語が確実に残るものは限られます。
そのため同じ文字列を次の3か所に書きます。

| 書き込み先 | 文字コード | 備考 |
| --- | --- | --- |
| EXIF `UserComment` | UTF-16（`UNICODE\0` 前置） | EXIF標準で日本語を扱える唯一のフィールド |
| XMP `dc:description` | UTF-8 | 写真アプリや編集ソフトが「説明 / キャプション」として表示するのはここ |
| EXIF `ImageDescription` | ASCII | **メモが半角英数字のときだけ**書く |

`ImageDescription` は文字コードを宣言できずASCII前提で読まれるため、
日本語を入れると文字化けします。化けた文字を残すより空のほうがましなので、
ASCIIのメモに限って書き込みます（日本語は上の2か所に残ります）。

メモを編集すると、保存済みの写真のメタデータも書き直します。
エクスポートした写真のキャプションが古いまま、という状態を作らないためです。
写真に書き込むメモは先頭2000文字までです（APP1セグメントの容量上限のため）。

- 位置情報の許可は**初回の撮影時**に求めます（起動時には要求しません）
- 取得はシャッターと同時に開始し、保存時に最大2秒だけ待ちます。
  取得できなくても写真は必ず保存されます
- 撮影後画面のバッジで、その1枚だけ位置情報を付けない選択ができます
- 設定画面で位置情報の記録そのものをOFFにできます
- 記録詳細では座標を表示し、「地図で開く」で外部の地図サービスを開きます
  （タップしたときだけ外部へ遷移します）
- 編集画面で、保存済みの記録から位置情報だけを削除できます

書き込むEXIFタグは `DateTime` / `DateTimeOriginal` / `DateTimeDigitized` /
`OffsetTimeOriginal` / `GPSLatitude` / `GPSLongitude`（と各Ref）/
`UserComment` / `ImageDescription` だけです。
これにより、端末のフォトライブラリに保存したコピーや、ZIPで書き出した写真も
他のアプリで撮影日時と場所が見える状態になります。

### カメラの復帰

アプリを再び開いたとき（ホーム画面に追加したPWAでは、多くの場合ページは
読み込み直されず復帰するだけです）、OSはすでにカメラを閉じています。
このとき `<video>` は**最後に描画したコマを表示したまま**になるため、
止まっているのに動いているように見えてしまいます。

トリコトは次の3つで検知して取り直します。

- カメラのトラックの `ended` / `mute` / `unmute`
- `visibilitychange` / `pageshow`（bfcacheからの復帰）/ `focus`
- 上記が飛ばない環境向けに、復帰後に映像のコマが進んでいるかの確認

取り直している間は映像を隠して「カメラを再開しています…」と表示し、
シャッターも押せないようにしています（止まったコマを撮ってしまわないため）。
権限を拒否されている場合は、勝手に要求し直しません。

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
#### 削除の選択肢

記録を削除するとき、**アプリ内だけを削除するか、端末に保存した写真も削除するか**を選べます
（単体削除・まとめて削除の両方）。ただし端末側の削除ができるかはプラットフォーム次第です。

| | 端末の写真を削除 | 理由 |
| --- | --- | --- |
| Android (ネイティブ) | できる | 保存時に書き出したファイルのパスを記録しておき、それを削除する |
| iOS (ネイティブ) | **できない** | 写真Appの写真の削除にはPhotoKitの `deleteAssets` が必要で、利用しているプラグインに該当APIが無い。対応するには小さなネイティブプラグインの自作が必要 |
| Web / PWA | **できない** | ブラウザには、自身がダウンロードしたファイルを削除する手段が無い |

できない環境では、その選択肢を理由付きで選べない状態にして表示します。
写真を端末に残したくない場合は、設定の「撮影した写真を端末にも保存する」をOFFにしてください。

**「アプリ内から削除」を選んだ場合、端末に保存された写真は削除されません。**

### エクスポートの受け渡し

| | 実装 |
| --- | --- |
| Web/PWA | ファイルのダウンロード |
| iOS/Android | 一時領域へ書き出して共有シート（ファイルApp・メール・クラウド等） |

## データの保存場所

初期版ではアカウント登録もクラウド同期も必要ありません。すべて端末内に保存されます。

```
IndexedDB (picta)  ← 旧名のまま（下記参照）
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

### 保存データの保護（Web / PWA）

Webでは写真はIndexedDBにあり、端末の空き容量が少なくなるとブラウザが
消してしまうことがあります。トリコトは `navigator.storage.persist()` で
「消さないでほしい」と申請します。

- 申請するのは**最初の保存が成功したあと一度だけ**です
  （起動時には行いません。ブラウザによっては利用者に確認を出すため）
- 設定画面に保護状態を表示し、保護されていなければ手動で要求できます
- ホーム画面に追加したPWAは、この申請が通りやすくなります
- ネイティブ（iOS/Android）ではアプリ専用領域に保存するため、申請は不要です

「撮影した写真を端末にも保存する」をOFFにすると、写真はアプリ内の1か所だけに
なります。設定画面ではその旨と、バックアップがZIPエクスポートだけになることを
警告として表示します。

### 保存先の名前について

IndexedDBの名前 `picta` と設定の保存キー `picta.settings.v1` は、
アプリ名を変更したあとも**旧名のまま**にしています。これらは利用者から見えない
内部の識別子であり、変更すると既に端末へ保存されている記録と設定が
参照されなくなるためです。

## エクスポート形式

ファイル名は `Torikoto_Export_YYYYMMDD` です。

### CSV

```csv
id,capturedAt,memo,tags,photoFileName,latitude,longitude
001,2026-09-21T12:31:00,"この店また来たい","旅行|グルメ","20260921_123100.jpg",35.681236,139.767125
002,2026-09-20T18:30:00,"ここから見ると綺麗","旅行","20260920_183000.jpg",,
```

- 文字コードは**BOM付きUTF-8**（Excelで日本語が化けないため）
- タグは `|` 区切り
- 撮影日時は端末のローカル時刻
- `latitude` / `longitude` は位置情報がある記録だけ入る（エクスポート形式 version 2 で追加。
  先頭5列は version 1 と同じ並びなので、古い列だけを読む処理もそのまま動きます）
- 写真そのものは含まれません

### 写真付きZIP（バックアップ）

```
Torikoto_Export_20260921.zip
├── manifest.json
├── records.csv
└── photos/
    ├── 20260921_123100.jpg
    └── 20260920_183000.jpg
```

`manifest.json` は将来のインポートで互換性を保つためのバージョン情報を持ちます。
アプリ名変更前に書き出したZIPは `"format": "picta-export"` になっています。
中身は同一なので、将来のインポートでは両方を受け付けます
（`LEGACY_EXPORT_FORMAT` として定義済み）。

```json
{
  "format": "torikoto-export",
  "version": 2,
  "app": "Torikoto 1.0",
  "exportedAt": "2026-09-21T03:31:00.000Z",
  "recordCount": 2,
  "timezoneOffsetMinutes": 540,
  "csv": {
    "file": "records.csv",
    "encoding": "utf-8-bom",
    "columns": ["id", "capturedAt", "memo", "tags", "photoFileName", "latitude", "longitude"],
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
フィルター、アプリ内の地図表示、位置情報を使った検索、カレンダー連携、タスク管理、
リマインダー、音声ファイルの保存。
（位置情報の**記録と表示**は対応しています。地図表示と位置での検索が未対応です）
ZIPからのインポート（復元）も未実装ですが、`manifest.json` にバージョンを持たせることで
将来対応できる形式にしてあります。

## 開発ログ

各Phaseの実装・テスト・確認内容と既知の問題は [docs/DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md) にあります。
