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

### 5. プリフェッチ機能（先行AI処理）

**背景と問題の解決**:

複数タブを連続読み上げする場合、タブ切り替え時にAI処理（要約・翻訳）の完了を待つため、最大数秒の待機が発生していました。この問題を解決するため、`AiPrefetcher`コンポーネントが読み上げ中に**次のタブのAI処理を事前に実行**し、切り替え時には既にキャッシュされた結果を利用できる仕組みを実装しました。

**アーキテクチャ概要**:

```typescript
// 読み上げ中の状態遷移
TabManager (reading tab N)
  ↓
PrefetchScheduler → 次のタブN+1をスケジュール
  ↓
PrefetchWorker → コンテンツ取得 → 要約 → 翻訳 → キャッシュ保存
  ↓
resolveContent待機 → プリフェッチ結果を検索 → タブN+1切り替え時に即座に利用
```

**主要コンポーネント**:

1. **AiPrefetcher** (`src/background/aiPrefetcher.ts`)
   - 読み上げ状態の監視
   - PrefetchSchedulerとPrefetchWorkerの起動・管理
   - プリフェッチ結果をTabManagerへ通知

2. **PrefetchScheduler** (`src/background/prefetch/scheduler.ts`)
   - Queue状態イベントを監視
   - 次のタブをプリフェッチ対象として選定
   - 優先度を付けてPrefetchWorkerへエンキュー

3. **PrefetchWorker** (`src/background/prefetch/worker.ts`)
   - 単一ジョブキューで順序的に処理
   - コンテンツ取得 → 要約 → 翻訳のパイプライン実行
   - 結果をResultStoreへ保存

4. **ResultStore** (`src/background/prefetch/resultStore.ts`)
   - `chrome.storage.local` を使用してプリフェッチ結果をキャッシュ
   - TTL (10分) と最大件数(10件) で容量管理
   - FIFO削除でスペース確保

**resolveContent待機ロジック**:

```typescript
// TabManager.ensureTabReady() (lines 968-1001)
private async ensureTabReady(tab: TabInfo): Promise<boolean> {
  // (1) resolveContentを呼び出しプリフェッチ結果を待機
  if (this.resolveContent) {
    const result = await this.resolveContent(tab);
    // プリフェッチ済みの要約/翻訳をTabInfoに反映
    if (result) {
      tab.summary = result.summary;
      tab.translation = result.translation;
      return true;  // プリフェッチ結果を取得
    }
  }

  // (2) プリフェッチ結果がない場合のフォールバック
  // コンテンツリクエストを発行
  const content = await this.requestContent(tab);
  tab.content = content;
  return !!content;
}

// 優先順位: translation > summary > content
private selectPlaybackContent(tab: TabInfo): string {
  if (tab.translation) return tab.translation;
  if (tab.summary) return tab.summary;
  return tab.content || '';
}
```

**2重処理問題の解決**:

以前の実装では、`ensureTabReady()`内で`AiProcessor`を二重に呼び出していたため、プリフェッチ結果が無視されていました。修正により:

- プリフェッチ結果がある場合は、その結果をそのまま使用
- `AiProcessor`の呼び出しを削除し、`resolveContent`からの結果のみを信頼
- 型安全性向上のため、`@ts-expect-error`を削除し、`setContentResolver()`メソッドを追加

**パフォーマンス特性**:

- **タブ切り替え待機時間**: 最大数秒 → 約100ms以下（キャッシュ検索のみ）
- **API呼び出し**: タブ切り替え時に1回削減（プリフェッチ済み）
- **keep-alive との連携**: Offscreen Documentのハートビートにより、Prefetch処理中のService Worker停止を回避

**エラーハンドリング**:

- プリフェッチ失敗時: exponential backoff (2s, 4s, 8s) で最大3回再試行
- API呼び出し失敗時: ジョブをfailed状態へ、Popup UIから手動再試行可能
- Storage容量超過時: TTL と FIFO削除で自動的にスペース確保

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
## Keep-Alive戦略（Chrome 30秒タイムアウト問題の解決）

### 問題の背景

Chrome Manifest V3のService Workerは約30秒でアイドル状態になり自動停止します。これにより、読み上げ速度2.5倍〜3倍の長時間コンテンツで読み上げが50%付近で停止する問題が発生していました。

- 3分コンテンツ × 2.5倍速 = 約72秒
- 3分コンテンツ × 3倍速 = 約60秒
- Service Workerが30秒でタイムアウト → 読み上げの約42〜50%で停止

### 解決策: Offscreen Documentによるkeep-alive

Offscreen Document ↔ Service Worker間の永続ポート接続により、20秒間隔のハートビートを送信してService Workerをアクティブに保ちます。

```typescript
// Offscreen Document (src/background/offscreen/offscreen.ts)
class OffscreenTTSController {
  private keepAlivePort: chrome.runtime.Port | null = null;
  private heartbeatIntervalMs = 20000; // 20秒間隔
  
  // ポート接続の確立
  private setupKeepAlivePort(): void {
    this.keepAlivePort = chrome.runtime.connect({ 
      name: 'offscreen-keepalive' 
    });
    
    this.keepAlivePort.onDisconnect.addListener(() => {
      this.handlePortDisconnect();
    });
    
    this.startHeartbeat();
  }
  
  // ハートビート送信
  private startHeartbeat(): void {
    setInterval(() => {
      if (this.keepAlivePort) {
        this.keepAlivePort.postMessage({
          type: 'OFFSCREEN_HEARTBEAT',
          timestamp: Date.now(),
        });
        this.updateMetrics(true); // メトリクス更新
      }
    }, this.heartbeatIntervalMs);
  }
  
  // 指数バックオフ再接続
  private reconnectWithBackoff(): void {
    const delay = Math.min(500 * Math.pow(2, this.reconnectAttempts), 5000);
    this.reconnectAttempts++;
    
    setTimeout(() => {
      this.setupKeepAlivePort();
    }, delay);
  }
}
```

### パフォーマンス監視機能

```typescript
interface KeepAliveMetrics {
  totalHeartbeatsSent: number;
  failedHeartbeats: number;
  reconnectionAttempts: number;
  lastHeartbeatGap: number;
  connectionStartedAt: number;
  totalDisconnects: number;
}

// 成功率に基づいたアダプティブ間隔調整（オプション）
private calculateOptimalInterval(): number {
  const successRate = 
    (this.metrics.totalHeartbeatsSent - this.metrics.failedHeartbeats) 
    / this.metrics.totalHeartbeatsSent;
  
  if (successRate >= 0.95) {
    // 高成功率: 間隔を増やす（最大25秒）
    return Math.min(this.heartbeatIntervalMs + 2000, 25000);
  } else if (successRate < 0.8) {
    // 低成功率: 間隔を減らす（最小15秒）
    return Math.max(this.heartbeatIntervalMs - 2000, 15000);
  }
  
  return this.heartbeatIntervalMs;
}
```

### Service Worker側の実装

```typescript
// Service Worker (src/background/service.ts)
private handleRuntimePort(port: ChromeRuntimePort): void {
  if (port.name === 'offscreen-keepalive') {
    port.onMessage.addListener((message) => {
      if (message.type === 'OFFSCREEN_HEARTBEAT') {
        const now = Date.now();
        const gap = now - this.lastOffscreenHeartbeatAt;
        
        // 30秒以上のギャップを検知して警告
        if (gap > 30000) {
          this.logger.warn(
            `[KeepAlive] Heartbeat gap: ${gap}ms (>30s threshold)`
          );
        }
        
        this.lastOffscreenHeartbeatAt = now;
      }
    });
    
    port.onDisconnect.addListener(() => {
      this.logger.warn('[KeepAlive] Port disconnected');
      this.lastOffscreenHeartbeatAt = null;
    });
  }
}
```

### Firefox互換性

Firefoxでは`"persistent": true`により永続的なバックグラウンドスクリプトが動作するため、特別なkeep-alive処理は不要です。

```typescript
// BrowserAdapterでの分岐処理
if (BrowserAdapter.getBrowserType() === 'chrome') {
  await this.setupOffscreenKeepAlive();
} else {
  // Firefox: persistent scriptのため不要
  this.logger.info('[KeepAlive] Firefox persistent script mode');
}
```

### エラーハンドリング

カスタムエラークラスで型安全なエラー処理を実現：

```typescript
// src/shared/messages.ts
export class KeepAliveError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'KeepAliveError';
  }
}

export class PortConnectionError extends KeepAliveError {
  constructor(message: string, details?: unknown) {
    super(message, 'PORT_CONNECTION_FAILED', details);
  }
}

export class HeartbeatError extends KeepAliveError {
  constructor(message: string, details?: unknown) {
    super(message, 'HEARTBEAT_FAILED', details);
  }
}
```

### 主要な設計判断

1. **ハートビート間隔: 20秒**
   - Service Workerの30秒タイムアウトより短く、10秒の安全マージンを確保
   - 3倍速読み上げでも60秒のコンテンツに対して3回のハートビート送信

2. **再接続戦略**
   - 指数バックオフ（500ms〜5秒）で最大10回リトライ
   - ポート切断時に自動再接続を試行

3. **ブラウザ別対応**
   - Chrome: Offscreenポート接続が主要なkeep-alive手段
   - Firefox: Persistent scriptのため基本的にkeep-alive不要

### トラブルシューティング

#### ハートビートが届かない場合

```bash
# Chrome DevTools Console
# Service Workerでハートビート受信を確認
[KeepAlive] Offscreen heartbeat received (gap: 20000ms, timestamp: 1234567890)

# 異常なギャップが検出された場合
[KeepAlive] Heartbeat gap detected: 35000ms (>30s threshold)
```

#### ポート接続が失敗する場合

```bash
# Offscreen Document Console
[OffscreenTTS] Failed to setup keep-alive port: Error: ...
[OffscreenTTS] Reconnecting in 500ms (attempt 1/10)
```

#### メトリクスの確認

```typescript
// Offscreen Document Consoleで実行
const metrics = controller.getMetrics();
console.log('Keep-Alive Metrics:', metrics);
// {
//   totalHeartbeatsSent: 120,
//   failedHeartbeats: 2,
//   reconnectionAttempts: 1,
//   lastHeartbeatGap: 20050,
//   connectionStartedAt: 1234567890,
//   totalDisconnects: 1
// }
```
