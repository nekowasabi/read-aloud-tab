# Process 3: QUEUE_SET_LOOP メッセージ経路 + コマンドルーティング

## Implementation Brief（コピペ用）

- **背景**: popup から loopEnabled を切り替える際、`QUEUE_UPDATE_SETTINGS` は `validateSettings` でフィールドが除去されるため使用不可。専用コマンド `QUEUE_SET_LOOP` の新設が必須。
- **目的**: popup → background 間の loopEnabled 切り替え専用メッセージ経路を確立し、`TabManager.setLoopEnabled` へ正確に配線する。
- **変更範囲**: `src/shared/messages.ts` / `src/background/runtimeCommandRouter.ts` / `src/background/service.ts` の3ファイルのみ（薄いパススルー）。
- **参照する定数**: `QUEUE_SET_LOOP`（コマンド type 文字列）、既存定数はそのまま参照。数値リテラル禁止。
- **禁止事項（PLAN.md Don'ts 該当）**:
  - `loopEnabled` を `TTSSettings` / `QUEUE_UPDATE_SETTINGS` 経由で運ぶこと
  - `validateSettings` の変更
  - 実挙動（ループ状態保持・broadcast）の実装（Process 02 / Process 04 の責務）
- **出力順序**: 1) 実装 2) セルフレビュー 3) 修正 4) 再レビュー 5) ドキュメント更新確認 6) 品質ゲート

---

## Overview

popup から loopEnabled を切り替える専用コマンド `QUEUE_SET_LOOP` を新設し、background の `setLoopEnabled` へ配線するメッセージ経路を構築する。

- `messages.ts`: 型定義・型ガードの拡張
- `runtimeCommandRouter.ts`: ルーティング処理の追加
- `service.ts`: 既存ルータ生成への配線追加（1行追加レベル）

本 Process は **メッセージ配線のみ**を担う。実際のループ状態保持は Process 02、UI 操作は Process 04 で仕様化する。

---

## Affected Files

| # | ファイルパス | 変更内容 |
|---|-------------|---------|
| 1 | `src/shared/messages.ts` | `QueueCommandMessage` union に `QUEUE_SET_LOOP` 追加（L69-79）/ `QueueStatusPayload` に `loopEnabled?: boolean` 追加（L80-88）/ `isQueueCommandMessage` 許可 type 集合に追加（L159-184） |
| 2 | `src/background/runtimeCommandRouter.ts` | `RuntimeCommandRouterTabManager` interface に `setLoopEnabled` 追加（L15-21）/ `createRuntimeCommandRouter` の switch に case 追加（L33-72） |
| 3 | `src/background/service.ts` | `createRuntimeCommandRouter` 呼出（L142-148）に `setLoopEnabled` を dep として配線 |

---

## Symbol Targets

```yaml
- file: src/shared/messages.ts
  symbols:
    - QueueCommandMessage (L69-79)
    - QueueStatusPayload (L80-88)
    - isQueueCommandMessage (L159-184)
  patch_only: true
  disjoint_guarantee: true

- file: src/background/runtimeCommandRouter.ts
  symbols:
    - createRuntimeCommandRouter (L33-72)
    - RuntimeCommandRouterTabManager (L15-21)
  patch_only: true
  disjoint_guarantee: true
  pre_flight_checks:
    - QUEUE_UPDATE_SETTINGS が validateSettings でフィールド除去する事実の確認

- file: src/background/service.ts
  symbols:
    - createRuntimeCommandRouter 呼出 (L142-148)
  patch_only: true
  disjoint_guarantee: true
```

---

## Implementation Notes

### 1. `src/shared/messages.ts`

- `QueueCommandMessage` union に以下を追加:
  ```typescript
  | { type: 'QUEUE_SET_LOOP'; payload: { enabled: boolean } }
  ```
- `QueueStatusPayload`（`messages.ts`）に以下を追加:
  ```typescript
  loopEnabled?: boolean;
  ```
  （UI が status 配信を購読して現在のループ状態を表示するために必要。実値の付与は Process 02 の `createStatusPayload` が `loopEnabled: this.queue.loopEnabled ?? DEFAULT_LOOP_ENABLED` で行い、`emitStatus()` で配信する）
- `isQueueCommandMessage` の許可 type 集合に `'QUEUE_SET_LOOP'` を追加し、`payload.enabled` の boolean 型ガードも追加。

### 2. `src/background/runtimeCommandRouter.ts`

- `RuntimeCommandRouterTabManager` interface に以下を追加:
  ```typescript
  setLoopEnabled(enabled: boolean): void;
  ```
  （または `Promise<void>` — 既存メソッドの戻り値型に合わせる）
- `createRuntimeCommandRouter` の switch 文に以下を追加:
  ```typescript
  case 'QUEUE_SET_LOOP':
    tabManager.setLoopEnabled(message.payload.enabled);
    break;
  ```
- 配信経路（Process 02 と整合）: `QUEUE_SET_LOOP` 受信 → runtimeCommandRouter（`createRuntimeCommandRouter`）が `tabManager.setLoopEnabled(enabled)` を呼ぶ → `setLoopEnabled` 内の `emitStatus()` が `QueueStatusPayload`（`loopEnabled` を含む）を status listener 経由で配信する。runtimeCommandRouter 自身は broadcast を直接呼ばず `setLoopEnabled` に委譲するだけ。

### 3. `src/background/service.ts`

- ルータ生成時の依存注入に `setLoopEnabled` を追加（既存配線への 1 行追加）:
  ```typescript
  setLoopEnabled: tabManager.setLoopEnabled.bind(tabManager),
  ```

---

## Behavior Specification

**behavior_scope: false**

本 Process はメッセージ配線のみを担い、観測可能な状態変換を持たない。

- `QUEUE_SET_LOOP` メッセージが router に到達した場合、`tabManager.setLoopEnabled(payload.enabled)` が呼ばれること（router は委譲のみ・broadcast 直呼びはしない）
- 状態変換（ループ状態の保持・`setLoopEnabled` 内 `emitStatus()` による `QueueStatusPayload` 配信）は Process 02 / Process 04 で仕様化

---

## Red Phase: テスト作成と失敗確認

- [ ] `src/background/__tests__/runtimeCommandRouter.test.ts`（既存）に `QUEUE_SET_LOOP` ルーティングのテストケースを追加
  - [ ] `setLoopEnabled` モックが `enabled: true` で呼ばれることを検証
  - [ ] `setLoopEnabled` モックが `enabled: false` で呼ばれることを検証
- [ ] `isQueueCommandMessage` の型ガードテスト（`src/shared/__tests__/messages.test.ts` が存在する場合）に `QUEUE_SET_LOOP` ケースを追加
- [ ] `npm run test` を実行し、追加テストが **RED（失敗）** であることを確認

---

## Green Phase: 最小実装と成功確認

- [ ] `src/shared/messages.ts`: `QueueCommandMessage` union に `QUEUE_SET_LOOP` 追加
- [ ] `src/shared/messages.ts`: `QueueStatusPayload` に `loopEnabled?: boolean` 追加
- [ ] `src/shared/messages.ts`: `isQueueCommandMessage` に `'QUEUE_SET_LOOP'` case 追加 + payload 型ガード
- [ ] `src/background/runtimeCommandRouter.ts`: `RuntimeCommandRouterTabManager` に `setLoopEnabled` 追加
- [ ] `src/background/runtimeCommandRouter.ts`: switch に `case 'QUEUE_SET_LOOP'` 追加
- [ ] `src/background/service.ts`: `createRuntimeCommandRouter` 呼出に `setLoopEnabled` を配線
- [ ] `npm run test` を実行し、追加テストが **GREEN（成功）** であることを確認
- [ ] `npm run typecheck` を実行し、型エラーがないことを確認

---

## Refactor Phase: 品質改善

- [ ] 不要なコメント・デッドコードがないことを確認
- [ ] `isQueueCommandMessage` の型ガードが exhaustive であることを確認
- [ ] `RuntimeCommandRouterTabManager` の戻り値型が既存メソッドと一貫していることを確認
- [ ] `npm run lint` を実行しエラーがないことを確認
- [ ] `npm run test` を再実行し全テスト GREEN であることを確認

---

## Manual Verification

- [ ] Chrome 拡張をリロードし DevTools（Service Worker コンソール）を開く
- [ ] popup から loop トグルを ON/OFF 操作する
- [ ] DevTools のネットワーク or コンソールログで `QUEUE_SET_LOOP` メッセージが background に届いていることを確認
- [ ] background が `setLoopEnabled` を呼び出した後、`emitStatus()` 経由で配信される `QueueStatusPayload`（status listener に届くメッセージ）に `loopEnabled` フィールドが含まれることを確認
- [ ] `QUEUE_UPDATE_SETTINGS` メッセージに `loopEnabled` が**含まれていない**ことを確認（禁止事項の検証）

---

## Dependencies

| 種別 | Process | 理由 |
|------|---------|------|
| Requires | Process 02 | `TabManager.setLoopEnabled` メソッドが存在することが前提 |
| Blocks | Process 04 | UI 側が `QUEUE_SET_LOOP` を送信し `loopEnabled` を受信するための経路が本 Process で確立される |
