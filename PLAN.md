# title: 全タブ一括キュー投入とドメイン除外柔軟化

## 概要
- ブラウザで開いているタブを一括で読み上げキューへ投入できるバックグラウンド処理とUI操作を追加し、将来のドメイン除外指定にも適用できる柔軟な構成を整える。

### goal
- 利用者がポップアップからワンクリックで現在のウィンドウ内タブを読み上げキューに登録し、不要なドメインを除外したうえで連続再生できる。

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること

## 開発のゴール
- 全タブ一括追加のコマンドとバックエンド処理を提供し、TabManager／UI が効率的に複数タブを扱えるようにする。
- ドメイン除外ロジックをサービス化して、将来のテキストエリア経由での除外指定に備える。

## 実装仕様
- `QueueCommandMessage` に `QUEUE_ADD_OPEN_TABS` を追加。payload: `{ scope, includePinned, position, autoStart, excludeDomains }`。
- 背景側に `OpenTabsQueueService`（新規）を追加し、`chrome.tabs.query` で取得したタブから読み上げ可能なものだけを `QueueTabInput[]` に変換。
- ドメイン除外の判定を `DomainIgnoreService`（新規、TabManagerと共有）で行い、永続設定＋一時オーバーライド両方に対応。
- `TabManager` に `addTabsBulk` を追加し、バルク投入時の重複排除・位置決定・persist／emit の集約と `autoStart` 処理を行う。既存 `addTab` は内部で `addTabsBulk` を呼ぶようリファクタ。
- `useTabQueue` に `addOpenTabs` 関数を追加し、ポップアップの新ボタンから `QUEUE_ADD_OPEN_TABS` を送信。
- ポップアップ `ControlButtons` に「全タブをキューへ」ボタンを追加し、処理結果（追加／スキップ件数）をユーザーに通知。
- 既存連続読み上げフロー（`processNext` と `handlePlaybackEnd`）を活用し動作検証する。

## 生成AIの学習用コンテキスト
### TypeScript
- src/background/service.ts
- src/background/tabManager.ts
- src/background/openTabsQueue.ts (新規予定)
- src/background/domainIgnoreService.ts (新規予定)
- src/shared/messages.ts
- src/shared/types/queue.ts
- src/shared/utils/storage.ts
- src/popup/hooks/useTabQueue.ts
- src/popup/components/ControlButtons.tsx
- src/popup/components/IgnoreListManager.tsx
  - Optional: 除外ドメイン管理UIの現状把握
- src/background/__tests__/backgroundService.test.ts
- src/background/__tests__/tabManager.*.test.ts
- src/popup/hooks/__tests__/useTabQueue.test.tsx

## Process
### process1 コマンドとサービス抽象の追加
#### sub1 Queueコマンド拡張とサービス層追加
@target: src/shared/messages.ts
@ref: src/background/service.ts
- [ ] `QueueCommandMessage` に `QUEUE_ADD_OPEN_TABS` を追加し、型定義とバリデーションを更新
  - Optional: 既存テスト (`src/shared/__tests__/types.test.ts`) を更新
- [ ] `OpenTabsQueueService` を作成し、タブ収集・フィルタ・TabInfo変換を実装
- [ ] `DomainIgnoreService` を作成し、永続ドメインとオーバーライドのマージ機能を提供
- [ ] 型チェックとユニットテストを実行し、動作を検証する

### process2 TabManagerのバルク投入対応
#### sub1 addTabsBulkの実装
@target: src/background/tabManager.ts
@ref: src/background/tabManager.ts
- [ ] `addTabsBulk` を追加し、既存 `addTab` を内部委譲するようリファクタ
- [ ] 永続化と `emitStatus` をバッチ向けに最適化（呼び出し回数削減）
- [ ] DomainIgnoreService の判定を利用して `isIgnored` を設定
- [ ] 型チェックとユニットテストを実行し、動作を検証する

### process3 背景オーケストレーターの対応
#### sub1 コマンド処理委譲
@target: src/background/service.ts
@ref: src/background/service.ts
- [ ] `processCommand` に `QUEUE_ADD_OPEN_TABS` を追加し、OpenTabsQueueService へ委譲
- [ ] 処理結果（追加数・除外数）を `QUEUE_COMMAND_RESULT` として返却
- [ ] 型チェックとユニットテストを実行し、動作を検証する

### process4 Popup UI / Hook 拡張
#### sub1 useTabQueueとUI更新
@target: src/popup/hooks/useTabQueue.ts
@ref: src/popup/components/ControlButtons.tsx
- [ ] `addOpenTabs` メソッドを追加し、`QUEUE_ADD_OPEN_TABS` を送信
- [ ] 結果のコマンドレスポンスを受けてトースト／メッセージ表示を実装
- [ ] `ControlButtons` に「全タブキュー投入」トリガーを追加
- [ ] 型チェックとユニットテストを実行し、動作を検証する

### process5 ドメイン除外オーバーライド準備
#### sub1 IgnoreListManager連携の検討
@target: src/popup/components/IgnoreListManager.tsx
@ref: src/popup/components/IgnoreListManager.tsx
- [ ] 今回は変更不要だが、DomainIgnoreService のAPI公開内容を整理してコメントを追加
- [ ] 型チェックとユニットテストを実行し、動作を検証する

### process10 ユニットテスト
- [ ] `OpenTabsQueueService` の単体テスト（タブフィルタ／除外判定／バルク出力）
- [ ] `TabManager.addTabsBulk` のテストで persist／emit 呼び出し回数と `autoStart` を検証
- [ ] 背景コマンド経路の結合テスト（`QUEUE_ADD_OPEN_TABS` → TabManager）
- [ ] `useTabQueue` 新関数のフックテスト更新

### process50 フォローアップ
{{実装後に仕様変更などが発生した場合は、ここにProcessを追加する}}

### process100 リファクタリング
- [ ] DomainIgnoreService 適用後に既存 `TabManager` 内 `ignoredDomains` プロパティの整理と旧ロジックの削除

### process200 ドキュメンテーション
- [ ] README または `PLAN.md` に全タブ一括投入機能と利用方法を追記

## 調査サマリ
- 背景サービスは `BackgroundOrchestrator` がキュー操作コマンドを受け取り、実処理は `TabManager` が担っている（`src/background/service.ts:168`, `src/background/tabManager.ts:206`）。
- `TabManager` は `ignoredDomains` を同期ストレージからロードしてURLごとに `isIgnored` フラグを設定している（`src/background/tabManager.ts:104`, `src/shared/utils/storage.ts:83`）。
- 連続読み上げは `processNext` と `handlePlaybackEnd` で既に実現済み（`src/background/tabManager.ts:311`, `src/background/tabManager.ts:650`）。
- 現状キュー追加は単一タブ想定の `addTab` のみであり、複数タブ追加には persist/emit の呼び出し最適化が必要。
- UI 側には除外ドメイン管理コンポーネント (`IgnoreListManager`) があり、今後のテキストエリア入力に流用できる。今回の設計は DomainIgnoreService による判定抽象化で柔軟性を確保する。

