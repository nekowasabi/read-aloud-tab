# Read Aloud Tab

ブラウザのタブコンテンツを音声で読み上げるChrome/Firefox拡張機能

## 特徴

### 基本機能
- 🗣️ Web Speech API による高品質な音声合成
- 📱 直感的でモダンなポップアップUI
- ⚙️ 詳細な音声設定（速度、音量、音の高さ、音声選択）
- 🔄 再生、一時停止、停止の完全制御
- 📊 リアルタイムの読み上げ進捗表示
- 🎯 スマートなコンテンツ抽出（記事、メインコンテンツの自動検出）

### 高度な機能
- 🤖 **AI要約/翻訳機能** - OpenRouter API（Gemini 2.5 Flash-lite等）による高品質な要約・翻訳
- ⚡ **プリフェッチ機能** - 読み上げ中に次タブのAI処理を先行実行、待機時間ゼロ
- 🔋 **Keep-alive戦略** - Chrome Service Workerの30秒制限を回避、長時間読み上げに対応
- 👥 **音声の性別選択** - 女性/男性音声の優先選択（ハイブリッドパターンマッチング方式）
- 📑 **複数タブキュー** - 複数タブの連続読み上げ、ドラッグ&ドロップで順序変更
- 🌐 **ブラウザ別最適化** - Chrome（Manifest V3 Offscreen Document）/ Firefox（Persistent Script）

## 必要要件

- Node.js 18以上
- OpenRouter の API トークン（要約/翻訳機能を利用する場合）

## インストール方法

### 開発版

1. 依存関係をインストール
```bash
npm install
```

2. 拡張機能をビルド
```bash
# Chrome用
npm run build:chrome

# Firefox用
npm run build:firefox
```

3. ブラウザに拡張機能を読み込み

#### Chrome の場合:
- `chrome://extensions/` を開く
- 「デベロッパーモード」を有効にする
- 「パッケージ化されていない拡張機能を読み込む」をクリック
- `dist/chrome` フォルダを選択

#### Firefox の場合:
- `about:debugging` を開く
- 「このFirefox」を選択
- 「一時的なアドオンを読み込む」をクリック
- `dist/firefox/manifest.json` を選択

## 使い方

### 基本的な使い方

1. 読み上げたいWebページを開く
2. 拡張機能アイコンをクリックしてポップアップを開く
3. 「読み上げ開始」ボタンをクリック
4. 必要に応じて一時停止、再開、停止を操作
5. 設定ボタン（⚙️）から音声設定をカスタマイズ

### キーボードショートカット

- **Alt+R**: 読み上げを再生/一時停止
- **Ctrl+Shift+Q** (Mac: Command+Shift+Q): すべてのタブをキューに追加して再生

## 高度な機能

### AI要約/翻訳機能

OpenRouter APIを使用して、長文コンテンツの要約や翻訳を実行します。

**設定方法**:
1. オプションページ（⚙️ボタン → 「設定を開く」）を開く
2. 「AI設定」セクションでOpenRouter APIキーを入力
3. 要約機能、翻訳機能を有効化
4. モデル選択（推奨: `google/gemini-2.5-flash-lite`）

**トークン数設定**:
- 要約: 4500トークン（約2250文字）
- 翻訳: 6000トークン（約1500-2100文字）

### プリフェッチ機能

読み上げ中に次のタブのAI処理を事前に実行し、タブ切り替え時の待機時間を解消します。

**動作フロー**:
```
タブN読み上げ中 → 次タブN+1のコンテンツ取得 → 要約 → 翻訳 → キャッシュ
タブN+1切り替え → キャッシュから即座に読み上げ開始
```

**メリット**:
- タブ切り替え待機時間: 最大数秒 → 約100ms以下
- シームレスな連続読み上げ体験

### 音声の性別選択機能

女性/男性音声の優先選択が可能です（ハイブリッド方式）。

**使い方**:
1. 設定パネル → 「音声設定」 → 「音声の性別」
2. 「すべて」「女性優先」「男性優先」から選択
3. 推奨音声グループとその他音声グループで表示

**各プラットフォームの推奨音声**:
- **macOS/iOS**: Kyoko (女性, premium), Daniel (男性)
- **Windows**: Microsoft Ayumi (女性, premium), Microsoft Ichiro (男性)
- **Chrome/Edge**: Google 日本語 (女性), Google UK English (男性)

### Keep-alive戦略（Chrome専用）

Chrome Service Workerの30秒タイムアウト制限を回避し、長時間読み上げを実現します。

**仕組み**:
- Offscreen Document ↔ Service Worker間の永続ポート接続
- 20秒間隔のハートビート送信でService Workerをアクティブに保つ
- 指数バックオフ再接続で安定性を確保

**効果**:
- 3分コンテンツ × 3倍速 = 60秒の読み上げが途中で停止しない

## バージョン管理

拡張機能のバージョンは `package.json` で一元管理されます。

**バージョン更新手順**:
1. `package.json` の `version` フィールドを更新（例: `"1.0.3"` → `"1.0.4"`）
2. ビルドを実行: `npm run build:chrome` / `npm run build:firefox`
3. 自動的に `dist/chrome/manifest.json` と `dist/firefox/manifest.json` のバージョンが更新されます

## トラブルシューティング

### Firefox AMO版での音声・読み上げ停止問題

**問題1: 音声が男性になる**

**原因**:
- Firefox AMO版では署名検証で起動が遅延し、音声リスト取得が間に合わない
- デフォルト音声（男性）が使用される

**解決策**:
- 音声リスト取得タイムアウトを3秒→10秒に延長
- 失敗時に最大3回リトライ（exponential backoff）
- 音声が見つからない場合は日本語音声を自動選択

**問題2: 読み上げが途中で止まる**

**原因**:
- チャンクサイズが小さすぎる（80-96文字は日本語では2-3文程度）
- 長文コンテンツで数十〜数百のチャンク遷移が発生し、エラー率が上昇

**解決策**:
- Firefoxでのチャンクサイズを最低150文字に設定（高速度時）
- チャンク遷移リトライ回数を2→5回に増加
- エラーハンドリングを強化（詳細ログ出力、スキップ処理）
- タイムアウト検知（20秒以上ギャップ）と自動リカバリー

### エラーログの読み方

**音声初期化エラー**:
```
[TTSEngine] Failed to get voices after 3 retries
→ 対応: Firefoxを再起動、拡張機能を再有効化
```

**チャンク遷移エラー**:
```
[TTSEngine] Chunk transition failed - detailed error report { ... }
→ 対応: 読み上げ継続（自動リトライで対応）
```

**20秒以上のギャップ**:
```
[TTSEngine] Heartbeat gap: 25000ms (>20s threshold)
→ 対応: システム負荷が高い可能性。CPU/メモリ確認
```

## 開発

### 開発環境のセットアップ

```bash
# 依存関係のインストール
npm install

# 開発ビルド（ファイル監視付き）
npm run dev

# 型チェック
npm run typecheck

# リント
npm run lint

# フォーマット
npm run format

# テスト実行（390 tests）
npm run test

# テスト監視モード
npm run test:watch
```

### 技術スタック

- **言語**: TypeScript 5.x
- **ビルドツール**: Webpack 5（クロスブラウザビルド対応）
- **UI Framework**: React 18（Popup/Optionsページ）
- **状態管理**: Chrome/Firefox Storage API + React Context
- **音声合成**: Web Speech API
- **API通信**: OpenRouter API（要約・翻訳機能）
- **リアクティブプログラミング**: RxJS 7（Observable-basedチャンク遷移）
- **テスト**: Jest + React Testing Library（390 tests passed）

### アーキテクチャ

詳細なアーキテクチャ情報は [`CLAUDE.md`](./CLAUDE.md) を参照してください。

**リファクタリング計画**: コードベースの保守性と品質向上のための段階的リファクタリング計画を策定しました。
- 📋 [リファクタリング計画書](./REFACTORING_PLAN.md) - 詳細な実施計画
- 📊 [エグゼクティブサマリー](./docs/REFACTORING_SUMMARY.md) - 概要と期待効果
- ✅ [実施チェックリスト](./docs/REFACTORING_CHECKLIST.md) - 実務での実施ガイド

**主要コンポーネント**:
- `src/background/` - Service Worker (Chrome) / Background Script (Firefox)
  - `ttsEngine.ts` - 音声合成エンジン
  - `tabManager.ts` - タブ管理ロジック
  - `aiPrefetcher.ts` - プリフェッチコーディネーター
  - `offscreen/` - Offscreen Document (Chrome Manifest V3)
- `src/content/` - Content Scripts（コンテンツ抽出）
- `src/popup/` - ポップアップUI（React）
- `src/options/` - 設定ページ（React）
- `src/shared/` - 共通コード（型定義、ユーティリティ）

### テスト結果

✅ **全390テスト成功**（12スキップ）
✅ **型チェック**: エラー0件
✅ **カバレッジ**: コア機能を網羅

### ディレクトリ構造

```
src/
├── background/           # Service Worker / Background Script
│   ├── index.ts         # メインバックグラウンドスクリプト
│   ├── service.ts       # BackgroundOrchestrator
│   ├── tabManager.ts    # タブ管理ロジック
│   ├── ttsEngine.ts     # 音声合成エンジン
│   ├── aiPrefetcher.ts  # プリフェッチコーディネーター
│   ├── offscreen/       # Offscreen Document (Chrome)
│   └── __tests__/       # Backgroundテスト
├── content/             # Content Scripts
├── popup/               # ポップアップUI (React)
├── options/             # 設定ページ (React)
└── shared/              # 共通コード
    ├── types/           # TypeScript型定義
    ├── utils/           # ユーティリティ
    └── services/        # API通信サービス
```

## 貢献

バグ報告、機能リクエスト、プルリクエストを歓迎します。

## ライセンス

MIT License
