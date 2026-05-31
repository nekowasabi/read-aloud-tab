# Process 4: ポップアップ UI ループトグル

## Implementation Brief（コピペ用）

- **背景**: 複数タブ読み上げキューをループ再生する機能を popup UI に公開する。background 側の loopEnabled 管理（QUEUE_SET_LOOP ハンドラ・QueueStatusPayload への loopEnabled 追記）は Process 03 で完了済み。
- **目的**: ユーザーがポップアップのトグルボタンで loopEnabled を ON/OFF し、background へ QUEUE_SET_LOOP を送出できるようにする。UI は background 状態（SSOT）を QueueStatusPayload 経由で購読して同期表示する。
- **変更範囲**: src/popup 配下のみ。background・content・shared の実装には手を加えない。
- **参照する定数（定数名のみ・数値リテラル禁止）**: `QUEUE_SET_LOOP`（メッセージタイプ）
- **禁止事項**:
  - loopEnabled を UI 側（localStorage・chrome.storage 等）で独自に永続化しない（background が SSOT）
  - 数値リテラルを定数として直書きしない
  - 変更範囲外（background・shared・content）に手を加えない
- **出力順序**: 1) 実装 2) セルフレビュー 3) 修正 4) 再レビュー 5) ドキュメント更新確認 6) 品質ゲート

---

## Overview

popup に loopEnabled の ON/OFF トグルボタンを追加し、クリック時に `QUEUE_SET_LOOP` メッセージを background へ送出する。`QueueStatusPayload.loopEnabled` を購読して現在状態をトグルに反映する。MVP 最小実装として、トグルの見た目・ラベル・配置は実装者の判断に委ねる（Behavior Specification で定めた動作仕様のみ必須）。

---

## Affected Files

| # | ファイル | 変更内容 |
|---|---------|---------|
| 1 | `src/popup/hooks/tabQueue/useQueueCommands.ts` | `useQueueCommands`（L34-90）に `setLoop` コマンド関数を追加 |
| 2 | `src/popup/components/ControlButtons.tsx` | `ControlButtons`（L11-49）にループトグルボタンを追加 |
| 3 | `src/popup/components/App.tsx` | `const { state: queueState, setLoop, ... } = useTabQueue();` を取得し、`queueState.loopEnabled` と `setLoop` を `ControlButtons` へ props 追加で渡す（setLoop は書き込み側コマンドのため配線必須） |
| 4 | `src/popup/hooks/useTabQueue.ts` | `UseTabQueueResult` に `setLoop: (enabled: boolean) => Promise<void>` を公開（useQueueCommands の setLoop を `...commands` スプレッド経由で露出させるが、型に明示追加しないと App.tsx で分割代入できないため型追加が必須） |
| 5 | `src/popup/hooks/tabQueue/queueMessageReducer.ts` | `loopEnabled` は QueueStatusPayload 経由で自動流入（**変更不要**・参照のみ） |

---

## Symbol Targets

```
- file: src/popup/hooks/tabQueue/useQueueCommands.ts
  symbols: useQueueCommands (function, L34-90)
  patch_only: true
  disjoint_guarantee: true  # popup 配下のみ

- file: src/popup/components/ControlButtons.tsx
  symbols: ControlButtons (component, L11-49)
  patch_only: true
  disjoint_guarantee: true  # popup 配下のみ
  pre_flight_checks:
    - popup → bg は useQueuePort.sendCommand(postMessage) 経由であることを確認
```

---

## Implementation Notes

1. **`useQueueCommands` に `setLoop` を追加**
   - `sendCommand({ type: 'QUEUE_SET_LOOP', payload: { enabled } })` を発行する関数を追加する。
   - 既存コマンド関数（play/pause/stop 等）の命名・実装パターンに完全に倣う。

2. **`ControlButtons` にトグルを追加**
   - 現在の `loopEnabled` を props で受け取り、`onClick` で `setLoop(!loopEnabled)` を呼ぶ。
   - トグルの見た目（ボタン／スイッチ／チェックボックス）・ラベル文言・配置は実装者が既存 UI の流儀を踏襲して決定する。

3. **`loopEnabled` / `setLoop` の配線**
   - `loopEnabled` は `QueueStatusPayload` に乗り、`queueMessageReducer` → state に流入する（読み取り側）。
   - `setLoop` は `useQueueCommands` で実装し、`useTabQueue` の `UseTabQueueResult` に明示追加して露出させる（書き込み側コマンドのため配線必須・参照のみでは不可）。
   - 配線連鎖: useQueueCommands.ts に `setLoop` 追加 → useTabQueue.ts の `UseTabQueueResult` へ明示追加 → `src/popup/components/App.tsx` で `const { state: queueState, setLoop, ... } = useTabQueue();` と分割代入 → `ControlButtons` へ `queueState.loopEnabled` と `setLoop` を props で渡す。

4. **アクセシビリティ**
   - `aria-pressed`（ボタン型の場合）または適切な `aria-checked`（チェックボックス型の場合）を付与する。
   - `aria-label` を付与してスクリーンリーダーで意味が伝わるようにする。

---

## Behavior Specification

**behavior_scope**: true  
**system_type**: reactive

### 状態遷移表

| 現状態 | イベント | ガード | 次状態 | 事後条件 |
|--------|---------|--------|--------|---------|
| toggle=OFF 表示 | click | — | toggle=ON 送出中 | `QUEUE_SET_LOOP { enabled: true }` を送出 |
| toggle=ON 表示 | click | — | toggle=OFF 送出中 | `QUEUE_SET_LOOP { enabled: false }` を送出 |
| 任意 | `QueueStatusPayload` 受信 | `loopEnabled` を含む | 表示 = `payload.loopEnabled` | 表示が background 状態に同期する |

### Correctness Criteria

- [ ] click で `QUEUE_SET_LOOP` が正しい `enabled` 値で送出される
- [ ] `QueueStatusPayload` の `loopEnabled` でトグル表示が同期する

### Left to Implementation

- トグルの見た目（ボタン／スイッチ／チェックボックス）
- ラベル文言
- 配置（既存ボタン群との並び順）

---

## Frontend Constraints

| 項目 | 内容 |
|------|------|
| AbortController | 不要（`postMessage` 単発、fetch なし） |
| cleanup 必須対象 | なし（`sendCommand` は既存 port のラッパ、新規 listener 追加なし） |
| state リセット条件 | なし（`loopEnabled` は background が SSOT、UI は表示のみ） |
| エラー時の表示 | 既存の `sendCommand` エラー処理に準拠（独自表示は追加しない） |

---

## Red Phase: テスト作成と失敗確認

- [ ] `src/popup/hooks/tabQueue/__tests__/useQueueCommands.test.ts`
  - [ ] `setLoop(true)` が `sendCommand` に `{ type: 'QUEUE_SET_LOOP', payload: { enabled: true } }` を渡すことを検証
  - [ ] `setLoop(false)` が `sendCommand` に `{ type: 'QUEUE_SET_LOOP', payload: { enabled: false } }` を渡すことを検証
- [ ] `src/popup/components/__tests__/ControlButtons.test.tsx`（または `CommonComponents.test.tsx`）
  - [ ] `loopEnabled=false` でトグルが OFF 表示になることを検証
  - [ ] `loopEnabled=true` でトグルが ON 表示になることを検証
  - [ ] トグルをクリックすると `setLoop(!loopEnabled)` が呼ばれることを検証
  - [ ] `aria-pressed`（または `aria-checked`）が `loopEnabled` と一致することを検証
- [ ] テストがすべて Red（失敗）であることを確認

---

## Green Phase: 最小実装と成功確認

- [ ] `useQueueCommands` に `setLoop(enabled: boolean)` を追加
- [ ] `ControlButtons` にループトグルを追加（`loopEnabled` props + `setLoop` props）
- [ ] `useTabQueue` の `UseTabQueueResult` に `setLoop: (enabled: boolean) => Promise<void>` を明示追加
- [ ] `src/popup/components/App.tsx` で `queueState.loopEnabled` と `setLoop` を `useTabQueue()` から取得し `ControlButtons` へ配線
- [ ] `aria-pressed` または `aria-checked` と `aria-label` を付与
- [ ] `npm run typecheck` が通過
- [ ] `npm run lint` が通過
- [ ] すべてのテストが Green（成功）であることを確認

---

## Refactor Phase: 品質改善

- [ ] 既存ボタンのスタイル・命名・パターンと整合しているか確認
- [ ] `setLoop` の型注釈が既存コマンド関数と統一されているか確認
- [ ] 不要なコメント・デッドコードがないか確認
- [ ] テストが引き続き Green であることを確認

---

## Manual Verification

- [ ] トグルを ON にして再生開始 → キューの最後まで到達後に先頭から再生が周回することを確認
- [ ] トグルを OFF にして再生 → キュー末尾で停止することを確認
- [ ] popup を閉じて再度開いた後 → background 状態（`loopEnabled`）が正しくトグルに反映されることを確認

---

## Dependencies

- **Requires**: Process 03（`QUEUE_SET_LOOP` メッセージハンドラ・`QueueStatusPayload.loopEnabled` の追加）
- **Blocks**: Process 200
