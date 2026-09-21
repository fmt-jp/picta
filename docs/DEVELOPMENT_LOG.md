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
