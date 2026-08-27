# Process 02: 設定画面と設定転送

- task_id: `T-20260827-auto-queue-new-tabs`
- 依存: Process 01（自動キュー追加の背景処理が参照する設定契約）
- 目的: 設定画面で自動キュー追加を切り替え、設定ファイルのエクスポート／インポートで値を保持する。
- 実装範囲: `src/options/hooks/useOptionsData.ts`、`src/options/OptionsApp.tsx`、`src/options/services/settingsTransfer.ts`、既存の対象テスト。
- 実装禁止: 背景処理、権限、`dist/`、APIキー保存方式の変更。

## TDD

1. Red: 下記の新規設定ロード・保存・表示・転送・互換性テストを、実装前に追加して失敗させる。
2. Green: `autoQueueNewTabs` の既定値・UI保存・rollback・version 3 転送契約を満たす最小実装を行う。
3. Refactor: 既存の設定ロード、チェックボックス、転送処理のパターンだけを再利用し、対象テスト、型検査、リントを通す。

## Success Criteria

- SC-01: 設定画面は `autoQueueNewTabs` をbooleanとして読み込み、指定ラベルのcheckboxへ反映する。
- SC-02: checkbox変更はbooleanとして保存され、保存失敗時は変更前のUI状態へrollbackする。
- SC-03: exportはversion 3と必須booleanを出力し、importは新形式の非booleanを拒否する。旧payloadのキー欠損は現在値を保持する。
- SC-04: APIキー除外を維持し、対象テスト・型検査・リントが成功する。

## Implementation Brief（単独実行可能）

### Symbol Targets

- `src/options/hooks/useOptionsData.ts:UseOptionsDataResult`
- `src/options/hooks/useOptionsData.ts:useOptionsData`
- `src/options/OptionsApp.tsx:OptionsApp`
- `src/options/services/settingsTransfer.ts:ExportPayload`
- `src/options/services/settingsTransfer.ts:exportSettings`
- `src/options/services/settingsTransfer.ts:ImportResult`
- `src/options/services/settingsTransfer.ts:importSettings`
- `src/options/hooks/__tests__/useOptionsData.test.ts:useOptionsData tests`
- `src/options/__tests__/OptionsApp.test.tsx:OptionsApp tests`
- `src/options/services/__tests__/settingsTransfer.test.ts:settings transfer tests`（存在する場合は拡張、なければ新規作成）

### 対象位置と実装メモ

- `useOptionsData.ts:21-78`: `autoQueueNewTabs: boolean` と setter を結果型・状態・`Promise.all` のロード結果・返却値へ追加する。未保存／欠損は `false` とする。ストレージAPIはP01で定義された名前を使用し、ここで新しい保存形式を作らない。
- `OptionsApp.tsx:9-118`: `autoQueueNewTabs` と setter を受け、ラベル「新しく開いたタブを自動的にキューへ追加する」のチェックボックスを追加する。help文に「空タブは最初の通常ページ遷移時に追加、内部ページ・除外ドメイン対象外、自動再生なし、既存プリフェッチ対象」を日本語で明記する。
- `OptionsApp.tsx:108-118` 相当: 切り替え直後にローカル状態を更新し、保存失敗時は変更前の値へ戻し、失敗メッセージを表示する。成功時は既存の設定保存成功パターンに合わせる。
- `OptionsApp.tsx:64-101`: export/import に `autoQueueNewTabs` を渡し、import結果を状態へ反映する。旧payloadでキーが欠損している場合は、現在値を変更しない。
- `settingsTransfer.ts:11-85`: `SETTINGS_EXPORT_VERSION=3` を定数化する。export payload の `autoQueueNewTabs` は boolean 必須。APIキー除外（`openRouterApiKey: ''`）を維持する。import は新形式の当該値が boolean でない場合に拒否し、旧形式のキー欠損は許容して現在値を返却結果から除外する。既存の設定保存・無視ドメイン保存・AI設定保存の順序とエラー伝播を維持する。
- importで新形式かどうかは既存 `version` の扱いに合わせ、`version: 3` の場合は boolean 必須、旧versionでは欠損を許容する。version 3 以外の未知の型・値は拒否する。

### 横断方針

- 入力検証: JSON object、`settings` object、`ignoredDomains` array、version 3 の `autoQueueNewTabs` boolean を検証し、不正入力は永続化しない。
- エラー: 保存失敗はUIに失敗メッセージを表示し、今回変更したローカル状態だけをrollbackする。APIキーはエクスポートに含めない。
- 互換性: 旧payloadの `autoQueueNewTabs` 欠損は「未指定」として扱い、現在の設定値を保持する。新形式は必須booleanで fail closed とする。
- 命名・形式: 既存のTypeScript、React Testing Library、Jest、Prettierの規約に従う。新規依存は追加しない。
- セキュリティ: APIキー除外を回帰させない。設定ファイルに秘密情報を追加しない。

### ローカル定数（PLANの★ Constantsからの転記）

| 定数 | 値 | 単位 |
|---|---:|---|
| `SETTINGS_EXPORT_VERSION` | `3` | バージョン番号 |

## Behavior Specification

### 変換（export/import）

| 操作 | pre_state / input | output | post_state | test_ref |
|---|---|---|---|---|
| export | 現在の設定と `autoQueueNewTabs` がboolean | version 3 payloadをJSON化してダウンロード | payloadにbooleanがあり、AI APIキーは空文字 | P02-RED-03 / P02-VG-02 |
| import version 3 | `autoQueueNewTabs` がboolean | `ImportResult.autoQueueNewTabs` を返す | 設定、無視ドメイン、AI設定、自動追加設定を保存 | P02-RED-04 / P02-VG-02 |
| import version 3 | `autoQueueNewTabs` がboolean以外／欠損 | エラー | 永続化・UI状態変更なし | P02-RED-05 / P02-VG-02 |
| import旧version | `autoQueueNewTabs` が欠損 | 既存形式を適用 | 自動追加設定は現在値を保持 | P02-RED-06 / P02-VG-02 |

### リアクティブ（UI）

| 状態遷移 | 入力 | 即時表示 | 保存結果 | post_state / test_ref |
|---|---|---|---|---|
| 初期化→表示 | storageのbooleanまたは欠損 | 値またはfalseのcheckbox | なし | checkbox状態が一致 / P02-RED-01 |
| 表示→変更 | checkbox click | 新値を表示 | 保存成功時は新値を維持 | storageへboolean保存 / P02-RED-02 |
| 表示→変更→保存失敗 | checkbox click | 一時的に新値 | 失敗メッセージ後、旧値へrollback | UIが旧値 / P02-RED-02 |
| 表示→import | valid旧payload | 既存値を更新、autoキーは維持 | 既存設定を保存 | autoキーが現在値 / P02-RED-06 |
| 表示→import | invalid新payload | 失敗メッセージ | 何も変更しない | 状態・保存呼出し不変 / P02-RED-05 |

## Completion Criteria (Gherkin)

### Feature: 新規タブ自動キュー設定

```gherkin
Feature: 新規タブ自動キュー設定
  Scenario: 設定を読み込みチェックボックスへ反映する
    Given 保存済みの autoQueueNewTabs が true である
    When 設定画面を開く
    Then 「新しく開いたタブを自動的にキューへ追加する」がチェックされる

  Scenario: 設定変更を保存する
    Given 設定画面が表示されている
    When チェックボックスを有効化する
    Then autoQueueNewTabs が true で保存される

  Scenario: 保存失敗時にrollbackする
    Given autoQueueNewTabs が false である
    When 有効化の保存が失敗する
    Then チェックボックスは false に戻り失敗メッセージを表示する

  Scenario: help文を表示する
    When 設定画面を開く
    Then 空タブ、内部ページ、除外ドメイン、自動再生、プリフェッチの説明が表示される
```

### Feature: 設定ファイル転送

```gherkin
Feature: 設定ファイル転送
  Scenario: version 3でbooleanをexportする
    Given autoQueueNewTabs が true である
    When 設定をexportする
    Then version 3とbooleanのautoQueueNewTabsを含む
    And APIキーを含まない

  Scenario: version 3をimportする
    Given booleanのautoQueueNewTabsを含むversion 3 payloadがある
    When importする
    Then autoQueueNewTabsを含む設定が保存される

  Scenario: version 3の不正値を拒否する
    Given autoQueueNewTabsがbooleanでないpayloadがある
    When importする
    Then importに失敗し永続化しない

  Scenario: 旧payloadの欠損キーを保持する
    Given autoQueueNewTabsがない旧payloadと現在値trueがある
    When importする
    Then autoQueueNewTabsはtrueのままである
```

## Frontend Constraints

- ラベル文字列は完全一致で実装し、`htmlFor` と input `id` を対応させる。
- help文は同じ設定項目の近傍に表示し、スクリーンリーダーで関連付け可能な説明要素にする。
- 読み込み中は既存と同じくフォームを操作不可／非表示とし、保存中専用の新規状態は追加しない。
- 保存失敗時もチェックボックスを操作可能な状態に戻す。
- APIキー、既存のAI設定、無視ドメインUIの挙動を変更しない。

## Visual Verification

| 観点 | 検証者 | 方法 | 合格条件 |
|---|---|---|---|
| 設定項目の配置・日本語 | `human`（実機拡張UI） | オプション画面をChrome/Firefoxで開く | ラベルとhelp文が読め、既存項目を圧迫しない |
| チェック状態・rollback | 自動（RTL） | `npm test -- --runInBand src/options/__tests__/OptionsApp.test.tsx` | 初期値、変更、失敗後の表示がアサートされる |
| 転送内容 | 自動（Jest） | settings transfer対象テスト | version 3、boolean、APIキー除外、旧形式保持をアサートする |

## QA観点表（6技法）

| 技法 | ケース | 期待結果 |
|---|---|---|
| 同値分割 | true / false / 欠損 / 非boolean | true/falseは受理、旧欠損は保持、新形式非booleanは拒否 |
| 境界値 | version 2、3、未知version | 旧versionは互換、新versionは契約検証、未知は拒否 |
| 決定表 | 保存成功／失敗 × UI変更 | 成功は新値維持、失敗は旧値rollback |
| 状態遷移 | load→toggle→save、load→import | 各post_stateが期待値になる |
| ペアワイズ | AI設定有／無 × APIキー有／無 | AI項目を維持しAPIキーだけ除外 |
| エラー推測 | JSON破損、項目欠損、保存例外 | エラーメッセージ、無変更、API例外伝播を確認 |

## Verification Gates（12列）

| gate_id | phase | type | executor | required | command | input_scope | pass_criteria | evidence_spec | failure_policy | criterion_refs | policy_refs |
|---|---|---|---|---:|---|---|---|---|---|---|---|
| P02-VG-01 | red/green | test | agent | true | `npm test -- --runInBand src/options/hooks/__tests__/useOptionsData.test.ts src/options/__tests__/OptionsApp.test.tsx src/options/services/__tests__/settingsTransfer.test.ts` | 対象テストと依存コード | Redでは対象アサーションの期待理由による失敗、Greenでは終了コード0かつ対象テスト全成功 | Jestの該当テスト名・終了コードを記録 | `{failure_class: gate_fail, retryable: true, retry_budget_source: task_retry_budget, terminal_action: await_input}` | SC-01,SC-02,SC-03,SC-04 | TEST-RED,TEST-GREEN,SCOPE-01 |
| P02-VG-02 | verify | test | agent | true | `npm test -- --runInBand src/options/services/__tests__/settingsTransfer.test.ts src/options/__tests__/OptionsApp.test.tsx` | 転送・UIテスト | version 3、boolean必須、旧欠損保持、APIキー除外、rollbackのアサーションが全成功 | Jest出力と終了コード | `{failure_class: gate_fail, retryable: true, retry_budget_source: task_retry_budget, terminal_action: await_input}` | SC-01,SC-02,SC-03,SC-04 | QUALITY-01,DONT-01 |
| P02-VG-03 | verify | quality | agent | true | `npm run typecheck && npm run lint` | task_delta全体 | 型検査・リントとも終了コード0、新規警告なし | 各コマンド終了コードと要約 | `{failure_class: gate_fail, retryable: true, retry_budget_source: task_retry_budget, terminal_action: escalate_plan_repair}` | SC-01,SC-04 | QUALITY-01,SCOPE-01 |

## GoalEvidence

実装時、各ゲートについて機械出力から次の形式を1件記録する。手書きの `pass` は無効とし、Redは期待したアサーション失敗であることを引用する。

```markdown
✅ **Phase Complete**
- gate_id: P02-VG-01
- status: pass | fail | unverified
- command_or_action: {実行コマンド}
- exit_code: {数値}
- expected: "{期待値}"
- observed: "{出力からの逐語引用}"
- attempt: {n}
```

## Manual Verification

`executor: human` の実機確認は実装後に行う。ChromeとFirefoxの拡張オプション画面で、(1)ラベル、(2) help文、(3)チェック状態の再表示、(4)保存失敗後のrollback表示を確認する。実機確認では背景処理のキュー追加そのものはP01の責務として再検証しない。

## 受け入れ条件

- `autoQueueNewTabs` の既定値がfalseで、UIと保存がbooleanで動作する。
- 保存失敗時にUIが変更前へrollbackする。
- help文が指定事項を日本語で明記する。
- exportは `SETTINGS_EXPORT_VERSION=3` でboolean必須、importは新形式の非booleanを拒否する。
- 旧payloadのキー欠損では現在値を変更しない。
- APIキー除外を維持する。
- 対象テスト、型検査、リントが成功する。

## Left to Implementation

- 内部ヘルパーの関数名、テストのdescribe名、既存CSSクラスの再利用方法。
- 既存コンポーネント内での設定項目の局所的な配置（外部表示仕様を変えない範囲）。

## Noticed but not fixing

- 既存の他設定で保存失敗時にrollbackしない箇所があっても、本Processの対象外として変更しない。
