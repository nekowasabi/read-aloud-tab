# title: ポップアップ読み上げキューのリセットボタン追加

## 概要
- ポップアップUIから読み上げキュー全体を一括クリアできる操作を追加し、現在再生中の状態も安全に停止させます。

### goal
- ユーザーがキューに溜まったタブをワンクリックでリセットし、すぐに新しい読み上げセッションを開始できるようにする。

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること

## 開発のゴール
- ポップアップに「リセット」ボタンを配置し、押下で全タブを削除・再生を停止するキュークリア処理を呼び出せるようにする。
- キュークリア時にバックグラウンド側で状態を永続化し、ステータス更新がポップアップへ即時反映されること。
- 操作失敗時は既存のエラーハンドリングに沿ってユーザーへ通知する。

## 実装仕様
- shared メッセージ定義に `QUEUE_CLEAR` コマンドを追加し、型ガードへ反映する。
- TabManager に `clearQueue()` を実装し、現在の読み上げを停止しつつタブ配列・インデックスを初期化、永続化とステータス通知を行う。
- BackgroundOrchestrator (`service.ts`) の `processCommand` で `QUEUE_CLEAR` をハンドリングし、TabManager の新メソッドを呼び出す。
- ポップアップの `useTabQueue` フックで `clearQueue()` を公開し、ポート経由で新コマンドを送信する。
- `TabQueueList` にリセットボタンを追加し、キューが空の場合は非アクティブにする。
- `App.tsx` でリセットハンドラを定義し、エラー表示ロジックに統合する。

## 生成AIの学習用コンテキスト
### shared messages
- `src/shared/messages.ts`
  - `QueueCommandMessage` 型と `isQueueCommandMessage` ガードを拡張する。

### background logic
- `src/background/tabManager.ts`
  - キュー状態管理ロジックへ全消去処理を追加する。
- `src/background/service.ts`
  - `processCommand` の分岐を調整して新コマンドを処理する。

### popup ui
- `src/popup/hooks/useTabQueue.ts`
  - ポート送信メソッド群にクリア機能を追加する。
- `src/popup/components/TabQueueList.tsx`
  - ボタンUIとプロップ追加を行う。
- `src/popup/components/App.tsx`
  - リセットボタンのハンドラとエラー処理の統合。

### tests
- `src/background/__tests__/backgroundService.test.ts`
  - コマンド処理の回帰テストを追加する。
- `src/popup/components/__tests__/TabQueueList.test.tsx`
  - クリックで `onResetQueue` が発火するか確認する（存在すれば）。

## Process
### process1 sharedメッセージ定義にQUEUE_CLEARを追加
#### sub1 Command型とガードの更新
@target: src/shared/messages.ts
@ref: なし
- [ ] `QueueCommandMessage` に `{ type: 'QUEUE_CLEAR' }` を追加し、`isQueueCommandMessage` の分岐を更新する。

### process2 TabManagerへclearQueueを実装
#### sub1 メソッド本体の追加
@target: src/background/tabManager.ts
@ref: src/background/tabManager.ts
- [ ] `clearQueue()` を追加し、再生停止・配列初期化・永続化・ステータス通知を行う。
  - Optional: 進捗マップや再生トークンのリセットを確認する。

#### sub2 既存ロジックとの整合
@target: src/background/tabManager.ts
@ref: 既存の `removeTab`, `stopInternal`
- [ ] `stopInternal(true)` を再利用し副作用が重複しないことを確かめる。

### process3 BackgroundOrchestratorでQUEUE_CLEARを処理
#### sub1 processCommandの分岐追加
@target: src/background/service.ts
@ref: src/background/service.ts
- [ ] `case 'QUEUE_CLEAR'` を追加し、TabManager.clearQueue() をawaitする。

### process4 ポップアップフックにclearQueue APIを追加
#### sub1 フック返り値拡張
@target: src/popup/hooks/useTabQueue.ts
@ref: 既存の sendCommand
- [ ] `clearQueue` 関数を追加し、`sendCommand({ type: 'QUEUE_CLEAR' })` を返す。
- [ ] `UseTabQueueResult` に `clearQueue` を追加し、呼び出し元へ渡す。

### process5 UIコンポーネントへリセットボタンを組み込み
#### sub1 TabQueueListプロップとボタン追加
@target: src/popup/components/TabQueueList.tsx
@ref: src/popup/components/common/ListCard.tsx
- [ ] `onResetQueue` プロップを追加し、`actions` 配列にリセットボタンを挿入する。
- [ ] キューが空のとき `disabled` にする。

#### sub2 App.tsxでハンドラ実装
@target: src/popup/components/App.tsx
@ref: src/popup/hooks/useTabQueue.ts
- [ ] `handleResetQueue` を実装し、`clearQueue()` をawait・エラーを既存ロジックで通知。
- [ ] `TabQueueList` 呼び出しに `onResetQueue` を渡す。

### process10 ユニットテスト
- [ ] `src/background/__tests__/backgroundService.test.ts` に `QUEUE_CLEAR` 送信時の動作を追加（TabManager.clearQueue呼び出しを検証）。
- [ ] `src/background/__tests__/tabManager.test.ts` に `clearQueue()` の挙動テストを追加（状態リセット・persist呼び出しなど）。
- [ ] フロント側テスト（存在すれば）でリセットボタンクリックがコールバックを呼ぶことを確認。

### process50 フォローアップ
- 仕様変更や他UIへの波及が必要になった場合はここに追記。

### process100 リファクタリング
- 必要に応じて TabQueueList のアクション生成を共通化する余地を検討。

### process200 ドキュメンテーション
- [ ] README または AGENTS.md にキューリセット操作を追記するか検討し、必要なら更新。



