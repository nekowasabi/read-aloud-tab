# RESEARCH.md: 要約機能トリガー条件の調査結果

## 調査概要

- **調査日**: 2026-03-09
- **対象**: Read Aloud Tab 拡張機能の要約機能
- **問題**: 「すべてのタブを追加」ボタンを押した時のみ要約が動作し、「再生ボタン」や「キューに追加（単体）」では要約されない

## 根本原因

**「すべてのタブを追加」と「単体タブ追加/再生」は同一のコードパスを通る。** 要約が「すべてのタブを追加」でのみ動作するように見えるのは、**タイミングの偶然**による設計上の問題。

### メカニズム

プリフェッチは「現在再生中のタブ + 次の1タブ」のみを対象にする設計（`maxPrefetchAhead=1`）。

- 複数タブでは Tab N 再生中に Tab N+1 のプリフェッチが完了するため、要約が機能しているように見える
- 単一タブでは「自分自身のプリフェッチ完了」と「再生開始」が競合し、要約が間に合わない
- **Tab1（最初のタブ）は複数タブ追加時でも要約なしで再生される**（同じ問題がある）

### なぜ「すべてのタブを追加」で動くのか

```
Tab1再生中（数十秒）→ この間にTab2のプリフェッチ完了 → Tab2切替時に要約済み ✅
```

### なぜ「単体追加/再生」で動かないのか

```
QUEUE_ADD(content=空) → PrefetchScheduler通知 → content空でno-op
  ↓
コンテンツ抽出完了 → onTabUpdated() → emitStatus()のみ（再スケジュールなし）
  ↓
waitForPrefetch() 30秒タイムアウト → 要約なしでフォールバック再生 ❌
```

**核心**: コンテンツ抽出完了後に `PrefetchScheduler` が再トリガーされない。`scheduled` セットと cooldown チェックが再スケジュールをブロックしている。

## Evidence（ファイル+行番号）

| 箇所 | ファイル | 行 |
|------|---------|-----|
| タブ追加（共通） | `src/popup/hooks/useTabQueue.ts` | 197-207 |
| すべて追加ボタン | `src/popup/components/App.tsx` | 158-225 |
| 単体追加ボタン | `src/popup/components/App.tsx` | 139-156 |
| 再生ボタン | `src/popup/components/App.tsx` | 316-332 |
| Background受信 | `src/background/service.ts` | 712-728 |
| プリフェッチ対象選定 | `src/background/prefetch/scheduler.ts` | 124-150 |
| コンテンツなし時リトライ | `src/background/prefetch/worker.ts` | 152-163 |
| waitForPrefetch | `src/background/service.ts` | 144, 186-188 |
| onTabUpdated（再スケジュールなし） | `src/background/tabManager.ts` | 539-600 |

## 処理フロー詳細

### Popup UI → Background

1. **「すべてのタブを追加」ボタン** (`App.tsx:158-225`)
   - ブラウザタブ一覧取得 → 無視リストでフィルタ → 各タブを個別に `addTab()` をループ呼び出し
   - バッチ処理ではなく逐次処理

2. **「キューに追加」ボタン** (`App.tsx:139-156`)
   - `handleAddCurrentTab` → `addTab()` 送信

3. **「再生」ボタン** (`App.tsx:316-332`)
   - `handleToggle` → `control('start')` 送信
   - `service.ts:816-830` → `ensureActiveTabInQueue()` でキュー空なら現在タブ追加（content=空）

4. **共通**: `addTab()` → `sendCommand({ type: 'QUEUE_ADD', payload })` (`useTabQueue.ts:197-207`)

### Background → プリフェッチ

1. `QUEUE_ADD` → `handleAddCommand()` → `tabManager.addTab()` (`service.ts:712-728`)
   - **この時点では要約処理は呼び出されない**
2. `tabManager.addTab()` → `emitStatus()` → `PrefetchScheduler.handleStatusUpdate()` (`scheduler.ts:44-65`)
3. `collectTargets()` が `currentIndex` のタブ + 次の `maxPrefetchAhead`(=1) 個を選択 (`scheduler.ts:124-150`)
4. `PrefetchWorker.enqueue()` → コンテンツ取得 → 要約 → 翻訳 → ResultStore保存

### 問題のポイント

- タブ追加時点では `content` が空 → プリフェッチ実行不可
- コンテンツ抽出完了後 `onTabUpdated()` が `emitStatus()` のみで再スケジュールしない (`tabManager.ts:539-600`)
- `PrefetchScheduler` の `scheduled` セットにより同一タブの再スケジュールがブロック

## 副次的バグ

### `summaryNeeded` の誤判定

**ファイル**: `src/background/prefetch/worker.ts:166`

```typescript
const summaryNeeded = settings.enableAiSummary !== false;  // undefined でも true!
```

`enableAiSummary` が `undefined` の場合でも `summaryNeeded = true` になる。
しかし `AiPrefetcher.summarize()` (`aiPrefetcher.ts:272`) では:

```typescript
if (!settings.enableAiSummary) {
  return content;  // enableAiSummaryがundefinedだとここで元コンテンツを返す
}
```

**影響**: AI要約が無効でもジョブが実行され、元コンテンツがsummaryとして設定される。

## 修正案

### 案A（推奨度: ★★★★★）: `onTabUpdated` でコンテンツ追加時に Scheduler をリセット

`AiPrefetcher` に `onContentAvailable(tabId)` メソッドを追加し、`TabManager.onTabUpdated()` でコンテンツ追加を検出したときに呼び出す。Scheduler 内で `cooldownMap.delete(tabId)` + `scheduled.delete(tabId)` を実行して再スケジュールを可能にする。

**変更ファイル**:
- `src/background/aiPrefetcher.ts` (新メソッド追加)
- `src/background/prefetch/scheduler.ts` (リセットメソッド追加)
- `src/background/tabManager.ts` (onTabUpdated からの呼び出し追加)

**メリット**: 根本的にプリフェッチの再トリガー問題を解決し、全フローで一貫した動作を保証

### 案B（推奨度: ★★★）: `waitForPrefetch` 前にオンデマンド要約を即時実行

`createContentResolver` 内でプリフェッチがスケジュールされていなければ、30秒タイムアウト前に `aiProcessor.processContent()` を直接呼び出す。

**変更ファイル**:
- `src/background/service.ts` (createContentResolver 修正)

**メリット**: 変更箇所が少ない
**デメリット**: プリフェッチの設計思想に反する回避策的アプローチ

## 調査済みファイル一覧

- `src/background/aiProcessor.ts` - AI処理統合管理
- `src/background/aiPrefetcher.ts` - プリフェッチ管理
- `src/background/prefetch/scheduler.ts` - スケジューラ
- `src/background/prefetch/worker.ts` - ワーカー
- `src/background/service.ts` - BackgroundOrchestrator
- `src/background/tabManager.ts` - TabManager
- `src/background/index.ts` - エントリーポイント
- `src/popup/components/App.tsx` - PopupUI
- `src/popup/hooks/useTabQueue.ts` - キュー操作Hook
