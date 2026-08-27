# Process 100: 統合検証とブラウザー互換確認

## 生成情報

- task_id: `T-20260827-auto-queue-new-tabs`
- process_id: `P100`
- 依存: `P02`, `P03`
- 目的: 実装済みの task_delta 全体を統合検証し、Chrome/Firefox の実機挙動と互換性を確認する。
- 実装ファイル変更: なし。検証・手動確認・結果記録のみ。
- behavior_scope: `false`（新しい振る舞いを定義せず、P01〜P03の契約適合性を検証するため）
- Symbol Targets: `n/a`（実装対象シンボルなし）

## Implementation Brief（単独実行可能）

次の順序で検証する。各コマンドの終了コードと要約を確認し、`dist/` に生成物が出てもコミット対象にしない。

1. 対象Jestを実行する。
2. 型検査、リント、Chrome/Firefoxビルドを実行する。
3. 最後にリポジトリ全体の `npm run test` を実行する。
4. `git diff --name-only` と `git status --short` を確認し、変更が実装対象ファイルに限られ、`dist/` がコミット対象でないことを確認する。
5. Chrome/Firefoxの実機でオプション画面と、新規空タブから通常ページへ遷移するケースを確認する。

### 検証対象ファイルと行・シンボル

実装変更は行わないため、以下は検証対象の現行位置（行番号は実装差分により変動し得る）である。

| 対象 | file:line / Symbol | 検証内容 |
|---|---|---|
| ストレージ | `src/shared/utils/storage.ts:StorageManager` | 既定値、同期保存、pending IDの永続化 |
| オプション読込 | `src/options/hooks/useOptionsData.ts:useOptionsData` | default off、切替値の読込・保存 |
| オプションUI | `src/options/OptionsApp.tsx:OptionsApp` | checkbox、説明、rollback |
| 設定転送 | `src/options/services/settingsTransfer.ts:exportSettings/importSettings` | version 3、legacy欠損保持、APIキー除外 |
| 自動追加 | `src/background/autoQueueManager.ts` | onCreated、空タブ補完、重複・順序・除外 |
| 背景接続 | `src/background/service.ts:BackgroundOrchestrator` | 起動、再初期化、onUpdated既存処理との共存 |
| イベント接続 | `src/background/index.ts` | onCreated/onUpdated/onRemoved、startup cleanup |
| 権限 | `src/manifest/manifest.chrome.json`、`src/manifest/manifest.firefox.json` | 追加権限なし |
| 回帰テスト | `src/**/__tests__/*` | 上記契約の統合回帰 |

### 横断方針

- task_delta 全体を対象にし、既存の自動追加・設定・キュー・タブイベントの契約を変更しない。
- 設定未保存・欠損時は既定値 `false`、不正URL・内部ページ・ignored domain は追加しない。
- `onCreated` を起点とし、URL未確定の新規タブだけを `onUpdated` で一度補完する。既存タブの通常更新を自動追加に流用しない。
- サービスワーカー再初期化後も pending 情報と重複排除・順序契約が維持されることを確認する。
- Chrome/Firefoxのマニフェストに新しい権限を追加しない。`dist/` は検証生成物として扱い、コミットしない。
- 失敗時は原因を `実装不備 / テスト環境 / 実機差異 / 既存回帰` に分類し、未検証のまま成功扱いにしない。

## 実行コマンド

```sh
npx jest --runInBand \
  src/shared/utils/__tests__/storage.test.ts \
  src/options/hooks/__tests__/useOptionsData.test.ts \
  src/options/__tests__/OptionsApp.test.tsx \
  src/options/services/__tests__/settingsTransfer.test.ts \
  src/background/__tests__/autoQueueManager.test.ts \
  src/background/__tests__/backgroundService.test.ts
npm run typecheck
npm run lint
npm run build:chrome
npm run build:firefox
npm run test
git diff --name-only
git status --short
```

対象テストの実在パスが実装時に統合・移動されている場合は、同一責務の現行テストパスへ置き換える。ただし検証対象（storage、useOptionsData、OptionsApp、settingsTransfer、autoQueueManager、backgroundService）は減らさない。

## 統合受け入れ条件

- 設定の既定値はオフで、UIのcheckboxと保存値が一致する。
- exportはversion 3で `autoQueueNewTabs` をbooleanとして含み、legacy payloadでキーが欠損しても現在値を保持する。
- `onCreated` でURL確定済みの通常タブを直接追加する。
- 空タブを開いて長時間経過後に通常ページへ遷移すると、該当タブを `onUpdated` で追加する。
- サービスワーカー再初期化後もpending情報を使って上記補完が成立する。
- `onRemoved`、off、startup cleanup がpendingとキュー状態を残さない。
- 同一タブを重複追加せず、追加順を崩さない。
- 内部ページ、ignored domain、不正URLは追加しない。
- 既存の `onUpdated` 処理を維持し、再読込・通常遷移を誤って新規追加扱いしない。
- Chrome/Firefoxのmanifestに権限追加がなく、`dist/` がコミット対象に含まれない。
- 必須コマンドと実機確認がすべて成功する。

## Verification Gates（12列）

| gate_id | phase | type | executor | required | command | input_scope | pass_criteria | evidence_spec | failure_policy | criterion_refs | policy_refs |
|---|---|---|---|---:|---|---|---|---|---|---|---|
| P100-VG-01 | unit-integration | test | agent | true | `npx jest --runInBand src/shared/utils/__tests__/storage.test.ts src/options/hooks/__tests__/useOptionsData.test.ts src/options/__tests__/OptionsApp.test.tsx src/options/services/__tests__/settingsTransfer.test.ts src/background/__tests__/autoQueueManager.test.ts src/background/__tests__/backgroundService.test.ts` | 指定6責務のJest | 終了コード0、default off、version3/legacy欠損、onCreated、空tab補完、再初期化、cleanup、重複/順序、除外、不正URL、既存onUpdatedの各アサーションが成功 | Jestの成功サマリ、対象ケース名、終了コード | `failure_class=gate_fail; retryable=true; terminal_action=await_input` | AC-01〜AC-12 | TEST-GREEN,QUALITY-01 |
| P100-VG-02 | build-quality | quality | agent | true | `npm run typecheck && npm run lint && npm run build:chrome && npm run build:firefox` | task_delta全体、両ブラウザー | 型検査・リント・両ビルドが終了コード0。manifest差分に権限追加なし | 各終了コード、ビルド要約、manifest権限比較 | `failure_class=quality_regression; retryable=true; terminal_action=await_input` | AC-13,AC-14 | QUALITY-01,SCOPE-01 |
| P100-VG-03 | regression | test | agent | true | `npm run test` | リポジトリ全テスト | 終了コード0、既存テストを含む全テスト成功 | 全テスト成功サマリと終了コード | `failure_class=regression; retryable=true; terminal_action=escalate_plan_repair` | AC-01〜AC-14 | TEST-GREEN,QUALITY-01 |
| P100-VG-04 | visual-compatibility | visual | human | true | `executor:human` | 実機Chrome/Firefox、Options、空タブ→通常ページ | 両ブラウザーでcheckbox表示・保存再表示・空タブ遷移時の1回追加・内部/ignored除外を確認し、画面崩れと権限要求増加がない | ブラウザー名、拡張ビルド、操作、観測結果、スクリーンショットまたは記録 | `failure_class=manual_or_compatibility; retryable=false; terminal_action=await_input` | AC-01,AC-03〜AC-09,AC-13 | MANUAL-01,COMPAT-01 |

## GoalEvidence

各ゲートについて、実行結果または実機記録から1件以上を残す。引用のない `pass` は無効とする。

```markdown
✅ **Phase Complete**
- gate_id: P100-VG-01 | P100-VG-02 | P100-VG-03 | P100-VG-04
- status: pass | fail | unverified
- command_or_action: {実行コマンドまたは実機操作}
- exit_code: {数値または n/a}
- expected: "{合格条件}"
- observed: "{出力または実機記録からの引用}"
- attempt: {n}
```

## Final相当 Conformance

P100完了時、次を最終適合判定とする。

| 判定 | 合格条件 | 証拠 |
|---|---|---|
| Contract | P01〜P03の設定、転送、イベント、cleanup契約に違反しない | P100-VG-01のテスト名と観測値 |
| Compatibility | Chrome/Firefox双方でUIと空タブ補完が成立する | P100-VG-04の実機記録 |
| Quality | typecheck、lint、両ビルド、全テストが成功する | P100-VG-02/03の終了コード |
| Scope | 実装変更なし、manifest権限追加なし、`dist/`未コミット | `git diff --name-only`、manifest比較、`git status --short` |

## QAチェックリスト

- [ ] default off（設定欠損を含む）
- [ ] export version 3とboolean
- [ ] legacy欠損キーで現在値保持
- [ ] onCreated直接追加
- [ ] 空tab→長時間経過→onUpdated補完
- [ ] service worker再初期化
- [ ] onRemoved / off / startup cleanup
- [ ] 重複排除と順序維持
- [ ] 内部ページ / ignored domain / 不正URLを除外
- [ ] 既存onUpdated処理を維持
- [ ] manifest権限追加なし
- [ ] `dist/`未コミット

## Manual Verification

`executor: human` として、同じビルド成果物をChromeとFirefoxへ読み込む。Options画面でcheckboxのラベル・説明・保存再表示を確認する。次に自動追加を有効化し、空の新規タブを開いて十分な時間を置いた後、通常の読み上げ可能ページへ遷移する。キューへ1回だけ追加されること、内部ページとignored domainでは追加されないこと、無効化後は追加されないことを確認する。確認結果にはブラウザー、バージョン、ビルド、操作順、観測結果を記録する。

## Left to Implementation

- なし。検証対象・判定条件・実行順序は本Processで確定している。

## Noticed but not fixing

- 実機ブラウザー固有の既存表示差異が見つかっても、P100では自動追加機能に直接関係する差異だけを報告し、修正は別タスクとする。
