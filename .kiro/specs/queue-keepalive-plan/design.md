# Design Document

## Overview
この機能は Read Aloud Tab の読み上げキューがブラウザ非アクティブ時にも継続するように、サービスワーカーの keep-alive 制御、ポート再接続、状態復元を統合的に強化する。主な利用者は長文や複数タブを連続で読み上げるユーザーであり、ブラウザ操作を離れても音声再生が途切れない信頼性を提供する。既存の背景処理と UI は再利用しつつ、最低限の新規モジュール追加と既存フックの拡張で実現する。

### Goals
- キューが `reading` 中であればサービスワーカーのアイドル化を防ぎ、ブラウザフォーカス喪失後も読み上げが継続すること。
- ポップアップとバックグラウンドのポート切断が発生しても UI が自動的に復帰し操作継続できること。
- サービスワーカーの再起動後に読み上げ状態を復元し、ユーザーが手動で再生をやり直す必要を最小化すること。
- keep-alive/再接続挙動を観測できる診断情報を開発者が取得できること。

### Non-Goals
- Chrome 以外のブラウザで Offscreen Document を新たに有効化すること。
- 読み上げアルゴリズムや音声合成エンジンの刷新。
- 既存 UI デザインの大幅な変更や新しい設定画面の構築（必要な露出はトグルやメッセージ表示に限定）。

## Architecture

### 既存アーキテクチャ分析
- `BackgroundOrchestrator` が `TabManager` を中心にキュー状態をブロードキャストし、ポップアップとは Port 通信を用いる。
- Manifest V3 のサービスワーカーはイベント駆動で起動し、アイドルになると終了する。現状 keep-alive 施策は存在しない。
- `useTabQueue` フックは単一の Port 接続のみを保持し、切断時に再接続を行わない。
- `TabManager` は永続ストレージからキュー状態を読み込むが、初期化時に `reading` を `idle` にリセットするため再開は行われない。

### ハイレベルアーキテクチャ
````mermaid
graph TD
  Popup[Popup UI<br/>useTabQueue] -- Port 接続/再接続 --> Orchestrator[BackgroundOrchestrator]
  Orchestrator -- 状態更新 --> TabManager
  Orchestrator -- keepAlive イベント --> KeepAliveController[KeepAliveController (新規)]
  KeepAliveController -- chrome.alarms & fallback --> BrowserAPI[BrowserAdapter]
  TabManager -- キュー状態スナップショット --> Storage[StorageManager]
  TabManager -- 再開要求 --> Playback[TTSEngine]
  Diagnostics[Diagnostics Logger] -.-> Storage
  Popup -- UI 通知 --> User
````

- 既存のモジュール境界を維持しつつ、背景層に `KeepAliveController` を追加して heartbeat を統括する。
- ポップアップ層では `useTabQueue` を再接続対応へ拡張し、UI に状態表示を追加する。
- 永続化と復元は `TabManager` と `StorageManager` の範囲内で完結させ、外部 API の追加は不要。

### テクノロジー整合性
- 既存の TypeScript + WebExtension API スタックを継続使用。追加ライブラリは導入しない。
- keep-alive は Chrome Manifest V3 が要求する `chrome.alarms` と `chrome.runtime.connect` を利用し、Firefox では `browser.alarms` のみで互換動作させる。
- ログと診断は標準 `console` 出力と既存の Logger インターフェースを用いる。

### 重要な設計判断
1. **Decision:** keep-alive 機構を `chrome.alarms` ベースに構築する  
   **Context:** Manifest V3 のサービスワーカーは fetch などの周期タスクを持てず、任意の setInterval も利用できない。  
   **Alternatives:** (a) 長寿命 Port を常時開き続ける、(b) 外部 fetch を定期的に投げる。  
   **Selected Approach:** `KeepAliveController` が `chrome.alarms` を生成し、アラーム発火時に no-op メッセージを投げてイベントループを維持する。  
   **Rationale:** アラームは Manifest V3 で正式に推奨されており、ブラウザ互換性が高く、バックグラウンドのみで完結する。  
   **Trade-offs:** 最小周期（1 分）に制限されるため、短い間隔での復旧はポート接続 fallback に委ねる必要がある。

2. **Decision:** ポート再接続を `useTabQueue` の責務として指数バックオフで実装する  
   **Context:** ポップアップのみが Port クライアントであり、UI 状態とエラー表示を統制できる。  
   **Alternatives:** (a) 背景側で push ブロードキャストをリトライする、(b) UI 再描画時にのみ再接続する。  
   **Selected Approach:** `useTabQueue` が `RetryController` を内部に持ち、切断時に 500ms から始まる指数バックオフで `chrome.runtime.connect` を再試行する。  
   **Rationale:** UI 主導で接続状態を把握でき、ユーザーへのフィードバックが簡便。  
  **Trade-offs:** ポップアップが閉じると再接続ループが停止するため、サービスワーカー側の keep-alive と併用が必要。

3. **Decision:** `TabManager` に復元用スナップショットを永続化して自動再開を試行する  
   **Context:** 現在は再起動時に強制 idle 化され、ユーザーが手動で再生を再開する必要がある。  
   **Alternatives:** (a) 再生状態を保持せず通知だけ行う、(b) Popup 側で復元ロジックを実装する。  
   **Selected Approach:** `TabManager.persistQueue` が `status`, `currentIndex`, `progressByTab` を含む構造化スナップショットを書き出し、`initialize` 後に `resumePlaybackIfNeeded` を実行する。  
   **Rationale:** 音声再生制御は背景側に集約されているため一貫性が高く、Popup 依存を排除できる。  
   **Trade-offs:** 保存頻度が高まることでストレージ書き込みが増えるため、既存のデバウンス設定を調整する必要がある。

## System Flows

### フォーカス喪失時の keep-alive 維持フロー
````mermaid
sequenceDiagram
  participant Popup
  participant Orchestrator
  participant KeepAlive
  participant ChromeAlarms
  participant TabManager
  Popup->>Orchestrator: QUEUE_STATUS_UPDATE(status=reading)
  Orchestrator->>KeepAlive: startHeartbeat()
  Popup-->>Popup: ブラウザフォーカス喪失
  Popup-->>Orchestrator: Port onDisconnect
  Orchestrator-->>KeepAlive: ensureHeartbeat()
  ChromeAlarms-->>KeepAlive: onAlarm()
  KeepAlive->>TabManager: sendNoopCommand()
  TabManager-->>TabManager: service worker stays active
  Popup->>Orchestrator: reconnect()
```` 

### サービスワーカー再起動時の状態復元フロー
````mermaid
stateDiagram-v2
  [*] --> LoadingSnapshot: SW 起動
  LoadingSnapshot --> ResumeAttempt: スナップショットに status=reading
  LoadingSnapshot --> Idle: スナップショット未保存
  ResumeAttempt --> Reading: playback.resumeFrom() 成功
  ResumeAttempt --> Idle: 再開失敗 -> エラー通知
  Reading --> Idle: ユーザー停止 or キュー完了
````

## Requirements Traceability
| Requirement | 要約 | 主要コンポーネント | 主なインターフェース | 対応フロー |
|-------------|------|--------------------|-------------------------|------------|
| R1 | `reading` 中は keep-alive 維持 | KeepAliveController, BackgroundOrchestrator | chrome.alarms API, BrowserAdapter | フォーカス喪失フロー |
| R2 | ポート再接続の自動化 | useTabQueue, BackgroundOrchestrator | chrome.runtime.connect, QueueCommand | フォーカス喪失フロー |
| R3 | 状態復元と再開 | TabManager, StorageManager, TTSEngine | persistQueue API, resumeFrom | 再起動ステート図 |
| R4 | 監視・診断 | Diagnostics Logger, Popup UI | Console/Logger, UI バナー | 両フロー |

## Components and Interfaces

### Background 層

#### KeepAliveController (新規: `src/background/keepAlive.ts`)
**Responsibility & Boundaries**
- **Primary Responsibility:** キュー状態に応じた heartbeat (chrome.alarms) の生成・解除と fallback ポート ping を管理する。
- **Domain Boundary:** 背景サービスワーカードメイン。
- **Data Ownership:** 現在の heartbeat 状態（有効/無効）、最終発火タイムスタンプ、連続ミス回数。
- **Transaction Boundary:** アラーム登録・解除操作は単一トランザクション。

**Dependencies**
- **Inbound:** `BackgroundOrchestrator` の状態リスナー。
- **Outbound:** `BrowserAdapter.runtime`, `BrowserAdapter.alarms`（必要なら追加ラッパ）、`TabManager` の no-op コマンド。
- **External:** WebExtension `chrome.alarms`, `chrome.runtime`.

**Contract Definition**
```typescript
interface KeepAliveController {
  startHeartbeat(queueId: string): Promise<void>;
  stopHeartbeat(queueId: string): Promise<void>;
  handleAlarm(alarmName: string): Promise<void>;
  handleFallback(): Promise<void>;
  dispose(): void;
}
```
- **Preconditions:** `startHeartbeat` は `queueId` が `reading` 状態で呼び出される。
- **Postconditions:** `chrome.alarms` に heartbeat が登録される。
- **Invariants:** heartbeat は常に 1 つのみアクティブ。

#### BackgroundOrchestrator (既存拡張: `src/background/service.ts`)
**Responsibility & Boundaries**
- 状態ブロードキャストに加え、`KeepAliveController` の開始/停止トリガを発火し、アラームイベントを受信する。
- Port 管理は従来通りだが、切断時にも keep-alive を維持する責務を追加。

**Contract 更新点**
- 状態リスナー登録時に `reading` 判定を加え、`KeepAliveController.startHeartbeat` を呼び出す。
- `runtime.onConnect` で生成した Port を KeepAlive fallback 用に保持。
- `chrome.alarms.onAlarm` ハンドラを新規で追加し、`KeepAliveController.handleAlarm` を委譲。

#### TabManager (既存拡張: `src/background/tabManager.ts`)
**Responsibility & Boundaries**
- キュー状態スナップショットの永続化、および再初期化時の自動再開。

**Contract 更新点**
```typescript
interface QueueSnapshot {
  status: 'idle' | 'reading' | 'paused' | 'error';
  currentIndex: number;
  progressByTab: Record<number, number>;
  persistedAt: number;
}

interface TabManager {
  persistQueue(force?: boolean): Promise<void>;
  resumePlaybackIfNeeded(): Promise<void>;
}
```
- **Preconditions:** `resumePlaybackIfNeeded` は `initialize` 後に呼ばれる。
- **Postconditions:** 再生中断時は `PlaybackController.start` or `resume` を呼び出す。

### Popup 層

#### useTabQueue (既存拡張: `src/popup/hooks/useTabQueue.ts`)
**Responsibility & Boundaries**
- Port 接続のライフサイクル管理と UI ステート同期。
- 再接続ロジック、接続状態インジケータ、ユーザー通知。

**Contract 更新点**
```typescript
interface UseTabQueueResult {
  connectionState: 'connected' | 'connecting' | 'disconnected';
  lastError: string | null;
}
```
- 再接続の指数バックオフ実装 (`RetryController`) を内部に保持し、クリーンアップでタイマーを解除。
- ブラウザフォーカス喪失イベントを `window.addEventListener('visibilitychange')` で捕捉し、非表示遷移時にポート状態を確認。

#### Diagnostics UI (新規要素: `src/popup/components/DiagnosticsBanner.tsx`)
- keep-alive 状態・再接続試行回数・最終エラーを表示する開発者向けバナー（開発者モード時のみ）。
- `useTabQueue` から診断ステートを取得。

### Shared

#### StorageManager (`src/shared/utils/storage.ts`)
- `QueueSnapshot` を保存するための補助関数（`saveQueueSnapshot`, `loadQueueSnapshot`）を追加。
- 既存の `saveQueue` デバウンスを調整し、保存タイミングを `persistQueue` 呼び出し後に統一。

## Data Models
### キュー復元スナップショット
```typescript
interface QueueSnapshot {
  tabs: SerializedTabInfo[];
  currentIndex: number;
  status: 'idle' | 'reading' | 'paused' | 'error';
  progressByTab: Record<number, number>;
  persistedAt: number;
}
```
- `SerializedTabInfo` は既存の `toSerializedTabInfo` を利用。
- `persistedAt` は keep-alive 監視の警告しきい値（例: 2 分以上更新がない）に使用。

### Heartbeat 設定
```typescript
interface HeartbeatConfig {
  alarmName: string;
  periodInMinutes: number;
  fallbackPingIntervalMs: number;
  maxMissCount: number;
}
```
- デフォルトは `periodInMinutes=1`, `fallbackPingIntervalMs=15000`, `maxMissCount=3`。

## Error Handling

### エラーストラテジ
- **アラーム生成失敗:** `KeepAliveController` が警告ログを出力し、fallback ポート ping を強制的に開始。
- **再接続失敗:** `useTabQueue` が最大リトライ数到達時にユーザーへエラー表示、Logger へ詳細を出力。
- **復元失敗:** `TabManager` が `QUEUE_ERROR` をブロードキャストし、状態を `idle` に戻す。

### 監視
- `console.info` で keep-alive の開始/停止/ミス回数を出力。
- `console.warn` で再接続失敗や復元失敗を通知。
- 将来的な観測用に `DiagnosticsBanner` から最新ステータスを確認できる。

## Testing Strategy
- **Unit Tests**
  - `keepAliveController.test.ts`: アラーム登録・解除、ミスカウントによる fallback の挙動。
  - `useTabQueue.test.tsx`: ポート切断時の再接続バックオフと UI ステート遷移。
  - `tabManager.test.ts`: スナップショット保存と `resumePlaybackIfNeeded` の分岐。
- **Integration Tests**
  - `BackgroundOrchestrator` と `KeepAliveController` の連携で `reading` → `idle` 遷移をモック確認。
  - サービスワーカー再起動シミュレーションでスナップショット復元とエラーハンドリングを検証。
- **E2E/Manual**
  - Chrome でポップアップを閉じた状態で複数タブ読み上げを継続し、停止しないことを確認。
  - フォーカス喪失→復帰を複数回繰り返し、ポップアップ UI が再接続状態になることを観察。

## Performance & Scalability
- `chrome.alarms` は最小周期 1 分であるため、短時間での keep-alive は fallback ping に依存する。ping 間隔は 15 秒まで短縮するが、CPU 負荷を避けるため 5 秒以下にはしない。
- `persistQueue` の書き込み回数増加を抑えるため、既存デバウンス (`QUEUE_PERSIST_DEBOUNCE_MS`) を適用しつつ、読み上げイベント後の即時保存が必要な場合のみ `force=true` を許可する。

## Migration Strategy
````mermaid
graph TD
  A[Phase 1: KeepAliveController 実装] --> B[Phase 2: useTabQueue 再接続導入]
  B --> C[Phase 3: TabManager 復元ロジック展開]
  C --> D[Phase 4: Diagnostics UI とログ整備]
  D --> E[Validation: 手動/自動テスト実施]
```` 
- 各フェーズで単体テストと最小限の手動確認を行い、段階的にリリース。
- フェーズ 2 と 3 の導入前に feature flag（開発者向け設定）で段階的に有効化を検討。
