# Process 02 Appendix: 設定画面と設定転送

この付録は人間向けの背景・理由・手動確認・対訳のみを収録する。実行器は `process-02.md` だけを読む。

## Why

- 設定値は既存のオプションロード経路へ追加する。画面専用の別ストアを作ると、背景処理と設定画面の値が分離するため。
- `onCreated` 起点のP01が参照するbooleanを設定ファイルにも含める。再設定時に利用者の選択が失われないため。
- version 3ではbooleanを必須にする。曖昧な値を受け入れると背景処理の有効・無効が不定になるため。
- 旧payloadの欠損は現在値を維持する。旧形式を読み込んだだけで利用者の設定を勝手にオフへ戻さないため。
- APIキー除外は既存方針を維持する。設定転送の拡張を理由に秘密情報をファイルへ出さない。

## 選択肢

1. 推奨: 既存の設定画面・転送サービスへbooleanを追加する。変更範囲と回帰面が最小。
2. 設定専用の新しい画面や新しい転送形式を作る。重複実装になるため採用しない。
3. 旧payloadの欠損をfalseへ補正する。既存利用者の設定を変更するため採用しない。

## 手動確認

- ChromeとFirefoxでオプション画面を開き、指定ラベルとhelp文が表示されること。
- チェックを変更して画面を再読み込みし、状態が維持されること。
- 保存失敗をテスト用モックで発生させ、チェックが変更前へ戻ること。
- export JSONにversion 3とbooleanがあり、APIキーが空文字であること。
- autoQueueNewTabsを欠損させた旧JSONをimportし、現在のチェック状態が変わらないこと。

## 対訳

### Feature: 新規タブ自動キュー設定

- `Feature: New-tab auto-queue setting`
- `Scenario: 設定を読み込みチェックボックスへ反映する` — `Load the setting and reflect it in the checkbox`
- `Scenario: 設定変更を保存する` — `Save a setting change`
- `Scenario: 保存失敗時にrollbackする` — `Roll back when saving fails`
- `Scenario: help文を表示する` — `Display the help text`

### Feature: 設定ファイル転送

- `Feature: Settings file transfer`
- `Scenario: version 3でbooleanをexportする` — `Export a boolean in version 3`
- `Scenario: version 3をimportする` — `Import version 3`
- `Scenario: version 3の不正値を拒否する` — `Reject an invalid version 3 value`
- `Scenario: 旧payloadの欠損キーを保持する` — `Preserve the current value when the old payload lacks the key`
