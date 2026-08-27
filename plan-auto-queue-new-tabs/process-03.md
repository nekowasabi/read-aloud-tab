# Process 03: 新規タブ自動追加の状態機械

## 生成情報

- task_id: `T-20260827-auto-queue-new-tabs`
- 依存: P01（設定契約・エクスポート／インポート契約）
- 正本: 本 core の仕様・ゲート。PLAN.md や他の process、appendix は実行時に参照しない。
- 再生成条件: 設定キー、状態遷移、ゲート、横断方針、定数を変更した場合は `/make-plan` で core と appendix を再生成する。
- 付録: `plan-auto-queue-new-tabs/process-03.appendix.md`（人間向け。実行条件ではない）

## Implementation Brief

新規ファイル `src/background/autoQueueManager.ts` を追加し、`tabs.onCreated` を起点に新規タブを一度だけキュー末尾へ追加する。設定キー `AUTO_QUEUE_NEW_TABS` が `false` または未保存なら何もしない。`pendingUrl ?? url` が通常URLなら `BackgroundOrchestrator` の既存 `isTabQueueCandidate`、`TabManager.getTabById`、`TabManager.addTab({ position: 'end', autoStart: false })` を再利用する。空・内部URLは tabId を `storage.local` の保留一覧へ保存し、後続 `onUpdated` の最初の通常URLで候補判定する。除外ドメインは保留を消費するが追加しない。URL不正・空・内部URLは保留を維持する。

変更対象は `src/background/index.ts:53-83` のイベント配線、`src/background/service.ts:954-984` の候補判定を再利用可能な境界へ公開または委譲する部分、P01 の設定・入出力契約が示す `src/shared/types.ts`、`src/shared/utils/storage.ts`、`src/options/OptionsApp.tsx` および関連フック・エクスポート／インポート実装、テスト新規 `src/background/__tests__/autoQueueManager.test.ts` と必要な `backgroundService` テストに限定する。既存の `onTabLoading` と完了時 `onTabUpdated` は維持する。

## ローカル定数（生成時転記。正本: PLAN.md の ★ Constants）

| 定数名 | 値 | 単位 | 用途 |
|---|---:|---|---|
| `AUTO_QUEUE_NEW_TABS` | `false`（未保存時） | 真偽値 | 自動追加の既定値 |
| `PENDING_AUTO_QUEUE_TAB_IDS` | `pendingAutoQueueTabIds` | storage.local キー | 保留中 tabId 配列 |
| `QUEUE_INSERT_POSITION` | `end` | 列挙値 | 自動追加位置 |
| `QUEUE_AUTO_START` | `false` | 真偽値 | 自動再生抑止 |

## Symbol Targets

- `src/background/autoQueueManager.ts:AutoQueueManager`
- `src/background/index.ts:tabs.onCreated/onUpdated/onRemoved/runtime.onStartup` 配線
- `src/background/service.ts:BackgroundOrchestrator.isTabQueueCandidate`（共有利用可能化のみ）
- `src/shared/types.ts:STORAGE_KEYS`（P01 契約との整合）
- `src/shared/utils/storage.ts:StorageManager`（フラグ・保留一覧・入出力）
- `src/options/OptionsApp.tsx` / `src/options/hooks/useOptionsData.ts`（P01 の設定 UI 契約）
- `src/background/__tests__/autoQueueManager.test.ts`
- `src/background/__tests__/*backgroundService*.test.ts`（既存更新回帰のみ）

## 横断方針

- 既存の候補判定・キュー API・保存形式を再利用し、別の URL 判定やキュー挿入実装を作らない。
- create/update/remove/設定変更/startup の全イベントは一つの Promise 列へ投入し、個別処理の失敗をログ記録して後続イベントを実行する。
- `onUpdated` は保留一覧に存在する tabId だけを自動追加処理する。既存キューの更新処理と `onTabLoading` は同一イベント内で従来どおり実行する。
- `onRemoved` では対象 tabId を削除し、runtime 起動時は保留一覧を全消去する。サービスワーカー再起動には local 保存で耐え、ブラウザセッションをまたぐ tabId 再利用は全消去で防ぐ。
- storage 読み書き・キュー追加の失敗はデータ損失を避けるため保留を勝手に消費せず、列を停止させない。
- manifest 権限、依存ライブラリ、dist は変更しない。

## Reactive Behavior Specification

### 状態

| 現状態 | イベント | 次状態 | 観測可能な結果 |
|---|---|---|---|
| 無効 | `onCreated(tab)` | 無効 | キュー・保留一覧に変化なし |
| 有効・未保留 | `onCreated` + 通常URL | 追加済み | 末尾に一度だけ追加、autoStart=false、保留なし |
| 有効・未保留 | `onCreated` + 空/内部URL | 保留 | local に tabId を保存 |
| 保留 | `onUpdated` + 通常URL・候補 | 追加済み | 末尾へ一度だけ追加、保留消費 |
| 保留 | `onUpdated` + 通常URL・除外ドメイン | 完了（未追加） | 保留消費、キュー不変 |
| 保留 | `onUpdated` + 空/内部/不正URL | 保留 | 保留維持、キュー不変 |
| 保留/追加済み | `onRemoved` | 未追跡 | 保留から削除、既存キュー処理は従来動作 |
| 任意 | 設定off | 無効 | 新規処理をせず、既存キューは変更しない |
| 任意 | `runtime.onStartup` | セッション初期化 | 保留 tabId を全消去 |
| 任意 | 内部処理失敗 | 同じ状態 | エラーを記録し、後続 Promise は実行 |

不変条件: 同一 tabId の自動追加は一回だけ、挿入位置は末尾、既存タブの順序は変えない、設定offで自動追加しない。`addTab` の既登録時挙動に依存せず、`getTabById` で事前判定する。

## 6技法QA表／デシジョン表

| 技法 | 観点 | ケース | 期待結果 |
|---|---|---|---|
| 同値分割 | 設定 | off / on | off は無処理、on は処理 |
| 境界値 | URL状態 | 空文字・`undefined`・内部URL | 保留、追加なし |
| デシジョンテーブル | 候補判定 | 通常URL×除外なし／除外あり | 追加／保留消費のみ |
| 状態遷移 | 空タブ | 保留→通常URL | 一度だけ追加して保留消費 |
| ペアワイズ | イベント競合 | create→update、update→remove、remove→update | Promise 列順に従い重複なし |
| 故障注入 | 外部失敗 | storage または addTab reject | 列継続、保留は安全側に維持 |

| 設定 | URL | 候補 | 現状態 | 結果 | 保留 |
|---|---|---|---|---|---|
| off | 任意 | 任意 | 任意 | 無処理 | 維持 |
| on | 通常 | yes | 未登録 | 末尾追加・autoStart=false | なし |
| on | 通常 | no | 保留 | 追加なし | 消費 |
| on | 空/内部/不正 | n/a | 保留 | 追加なし | 維持 |

### Completion Criteria (Gherkin)

Feature: 新規タブの自動キュー追加

```gherkin
Scenario: 通常URLの新規タブを一度だけ末尾へ追加する
  Given 自動追加設定が有効で、tabId 10 はキューに未登録である
  When onCreated に通常URLの tabId 10 が届く
  Then tabId 10 はキュー末尾に一度だけ追加され、自動再生されない

Scenario: 空タブを通常URLへの遷移時に補完する
  Given 自動追加設定が有効で、onCreated の tabId 11 が空URLとして保留されている
  When onUpdated に tabId 11 の通常URLが届く
  Then tabId 11 は候補なら一度だけ末尾へ追加され、保留一覧から消える

Scenario: 除外・不正URLの保留を正しく扱う
  Given tabId 12 が保留されている
  When 除外ドメインURLへ更新される
  Then tabId 12 は保留から消え、キューには追加されない
  And 空・内部・不正URLへの更新では保留が維持される
```

Left to Implementation: `AutoQueueManager` 内の小さなヘルパ名、Promise 列の実装方式、ログ文言、テスト用モックの分割。

## テスト計画（Red → Green → Refactor）

### Red

`autoQueueManager.test.ts` に設定off、有効通常URL、空タブ補完、除外ドメイン消費、不正URL維持、onRemoved、startup cleanup、復元、既登録順序不変、処理失敗後の列継続を追加し、実装前に対象アサーションが仕様理由で失敗することを確認する。既存 background service テストでは `onUpdated` の loading / complete 更新が変わらないことを失敗先行で固定する。

### Green

最小実装で全 Red ケースを通す。設定変更イベントは現在の値を次イベントから反映し、処理列は rejection を吸収して継続する。storage.local の配列は数値 tabId のみ受け入れ、重複を除く。

### Refactor

候補判定・タブ情報生成・保留更新の重複だけを整理し、外部挙動を変えない。型検査、対象テスト、全テスト、lint、format を実行する。

## Verification Gates

| gate_id | phase | type | executor | required | command | input_scope | pass_criteria | evidence_spec | failure_policy | criterion_refs | policy_refs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P03-VG-01 | red | test | agent | true | `npm test -- --runInBand src/background/__tests__/autoQueueManager.test.ts` | process delta | 実装前に対象 assertion が仕様理由（未実装 API/期待状態不一致）で失敗し、構文・import・環境エラーではない | Jest の失敗 assertion 1行と exit code 1 | `{failure_class: red_not_expected, retryable: true, retry_budget_source: task_retry_budget, terminal_action: escalate_plan_repair}` | BEH-03, BEH-04 | TEST-RED, SCOPE-03 |
| P03-VG-02 | green | test | agent | true | `npm test -- --runInBand src/background/__tests__/autoQueueManager.test.ts src/background/__tests__/*backgroundService*.test.ts` | process delta | 対象 Jest が exit code 0、全ケース pass、既存 loading/complete 回帰を含む | Jest summary の pass 件数と exit code 0 | `{failure_class: implementation, retryable: true, retry_budget_source: task_retry_budget, terminal_action: await_input}` | SC-03, SC-04, BEH-01, BEH-02, BEH-03, BEH-04 | TEST-GREEN, SCOPE-03, DONT-03 |
| P03-VG-03 | refactor | quality | agent | true | `npm run typecheck && npm run lint && npm run format:check` | process delta | 3 コマンドすべて exit code 0、対象外ファイルの差分なし | 各コマンドの exit code と git diff --stat | `{failure_class: quality, retryable: true, retry_budget_source: task_retry_budget, terminal_action: await_input}` | SC-05, SC-06 | QUALITY-01, SCOPE-03 |
| P03-VG-appendix-sync | verify | grep | agent | false | `rg -o '^Feature: .*' plan-auto-queue-new-tabs/process-03.md` と appendix の `### Feature:` 見出しを突合 | process-03 core と appendix | 全 Feature 名が appendix に出現 | Feature 名の一致件数 | `{failure_class: appendix_drift, retryable: true, retry_budget_source: task_retry_budget, terminal_action: warn}` | SC-07 | SCOPE-03 |

## GoalEvidence

### P03-VG-01 Red

✅ **Phase Complete**
- gate_id: P03-VG-01
- status: unverified（実装前に実行して記録）
- command_or_action: `npm test -- --runInBand src/background/__tests__/autoQueueManager.test.ts`
- exit_code: n/a
- expected: "仕様理由による assertion failure、構文/import/環境エラーではない"
- observed: "実装前の実測値を逐語引用"
- attempt: 1

### P03-VG-02 Green

✅ **Phase Complete**
- gate_id: P03-VG-02
- status: unverified（実装後に実行して記録）
- command_or_action: `npm test -- --runInBand src/background/__tests__/autoQueueManager.test.ts src/background/__tests__/*backgroundService*.test.ts`
- exit_code: n/a
- expected: "exit code 0、対象および回帰テスト全件 pass"
- observed: "実装後の Jest summary を逐語引用"
- attempt: 1

### P03-VG-03 Refactor

✅ **Phase Complete**
- gate_id: P03-VG-03
- status: unverified（実装後に実行して記録）
- command_or_action: `npm run typecheck && npm run lint && npm run format:check`
- exit_code: n/a
- expected: "3 コマンドすべて exit code 0"
- observed: "実測結果を逐語引用"
- attempt: 1

## Manual Verification

設定画面で「新規タブを自動的にキューへ追加」をONにして保存し、空の新規タブを開いて通常ページへ遷移する。期待結果は読み上げを開始せずキュー末尾に一度だけ表示されること。OFFに戻して同じ操作を行い、キューが変化しないことを確認する。設定のエクスポート後にインポートし、ON/OFF が保持されることも確認する。

## 依存

- P01: 設定キー、既定値、設定画面、エクスポート／インポートのデータ契約。
- 既存 `TabManager`、`BackgroundOrchestrator`、Browser API モック。
- 実装前に追加の仕様判断は不要。P01 契約と本状態遷移を満たす。
