# title: ブラウザショートカット整理（再生/一時停止 + 全タブ追加）

## 概要
- 読み上げショートカットを再生/一時停止トグルと全タブ追加の2系統に集約し、不要なコマンドを削除して背景処理とUI表記を揃える

### goal
- ユーザーがショートカットで読み上げの開始・一時停止操作と全タブ追加→再生を直感的に行える

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること

## 開発のゴール
- マニフェスト・バックグラウンド処理・設定UI・テストを更新し、残るショートカットの挙動と説明を一致させる

## 実装仕様

## 生成AIの学習用コンテキスト
### manifest
- src/manifest/manifest.chrome.json
  - commandsから不要なショートカットを削除し、新規キーバインドを定義
- src/manifest/manifest.firefox.json
  - 上記と同様にFirefox用コマンドを整理

### background
- src/background/service.ts
  - `handleShortcutCommand`で新しいコマンド分岐を実装し、不要なcaseを削除
  - `ChromeTabsLike`に`query`を追加し、全タブ追加処理をヘルパー化
- src/shared/utils/storage.ts
  - `getIgnoredDomains`を参照してフィルタリング

### tests
- src/background/__tests__/backgroundService.test.ts
  - 新しいショートカットのテストケースを追加・更新

### ui
- src/options/OptionsApp.tsx
  - 表示中のショートカット一覧を最新構成に更新

## Process
### process1 マニフェストのショートカット整理
#### sub1 Chrome/Firefoxマニフェスト更新
@target: src/manifest/manifest.chrome.json
@ref: src/manifest/manifest.firefox.json
- [ ] `read-aloud-toggle`のみ残し、`read-aloud-queue-all`を追加
- [ ] 旧ショートカット定義（start/stop/next/prev/pause/resume）を削除
- [ ] 型チェック
- [ ] npm run testでテスト確認
- [ ] npm run build:chrome/firefoxでビルド確認

### process2 バックグラウンドのショートカット処理実装
#### sub1 コマンドハンドラ更新
@target: src/background/service.ts
@ref: src/shared/utils/storage.ts
- [ ] `handleShortcutCommand`から旧caseを削除し、新コマンド分岐を実装
- [ ] 全タブ追加ヘルパーで`BrowserAdapter.tabs.query`と無効URL/除外ドメインのフィルタリングを行う
- [ ] キュー追加後に必要な場合のみ`processNext`を起動
- [ ] 型チェック
- [ ] npm run testでテスト確認
- [ ] npm run build:chrome/firefoxでビルド確認

### process3 UI表記の更新
#### sub1 設定画面ショートカット一覧修正
@target: src/options/OptionsApp.tsx
@ref: src/manifest/manifest.chrome.json
- [ ] 表示リストを`read-aloud-toggle`と`read-aloud-queue-all`に合わせて更新
- [ ] 型チェック
- [ ] npm run testでテスト確認
- [ ] npm run build:chrome/firefoxでビルド確認

### process4 テスト更新
#### sub1 バックグラウンドショートカットテスト
@target: src/background/__tests__/backgroundService.test.ts
@ref: src/background/service.ts
- [ ] `read-aloud-toggle`の挙動を検証
- [ ] `read-aloud-queue-all`がタブ取得・フィルタ・キュー追加・再生開始を行うことを検証
- [ ] 型チェック
- [ ] npm run testでテスト確認
- [ ] npm run build:chrome/firefoxでビルド確認

### process10 ユニットテスト

### process50 フォローアップ
{{実装後に仕様変更などが発生した場合は、ここにProcessを追加する}}

### process100 リファクタリング

### process200 ドキュメンテーション
- [ ] 必要に応じてREADMEやINSTALLATION_GUIDEのショートカット記述を更新



