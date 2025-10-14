# Design Document

## Overview
この機能は Read Aloud Tab の連続読み上げ体験におけるタブ切り替え時の待機時間を解消するため、読み上げ中に次のキューを事前に翻訳・要約して結果をキャッシュし、切り替えと同時に利用できるようにする。主な利用者は連続でタブを読み上げるユーザーであり、背景サービスは既存の AI 処理と連携しながら先行ジョブを制御する。

### Goals
- 読み上げ中でも次のタブを事前処理し、切り替え時のレスポンスを 1 秒未満に抑える。
- 翻訳・要約処理を既存の AI 設定・無視ドメイン設定と整合させる。
- ポップアップ UI で処理状況と失敗時の再試行手段を可視化する。

### Non-Goals
- 新しい AI モデルや外部 API の導入。
- 既存読み上げアルゴリズムの刷新。
- Prefetch の結果を複数端末間で同期する仕組み。

## Architecture

### Existing Architecture Analysis
- `TabManager` がキュー管理と AI 処理を担い、`AiPrefetcher` が既存の要約ジョブを呼び出す実装が存在する（`src/background/aiPrefetcher.ts`）。
- `BackgroundOrchestrator` がキュー状態をポートへ共有し、`useTabQueue` が UI を更新する構造。
- 既存 AI 処理は読み上げ開始時に同期的にまとめて実行するため、切り替え時の遅延が発生している。
- Prefetch 結果を永続化する仕組みがなく、切り替え時に毎回再取得する。

### High-Level Architecture
````mermaid
graph TD
  TabManager -- status --> Orchestrator
  Orchestrator -- status broadcast --> Popup
  TabManager -. register .-> PrefetchScheduler
  PrefetchScheduler -- enqueue --> PrefetchWorker
  PrefetchWorker -- fetch content --> ContentResolver
  PrefetchWorker -- translate/summary --> AiPipeline
  PrefetchWorker --> ResultStore[(PrefetchCache)]
  Popup -- fetch status --> PrefetchStatusAPI
  Popup -- manual retry --> PrefetchScheduler
````
- `PrefetchScheduler` は `TabManager` からステータスイベントを受け、先行処理対象を決定してジョブキューへ投入する。
- `PrefetchWorker` は単一並列でタブコンテンツ取得→要約→翻訳→キャッシュ保存まで実行。
- `ResultStore` は Storage API (local) を利用し、タイムスタンプと容量管理を行う。
- Popup はステータスエンドポイント/ストレージから処理状況を取得する。

### Technology Alignment
- 言語/環境: 既存と同じ TypeScript + Chrome/Firefox WebExtensions。
- AI 処理: 既存 `OpenRouterClient` を再利用し、要約/翻訳機能を Prefetch に適用。
- ストレージ: 先行結果は `chrome.storage.local` に保存。容量制限を考慮し、TTL と LRU 風の削除を実装。

### Key Design Decisions
1. **Decision:** Prefetch キューは `TabManager` に常駐させ、Dedicated Worker を作らず Service Worker 内で逐次処理。  
   **Context:** Chrome の service worker はイベント駆動であり長時間の並列処理が難しい。  
   **Alternatives:** (a) Offscreen Document 内で別ワーカーを起こす、(b) 外部サーバーへ処理委譲。  
   **Selected Approach:** 既存 `AiPrefetcher` を拡張し、ジョブ管理と結果保存を追加。  
   **Rationale:** 既存コードとの親和性が高く、manifest 変更も不要。  
   **Trade-offs:** 処理中に service worker がスリープしないよう keep-alive が必要。

2. **Decision:** 結果キャッシュは `chrome.storage.local` に JSON 形式で保存し、最大 10 件まで保持。  
   **Context:** 翻訳・要約テキストは比較的サイズが大きく、sync ストレージは容量制限が厳しい。  
   **Alternatives:** (a) IndexedDB に保存、(b) memory-only で保持。  
   **Selected Approach:** Storage API (local) を利用し、容量超過時に FIFO 削除。  
   **Rationale:** 実装が簡潔で、セッション間でもキャッシュを再利用できる。  
   **Trade-offs:** 多端末間での同期は不可。

3. **Decision:** Popup 表示用の先行状態は `PrefetchStatusProvider` hook を新設し、`chrome.storage.onChanged` + runtime メッセージで更新。  
   **Context:** `useTabQueue` に状態を増やすと再接続ロジックが複雑化する。  
   **Alternatives:** (a) Queue 状態に含めてブロードキャスト、(b) Popup が storage を直接ポーリング。  
   **Selected Approach:** Popup 専用のステータス hook を追加し、Prefetch からステータス更新メッセージを送る。  
   **Rationale:** 職責を明確化し、再接続フローへの影響を限定できる。

## System Flows

### Prefetch Scheduling and Execution
````mermaid
sequenceDiagram
  participant TM as TabManager
  participant PS as PrefetchScheduler
  participant PW as PrefetchWorker
  participant OP as OpenRouterClient
  participant RS as ResultStore

  TM->>PS: QueueStatusUpdate(status=reading)
  PS->>PS: Determine next tabs (maxPrefetchAhead)
  PS->>PW: enqueue(tabId)
  PW->>TM: requestContentForPrefetch(tabId)
  TM-->>PW: content/summary
  PW->>OP: summarize(content)
  OP-->>PW: summary
  PW->>OP: translate(summary)
  OP-->>PW: translation
  PW->>RS: saveResult(tabId, summary, translation)
  RS-->>PW: ack
  PW->>TM: notifyPrefetchComplete(tabId)
  TM->>PS: updateStatus(tabId, completed)
````

### Cache Eviction Flow
````mermaid
flowchart TB
  A[PrefetchResultStore.save] --> B{Cache Size > Limit?}
  B -- No --> C[Persist Result]
  B -- Yes --> D[Sort by persistedAt]
  D --> E[Remove Oldest Entry]
  E --> C
````

## Requirements Traceability
| Requirement | Summary | Components | Interfaces | Notes |
|-------------|---------|------------|------------|-------|
| R1 | 読み上げ中の先行ジョブスケジュール | PrefetchScheduler, BackgroundOrchestrator | Queue status events, Prefetch API | 並列制限=1 で制御 |
| R2 | 翻訳・要約結果の永続化と鮮度管理 | PrefetchWorker, ResultStore | Storage API, AiProcessor | TTL 10 分, LRU 削除 |
| R3 | UI 状態表示とエラー対処 | PrefetchStatusProvider, Popup UI | Runtime messages, Storage listener | 再試行ボタン・開発者ログ |

## Components and Interfaces

### Background Layer

#### PrefetchScheduler (`src/background/prefetch/scheduler.ts` 新設)
- **責務:** Queue 状態に応じて先行処理対象を決定し、PrefetchWorker へタスクを送る。
- **データ所有:** ペンディングタブ ID、再試行カウンタ。
- **依存:** TabManager (status events), PrefetchWorker (enqueue), StorageManager (設定読み込み)。
- **インターフェース:**
```typescript
interface PrefetchScheduler {
  initialize(): Promise<void>;
  handleStatusUpdate(payload: QueueStatusPayload): void;
  retry(tabId: number): Promise<void>;
}
```
- **前提:** TabManager.initialize 済み。
- **後保証:** enqueue 済みタスクは PrefetchWorker が実行可能。

#### PrefetchWorker (`src/background/prefetch/worker.ts` 新設)
- **責務:** コンテンツ取得、要約/翻訳、結果保存、完了通知。
- **依存:** TabManager.requestContentForPrefetch、OpenRouterClient、ResultStore。
- **インターフェース:**
```typescript
interface PrefetchWorker {
  enqueue(tabId: number, priority: number): void;
}
```
- **内部:** 単体キュー、実行中フラグ、バックオフ再試行。

#### ResultStore (`src/background/prefetch/resultStore.ts` 新設)
- **責務:** 要約・翻訳結果の永続化、TTL 管理、容量制御。
- **依存:** chrome.storage.local。
- **インターフェース:**
```typescript
interface PrefetchResult {
  tabId: number;
  summary: string;
  translation?: string;
  generatedAt: number;
}

interface ResultStore {
  save(result: PrefetchResult): Promise<void>;
  get(tabId: number): Promise<PrefetchResult | null>;
  delete(tabId: number): Promise<void>;
  prune(): Promise<void>;
}
```

### Popup Layer

#### PrefetchStatusProvider (`src/popup/hooks/usePrefetchStatus.ts` 新設)
- **責務:** Storage から先行処理状態を監視し、Popup に提供。
- **依存:** chrome.storage.onChanged, runtime messages。
- **インターフェース:**
```typescript
interface PrefetchStatus {
  tabId: number;
  state: 'pending' | 'processing' | 'completed' | 'failed';
  updatedAt: number;
  error?: string;
}

export default function usePrefetchStatus(): PrefetchStatus[];
```

#### UI Components
- `PrefetchStatusPanel` を `App.tsx` に組み込み、タブごとの状態と再試行ボタンを提供。
- 再試行は `runtime.sendMessage({ type: 'PREFETCH_RETRY', tabId })` を通じて PrefetchScheduler へ。

### Messaging
- 新規 Runtime メッセージ:
  - `PREFETCH_STATUS_SYNC`: Prefetch -> Popup (状態更新)
  - `PREFETCH_RETRY`: Popup -> PrefetchScheduler (手動再試行)
  - `PREFETCH_RESULT_READY`: PrefetchWorker -> TabManager (結果保存完了)

## Data Models

### PrefetchResult (Storage)
```typescript
interface PrefetchResult {
  tabId: number;
  summary: string;
  translation?: string;
  generatedAt: number; // epoch ms
}
```
- 保存キー: `prefetch_results`
- 構造: `{ results: PrefetchResult[], lastUpdated: number }`
- TTL: 10 分、最大件数: 10。

### PrefetchStatus (Runtime Broadcast)
```typescript
interface PrefetchStatusMessage {
  type: 'PREFETCH_STATUS_SYNC';
  payload: {
    tabId: number;
    state: 'pending' | 'processing' | 'completed' | 'failed';
    updatedAt: number;
    error?: string;
  };
}
```

## Error Handling
- PrefetchWorker が OpenRouter API エラーを受けた場合: バックオフ (2s, 4s, 8s) で最大 3 回再試行し、失敗時は状態を `failed` に設定。
- Storage 保存失敗: 警告ログを出し Prefetch を一時停止。開発者モードで診断に記録。
- 手動再試行: 同じタブ ID の `failed` 状態を `pending` に戻し、ジョブ再投入。

## Testing Strategy
- **Unit:**
  - PrefetchScheduler の対象選定とキャンセル。
  - ResultStore の保存・TTL・容量制御。
  - PrefetchWorker の成功/失敗ルート。
- **Integration:**
  - BackgroundOrchestrator + PrefetchScheduler + Worker フローで `QUEUE_STATUS_UPDATE` → 結果保存までをモックで検証。
  - Popup hook が storage 変更を受けて状態更新することを確認。
- **E2E/Manual:**
  - 連続読み上げ時に切り替え待機が改善されるか Chrome で QA。
  - 開発者モード ON/OFF で診断表示が切り替わるか確認。

## Performance & Scalability
- Prefetch は常に単一ジョブを処理し、CPU/BW 負荷を抑える。
- 翻訳/要約は 1 タブあたり 2 API コール。rate limit に達した場合は exponential backoff。
- キャッシュ TTL 10 分、任意に設定可能な `maxPrefetchAhead` (デフォルト 1) を提供。

## Migration Strategy
````mermaid
graph TD
  A[Phase1: Prefetch Scheduler/Worker 実装] --> B[Phase2: ResultStore 導入]
  B --> C[Phase3: Popup 状態表示と再試行 UI]
  C --> D[Phase4: 開発者診断ログ]
  D --> E[QA & Rollout]
````
- 段階毎に feature flag (`prefetchEnabled`) を利用して段階的ロールアウト。
- 既存 `AiPrefetcher` から新 Scheduler/Worker へ移行後、旧コードを整理。
- Rollback: `prefetchEnabled=false` で既存挙動に戻せるようにする。
*** End of Document***
*** End Patch
