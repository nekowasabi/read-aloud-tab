# Process 01: 設定・保留タブ永続化契約

## 生成情報

- task_id: `T-20260827-auto-queue-new-tabs`
- process_id: `P01`
- 対象: 自動キュー設定と、URL確定待ちタブIDの保存・読込契約
- 再生成条件: 定数、ゲート、横断方針、または本Processの外部挙動を変更した場合
- 人間向け付録: `plan-auto-queue-new-tabs/process-01.appendix.md`
- 実行時に他の計画書・Process・付録を読む必要はない

## Implementation Brief

以下の契約を満たす実装とテストを、Red → Green → Refactor の順で行う。

1. `STORAGE_KEYS` に `AUTO_QUEUE_NEW_TABS_KEY` と `PENDING_AUTO_QUEUE_TAB_IDS_KEY` の値を追加する。
2. `DEFAULT_AUTO_QUEUE_NEW_TABS` を追加し、自動追加設定の初期値をオフにする。
3. `StorageManager` に設定の getter/setter を追加する。設定は `storage.sync` に保存し、読込障害または不正・欠損値は `false` に倒す。書込障害は握りつぶさず再送出する。
4. 保留タブIDの getter/setter を `storage.local` に追加する。値は重複を除いた `number[]` とし、読込障害・不正値は `[]` に倒す。書込障害は再送出する。
5. 既存のブラウザー抽象化、例外ログ、Jestモックの流儀を再利用し、依存追加・スキーマ移行・起動時cleanupは行わない。

### 横断方針

- 変更範囲は下記の対象ファイルと指定シンボルに限定する。
- 設定の欠損・ストレージ読込障害は fail-closed（自動追加を無効）にする。
- 保留IDの欠損・ストレージ読込障害は fail-closed（保留なし）にする。
- ストレージ書込障害は呼び出し元が扱えるよう `throw` する。
- IDは有限な数値だけを採用し、重複は保存前または返却前に除去する。順序は最初の出現順を維持する。
- `storage.sync` は設定、`storage.local` は一時的な保留タブIDに使用する。
- 起動時cleanup、`tabs.onCreated`、`tabs.onUpdated`、設定画面、エクスポート／インポートの接続は本Processの対象外で、後続Processがこの契約を利用する。

## ローカル定数（生成時転記）

| 定数名 | 値 | 単位 | 用途 |
|---|---|---|---|
| `AUTO_QUEUE_NEW_TABS_KEY` | `'autoQueueNewTabs'` | storage key | 自動キュー設定のキー |
| `PENDING_AUTO_QUEUE_TAB_IDS_KEY` | `'pendingAutoQueueTabIds'` | storage key | URL確定待ちタブIDのキー |
| `DEFAULT_AUTO_QUEUE_NEW_TABS` | `false` | boolean | 設定欠損時・読込障害時の既定値 |

## File / Line / Symbol Targets

| ファイル | 現行行 | Symbol Targets | 変更内容 |
|---|---:|---|---|
| `src/shared/types/index.ts` | 29–37 | `STORAGE_KEYS` | 2キーを追加 |
| `src/shared/constants.ts` | 124–132 | queue loop constants付近 | `DEFAULT_AUTO_QUEUE_NEW_TABS` を追加 |
| `src/shared/utils/storage.ts` | 1–165 | `StorageManager` | getter/setterを追加、設定のfail-closedと書込throw |
| `src/shared/utils/storage.ts` | 176–249 | queue storage functions付近 | pending IDのlocal getter/setterを追加 |
| `src/shared/utils/__tests__/storage.test.ts` | 1–238, 420– | storage mocks、キー互換性、StorageManagerテスト | Red/Greenテストを追加 |

## Symbol Targets

- `src/shared/types/index.ts:STORAGE_KEYS`
- `src/shared/constants.ts:DEFAULT_AUTO_QUEUE_NEW_TABS`
- `src/shared/utils/storage.ts:StorageManager.getAutoQueueNewTabs`
- `src/shared/utils/storage.ts:StorageManager.setAutoQueueNewTabs`
- `src/shared/utils/storage.ts:getPendingAutoQueueTabIds`
- `src/shared/utils/storage.ts:setPendingAutoQueueTabIds`
- `src/shared/utils/__tests__/storage.test.ts:Storage contract tests`

## Behavior Specification

### Transformation: 自動キュー設定

| pre_state / input | output | post_state |
|---|---|---|
| `sync[autoQueueNewTabs] = true` | getter → `true` | 変更なし |
| 値が欠損、`false`、またはboolean以外 | getter → `false` | 変更なし |
| `sync.get` がreject | getter → `false` | 変更なし |
| setterにboolean `enabled` | `sync.set({ autoQueueNewTabs: enabled })` が成功 | 保存値が `enabled` |
| `sync.set` がreject | setter → 同じ例外をthrow | 保存成否はブラウザーAPIに従う |

### Transformation: 保留タブID

| pre_state / input | output | post_state |
|---|---|---|
| local値が `[3, 3, 8]` | getter → `[3, 8]` | 変更なし |
| local値が欠損・不正・有限数でない要素を含む | getter → `[]` | 変更なし |
| `local.get` がreject | getter → `[]` | 変更なし |
| setter入力 `[3, 3, 8]` | `local.set({ pendingAutoQueueTabIds: [3, 8] })` が成功 | 保存値が重複排除済み配列 |
| setter入力が空配列 | `local.set({ pendingAutoQueueTabIds: [] })` が成功 | 保存値が空配列 |
| `local.set` がreject | setter → 同じ例外をthrow | 保存成否はブラウザーAPIに従う |

### Completion Criteria (Gherkin)

Feature: 自動キュー設定と保留タブIDの永続化

```gherkin
Scenario: 設定の欠損または読込障害をオフとして扱う
  Given sync に自動キュー設定がない、または取得が失敗する
  When getAutoQueueNewTabs を呼び出す
  Then 戻り値は false である

Scenario: 保留タブIDを重複なく保存する
  Given 保留タブID [3, 3, 8] を保存する
  When setPendingAutoQueueTabIds を呼び出す
  Then local には [3, 8] が保存される
  And 読み出し値も [3, 8] である

Scenario: 書込障害を呼び出し元へ伝える
  Given sync または local の set が失敗する
  When 対応する setter を呼び出す
  Then setter は失敗した例外をthrowする
```

## QA観点表（6技法）

| 技法 | 観点 | ケース |
|---|---|---|
| 同値分割 | boolean設定 | `true`、`false`、欠損、文字列／数値 |
| 境界値 | ID配列 | `[]`、1件、重複のみ、負数、`NaN`、`Infinity` |
| 決定表 | storage結果 | 成功値、欠損、不正値、get例外、set例外 |
| 状態遷移 | 保留ID | 未保存 → 保存済み → 重複排除読込 → 空配列保存 |
| ペアワイズ | 設定領域×結果 | sync/local と成功／欠損／例外の組合せ |
| エラー推測 | 互換性・障害 | キー誤り、旧データ型、API reject、setterの例外握りつぶし |

## TDD実行手順

### Red

`storage.test.ts` にキー値、設定getter/setter、pending getter/setter、重複排除、fail-closed、書込throwのテストを追加する。実装前に対象テストだけを実行し、未定義シンボルまたは期待値不一致による失敗であることを確認する。

### Green

指定された4ファイルだけを変更し、既存パターンに沿う最小実装で対象テストを通す。設定は `BrowserAdapter.getInstance().storage.sync`、pendingは既存の `chrome.storage.local` を使う。

### Refactor

対象テストと既存ストレージテストを再実行し、重複処理・型判定・ログ・例外再送出が既存規約に収まり、対象外ファイルに差分がないことを確認する。機能追加やAPI変更は行わない。

## Verification Gates

列順は `gate_id / phase / type / executor / required / command / input_scope / pass_criteria / evidence_spec / failure_policy / criterion_refs / policy_refs` の12列とする。

| gate_id | phase | type | executor | required | command | input_scope | pass_criteria | evidence_spec | failure_policy | criterion_refs | policy_refs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P01-VG-01 | Red | test | agent | true | `npx jest src/shared/utils/__tests__/storage.test.ts --runInBand` | P01対象テスト | 対象追加テストが未実装シンボルまたは期待値不一致で失敗し、構文・import・環境エラーではない | 失敗テスト名と失敗理由を逐語記録 | failure_class=test_red_unexpected / retryable=true / retry_budget_source=task_retry_budget / terminal_action=escalate_plan_repair | BEH-01,BEH-02,BEH-03 | TEST-RED,SCOPE-01 |
| P01-VG-02 | Green | test | agent | true | `npx jest src/shared/utils/__tests__/storage.test.ts --runInBand` | P01対象テスト＋既存storage.test.ts | 終了コード0、対象テスト全件成功、fail-closed・重複排除・書込throwを確認 | Jestの成功サマリと対象ケース名を記録 | failure_class=test_green_failure / retryable=true / retry_budget_source=task_retry_budget / terminal_action=await_input | BEH-01,BEH-02,BEH-03 | TEST-GREEN,SCOPE-01 |
| P01-VG-03 | Refactor | quality | agent | true | `npm run typecheck && npm run lint && npx jest src/shared/utils/__tests__/storage.test.ts --runInBand && git diff --check` | P01変更差分と関連テスト | 全コマンド終了コード0、lint/typecheck成功、差分空白エラーなし、対象外ファイル変更なし | 各コマンドの終了コード、`git diff --name-only`、差分チェック結果を記録 | failure_class=quality_regression / retryable=true / retry_budget_source=task_retry_budget / terminal_action=await_input | SC-01,SC-02 | QUALITY-01,SCOPE-01,DONT-01 |

### GoalEvidence

各ゲート実行後、観測出力を引用して次の形式で記録する。未実行または引用不能は `unverified` とする。

```text
✅ Phase Complete
- gate_id: P01-VG-01 | P01-VG-02 | P01-VG-03
- status: pass | fail | unverified
- command_or_action: 実行コマンド
- exit_code: 数値または n/a
- expected: 期待する終了コード・失敗理由・観測値
- observed: 実行結果からの逐語引用1行
- attempt: 実行回数
```

## Manual Verification

自動テスト後、拡張機能の開発者コンソールで `StorageManager` の設定 getter/setter と pending getter/setter を呼び、ブラウザーの拡張機能ストレージで sync に `autoQueueNewTabs`、local に `pendingAutoQueueTabIds` が保存されることを確認する。setterを一時的にrejectするテストモックでは、呼び出しが例外を返すことを確認する。

## 依存関係

- 入力依存: 既存の `STORAGE_KEYS`、`BrowserAdapter`、`chrome.storage.local`、Jestモック構成。
- 後続依存: P02（設定画面）、P03（起動時cleanup）、タブイベント接続Process、設定エクスポート／インポートProcess。
- 本Processは後続Processの実装を変更せず、契約とテストを提供する。

## Acceptance / Completion

- 2つのstorage keyと既定値が指定値である。
- 設定getterは障害時を含め `false`、pending getterは障害時を含め `[]` を返す。
- pendingは重複排除済みのnumber配列として保存・返却される。
- 全setterは書込障害をthrowする。
- `P01-VG-01` → `P01-VG-02` → `P01-VG-03` の順に証拠が揃う。
