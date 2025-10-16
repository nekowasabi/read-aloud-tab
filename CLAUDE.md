# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

「Read Aloud Tab」は、ブラウザのタブコンテンツを音声で読み上げる多機能なブラウザ拡張機能です。Chrome/Firefox対応のクロスブラウザ拡張として開発します。

## アクティブ仕様

- `queue-keepalive-plan`: ブラウザ非アクティブ時の読み上げ継続を支える keep-alive 戦略とポート再接続/状態復元の実装計画。
- `queue-prefetch-summary`: 読み上げ中に次キューの翻訳・要約を先行実行して切り替え待機時間を解消する事前処理機能。

## 開発環境セットアップ

```bash
# 依存関係のインストール
npm install

# 開発ビルド（ホットリロード付き）
npm run dev

# Chrome用プロダクションビルド
npm run build:chrome

# Firefox用プロダクションビルド
npm run build:firefox

# テストの実行
npm run test

# リントとフォーマット
npm run lint
npm run format

# 型チェック
npm run typecheck
```

## アーキテクチャ概要

### コア技術スタック
- **言語**: TypeScript 5.x
- **ビルドツール**: Webpack 5 (クロスブラウザビルド対応)
- **UI Framework**: React 18 (popup/optionsページ用)
- **状態管理**: Chrome/Firefox Storage API + React Context
- **音声合成**: Web Speech API
- **API通信**: OpenRouter API (要約機能用)
- **テスト**: Jest + React Testing Library

### ディレクトリ構造

```
src/
├── background/           # Service Worker (Chrome) / Background Script (Firefox)
│   ├── index.ts         # メインバックグラウンドスクリプト
│   ├── service.ts       # BackgroundOrchestrator（メッセージング統合）
│   ├── tabManager.ts    # タブ管理ロジック
│   ├── ttsEngine.ts     # 音声合成エンジン
│   ├── summarizer.ts    # OpenRouter API連携
│   ├── offscreen/       # Offscreen Document (Chrome Manifest V3)
│   │   ├── offscreen.html    # Offscreen Document HTML
│   │   ├── offscreen.ts      # Offscreen TTS Controller
│   │   └── __tests__/        # Offscreenテスト (13テスト)
│   └── __tests__/       # Backgroundテスト (offscreenIntegration含む16テスト)
├── content/             # Content Scripts
│   ├── index.ts         # コンテンツ抽出メイン
│   ├── extractor.ts     # テキスト抽出ロジック
│   └── injector.ts      # DOM操作ユーティリティ
├── popup/               # ポップアップUI
│   ├── index.tsx        # エントリーポイント
│   ├── components/      # Reactコンポーネント
│   └── hooks/           # カスタムフック
├── options/             # 設定ページ
│   ├── index.tsx        # 設定UIメイン
│   └── components/      # 設定コンポーネント
├── shared/              # 共通コード
│   ├── types.ts         # TypeScript型定義
│   ├── constants.ts     # 定数定義
│   ├── storage.ts       # Storage API ラッパー
│   ├── messages.ts      # メッセージ通信ユーティリティ（Offscreen対応）
│   └── utils/
│       ├── browser.ts   # BrowserAdapter（クロスブラウザAPI抽象化）
│       └── __tests__/   # BrowserAdapterテスト (28テスト)
└── manifest/            # マニフェストファイル
    ├── manifest.chrome.json  # Chrome用 Manifest V3 (offscreen権限含む)
    └── manifest.firefox.json # Firefox用 WebExtensions (persistent: true)
```

## 主要機能の実装アーキテクチャ

### 1. タブ読み上げシステム

**アーキテクチャパターン**: Event-driven + Queue-based processing

```typescript
// 読み上げキューの管理
interface ReadingQueue {
  tabs: TabInfo[];
  currentIndex: number;
  status: 'idle' | 'reading' | 'paused';
  settings: TTSSettings;
}

// タブ情報の構造
interface TabInfo {
  tabId: number;
  url: string;
  title: string;
  content?: string;
  summary?: string;
  isIgnored: boolean;
}
```

**実装フロー**:
1. Content Script でページコンテンツを抽出
2. Background Script のキューに追加
3. Web Speech API で逐次読み上げ
4. 状態管理は Chrome Storage API で永続化

### 2. OpenRouter API 連携

**要約処理アーキテクチャ**:

```typescript
interface SummaryRequest {
  content: string;
  maxTokens: number;
  model: string; // e.g., "meta-llama/llama-3.2-1b-instruct"
}

// API通信はBackground Scriptで一元管理
class SummaryService {
  private apiKey: string;
  private queue: SummaryRequest[];

  async summarize(content: string): Promise<string>;
  async batchSummarize(tabs: TabInfo[]): Promise<Map<number, string>>;
}
```

### 3. クロスブラウザ対応

**Chrome Manifest V3でのService Worker制約への対応**:

Chrome Manifest V3ではService Workerが非永続的で、アイドル時に自動停止されます。Web Speech APIはService Workerコンテキストでは不安定なため、**Offscreen Document API**を使用して音声合成を実行します。

#### Chrome: Offscreen Document アーキテクチャ

```typescript
// Service Worker (src/background/service.ts)
// - Offscreen Documentの作成・管理
// - コマンドのフォワーディング
// - 状態のブロードキャスト

// Offscreen Document (src/background/offscreen/offscreen.ts)
// - TTSEngineの実行コンテキスト
// - Web Speech APIの実行
// - 進捗状況の送信

class OffscreenTTSController {
  private ttsEngine: TTSEngine;

  initialize() {
    // Service Workerからのメッセージを受信
    chrome.runtime.onMessage.addListener(async (message) => {
      switch (message.type) {
        case 'OFFSCREEN_TTS_START':
          await this.handleStart(message.payload);
          break;
        case 'OFFSCREEN_TTS_PAUSE':
          this.handlePause();
          break;
        // ...
      }
    });
  }
}
```

#### Firefox: Persistent Background Script

Firefoxでは`"persistent": true`を設定し、バックグラウンドスクリプトを永続化することで、Web Speech APIを安定して実行できます。

```json
// manifest.firefox.json
{
  "background": {
    "scripts": ["background.js"],
    "persistent": true  // 永続化
  }
}
```

#### BrowserAdapter実装

```typescript
// src/shared/utils/browser.ts
class BrowserAdapter {
  // ブラウザ判定
  static getBrowserType(): 'chrome' | 'firefox' | 'unknown' {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      return 'chrome';
    } else if (typeof browser !== 'undefined' && browser.runtime) {
      return 'firefox';
    }
    return 'unknown';
  }

  // 機能サポート判定
  static isFeatureSupported(feature: 'offscreen' | 'speechSynthesis' | 'storageSync'): boolean {
    switch (feature) {
      case 'offscreen':
        return typeof chrome !== 'undefined' && !!chrome.offscreen;
      case 'speechSynthesis':
        return typeof speechSynthesis !== 'undefined';
      case 'storageSync':
        return !!chrome?.storage?.sync || !!browser?.storage?.sync;
    }
  }

  // Offscreen Document API (Chrome専用)
  static async createOffscreenDocument(
    url: string,
    reasons: chrome.offscreen.Reason[],
    justification: string
  ): Promise<void>;

  static async closeOffscreenDocument(): Promise<void>;

  static async hasOffscreenDocument(): Promise<boolean>;
}
```

### 4. 状態管理とメッセージング

**コンポーネント間通信**:
- Background ↔ Content: `chrome.runtime.sendMessage` / `browser.runtime.sendMessage`
- Background ↔ Popup: Port通信でリアルタイム更新
- Storage同期: `chrome.storage.sync` でデバイス間同期

## 実装優先度と段階的リリース計画

### Phase 1: MVP (基本読み上げ機能) ✅
#### 1. 基本アーキテクチャ構築
- [x] Webpack設定とビルド環境
- [x] TypeScript設定
- [x] Manifest V3/WebExtensions基本構造

#### 2. コア読み上げ機能
- [x] 現在のタブのテキスト抽出
- [x] Web Speech APIによる読み上げ
- [x] 再生/一時停止/停止コントロール

#### 3. シンプルなポップアップUI
- [x] 読み上げコントロールボタン
- [x] 音声設定（速度、音量）

### Phase 2: 高度な読み上げ機能
#### 1. 複数タブ対応
- [ ] データモデル拡張
  - `src/shared/types.ts` に読み上げキュー構造 (`queue`, `activeTabId`, `status`) を追加し、`src/shared/storage.ts` で永続化ラッパーを更新
  - 既存ストレージデータとの互換性確保のためマイグレーションガードを実装
- [ ] バックグラウンド処理
  - `src/background/tabManager.ts` と `src/background/index.ts` にキュー操作API（追加/削除/並び替え/スキップ）と状態ブロードキャストを実装
  - `src/shared/messages.ts` へ新規メッセージタイプ（キュー更新、ステータス通知、タブ制御リクエスト）を追加し、単体テストを補完
- [ ] タブリストUI
  - `src/popup/components/` にタブキューリスト・操作ボタン・現在読み上げ中インジケータを実装し、`src/popup/hooks/` を通じてリアルタイム更新
  - アクセシビリティを考慮したキーボードフォーカス制御とJest+RTLによるUIテストを追加

#### 2. 詳細設定
- [ ] 無視リスト機能
  - `src/shared/storage.ts` に無視ドメイン/URLリストのCRUD APIを追加し、バックグラウンド側でキュー投入前フィルタを適用
  - `src/options/` の設定UIにリスト管理コンポーネントとバリデーションを実装、関連テストを補完
- [ ] 音声選択
  - Web Speech API / browser.speechSynthesis の音声一覧を`src/background/ttsEngine.ts`でキャッシュし、ポップアップ設定と同期
  - 音声変更イベントをキューに反映して再生中のタブへ適用する検証フローを追加
- [ ] キーボードショートカット
  - Chrome `chrome.commands` / Firefox `browser.commands` を利用したショートカット設定をバックグラウンドに追加し、キュー操作と連動
  - 設定画面にショートカット変更UIと競合検知を実装し、ブラウザ別マニュアルテスト手順をドキュメント化

### Phase 3: AI要約機能
#### 1. OpenRouter API統合
- [ ] APIキー管理
- [ ] 要約リクエスト処理
- [ ] エラーハンドリング

#### 2. 要約UI
- [ ] 要約表示/読み上げ切り替え
- [ ] バッチ要約処理
- [ ] キャッシュ機能

### Phase 4: 最適化と拡張
#### 1. パフォーマンス最適化
- [ ] 大規模ページ対応
- [ ] メモリ管理
- [ ] バックグラウンド処理最適化

#### 2. UX改善
- [ ] ダークモード
- [ ] 国際化（i18n）
- [ ] アクセシビリティ向上

## 重要な技術的考慮事項

### セキュリティ
- Content Security Policy (CSP) 準拠
- OpenRouter APIキーの安全な保管（暗号化）
- XSS対策（DOMPurifyによるサニタイズ）

### パフォーマンス
- 大規模ページでのテキスト抽出最適化（分割処理）
- メモリリーク防止（イベントリスナー管理）
- Web Worker活用検討（要約処理のオフロード）

### ブラウザ互換性
- Manifest V3 (Chrome) vs WebExtensions (Firefox) の差異対応
- Polyfillの活用
- Feature Detection実装

## テスト戦略

```typescript
// 単体テスト例
describe('TextExtractor', () => {
  test('should extract main content from article page', () => {
    // DOM mock setup
    // Extraction logic test
  });
});

// 統合テスト例
describe('TTS Integration', () => {
  test('should queue and read multiple tabs', async () => {
    // Mock browser APIs
    // Test queue processing
  });
});
```

## デバッグとトラブルシューティング

```bash
# Chrome拡張機能のデバッグ
# 1. chrome://extensions/ を開く
# 2. デベロッパーモードを有効化
# 3. 「パッケージ化されていない拡張機能を読み込む」でdist/chromeフォルダを選択

# Firefox拡張機能のデバッグ
# 1. about:debugging を開く
# 2. 「このFirefox」を選択
# 3. 「一時的なアドオンを読み込む」でdist/firefox/manifest.jsonを選択

# Background Script/Service Workerのログ確認
# Chrome: 拡張機能詳細ページの「Service Worker」をクリック
# Firefox: about:debugging から「調査」をクリック
```

## API仕様とメッセージング

### Background ← → Content Script

```typescript
// Content → Background
interface ExtractedContent {
  type: 'CONTENT_EXTRACTED';
  tabId: number;
  content: string;
  metadata: {
    title: string;
    url: string;
    wordCount: number;
  };
}

// Background → Content
interface ExtractionRequest {
  type: 'EXTRACT_CONTENT';
  options: {
    includeImages: boolean;
    selector?: string;
  };
}
```

### Background ← → Popup

```typescript
// Popup → Background
interface TTSControl {
  type: 'TTS_PLAY' | 'TTS_PAUSE' | 'TTS_STOP';
  tabId?: number;
}

// Background → Popup
interface TTSStatus {
  type: 'TTS_STATUS_UPDATE';
  status: 'idle' | 'reading' | 'paused';
  currentTab?: TabInfo;
  queue: TabInfo[];
}
```

## 注意事項

- Chrome Manifest V3ではbackground pageが廃止されService Workerになっているため、永続的な状態保持にはStorage APIを使用
- Firefox WebExtensionsではまだbackground scriptが使用可能だが、将来的な互換性のため同じアーキテクチャを採用
- Web Speech APIの音声はブラウザ/OSに依存するため、利用可能な音声リストの動的取得が必要
- OpenRouter APIのレート制限に注意（要約リクエストのキューイングとリトライ機構の実装）
- 読み上げ時のチャンクは15秒の制限があるため、読み上げ速度など考慮する必要がある