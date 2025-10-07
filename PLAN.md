# title: 設定ウィンドウを閉じた際の読み上げ継続問題の修正

## 概要
- 設定ウィンドウ（options page）を閉じても、音声読み上げが途中で止まらずに継続される機能を実現する

### goal
- ユーザが設定画面を開いて設定を変更した後、ウィンドウを閉じても読み上げが中断されない
- バックグラウンドで安定的に読み上げが実行される

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること

## 開発のゴール
- Chrome (Manifest V3) でOffscreen Document APIを使用し、Service Worker停止時も読み上げを継続
- Firefox (Manifest V2) でpersistent background scriptを有効化し、読み上げの継続性を確保
- 両ブラウザでクロスブラウザ対応を維持しながら、安定した音声合成を実現

## 問題の根本原因

### Chrome (Manifest V3)
- `src/manifest/manifest.chrome.json:16` で `"service_worker": "background.js"` として実装
- Service Workerは非永続的で、アイドル状態になると数秒～数十秒で自動停止される
- 設定ページを閉じるとService Workerがアイドル状態になり停止
- `src/background/ttsEngine.ts:31` で `globalThis.speechSynthesis` を使用しているが、Service Workerコンテキストでは不安定
- Service Workerが停止すると、進行中の音声合成も中断される

### Firefox (Manifest V2)
- `src/manifest/manifest.firefox.json:14` で `"persistent": false` として設定
- Event Pageとして動作し、同様にアイドル時に停止する可能性がある
- 設定ページを閉じるとバックグラウンドスクリプトが停止する可能性

## 実装仕様

### アプローチA: シンプル実装（採用）

#### Firefox側の修正
- `persistent: false` → `persistent: true` に変更
- バックグラウンドスクリプトを永続化し、Web Speech APIが安定動作

#### Chrome側の修正
- Offscreen Document APIを実装
- TTSEngineをOffscreen Document内で実行
- Service Worker ↔ Offscreen Document間でメッセージング
- Service Workerは制御とメッセージングのみを担当

## 生成AIの学習用コンテキスト

### Manifest ファイル
- `src/manifest/manifest.chrome.json`
  - Service Worker設定と権限定義
- `src/manifest/manifest.firefox.json`
  - Background Script設定（persistent設定含む）

### Background Scripts
- `src/background/index.ts`
  - バックグラウンドスクリプトのエントリーポイント
- `src/background/service.ts`
  - BackgroundOrchestrator クラス（メッセージング・制御ロジック）
- `src/background/ttsEngine.ts`
  - TTSEngine クラス（Web Speech API実装）

### Build Configuration
- `webpack.config.js`
  - ブラウザ別ビルド設定

## Process

### process1 Firefox永続化対応
#### sub1 manifest.firefox.json の修正
@target: `src/manifest/manifest.firefox.json`
- [x] Line 14: `"persistent": false` → `"persistent": true` に変更
  - バックグラウンドスクリプトを永続化し、設定ページを閉じても動作継続

### process2 Chrome Offscreen Document実装
#### sub1 Offscreen Document HTML/TypeScript作成
@target: `src/background/offscreen/offscreen.html` (新規)
@target: `src/background/offscreen/offscreen.ts` (新規)
- [ ] `src/background/offscreen/` ディレクトリを作成
- [ ] `offscreen.html` を作成
  - 基本的なHTML構造
  - offscreen.jsをロード
- [ ] `offscreen.ts` を作成
  - TTSEngineのインスタンス化
  - Service Workerからのメッセージ受信
  - 音声合成の実行
  - 進捗状況のブロードキャスト
- [ ] 型チェックを実行
- [ ] npm run build:firefox を実行してビルド確認

#### sub2 Service Worker側のOffscreen管理実装
@target: `src/background/index.ts`
@target: `src/background/service.ts`
@ref: `src/background/ttsEngine.ts`
- [ ] BackgroundOrchestratorにOffscreen Document管理ロジックを追加
  - Offscreen Document作成API呼び出し
  - 既存のOffscreen Documentチェック
  - ライフサイクル管理
- [ ] TTSコマンドをOffscreen Documentに転送するメッセージングを実装
  - start/pause/resume/stop コマンドの転送
  - 設定更新の転送
- [ ] Offscreen Document からの状態更新を受信して、Popupにブロードキャスト
  - 進捗状況
  - ステータス変更
  - エラー通知
- [ ] 型チェックを実行
- [ ] npm run build:firefox を実行してビルド確認

#### sub3 メッセージング型定義の拡張
@target: `src/shared/messages.ts`
- [ ] Offscreen Document用のメッセージ型を追加
  - `OFFSCREEN_TTS_START`
  - `OFFSCREEN_TTS_PAUSE`
  - `OFFSCREEN_TTS_RESUME`
  - `OFFSCREEN_TTS_STOP`
  - `OFFSCREEN_TTS_UPDATE_SETTINGS`
  - `OFFSCREEN_TTS_PROGRESS`
  - `OFFSCREEN_TTS_STATUS`
  - `OFFSCREEN_TTS_ERROR`

#### sub4 Manifest更新
@target: `src/manifest/manifest.chrome.json`
- [ ] `"offscreen"` 権限を追加
  - Line 10付近に `"offscreen"` を追加

#### sub5 Webpack設定更新
@target: `webpack.config.js`
- [ ] offscreen.html のビルド設定を追加
  - HtmlPluginでoffscreen.htmlを生成
  - offscreen.tsをエントリーポイントに追加
- [ ] Chrome用のtarget設定を調整
  - background: 'webworker'
  - offscreen: 'web'
- [ ] 型チェックを実行
- [ ] npm run build:firefox を実行してビルド確認

### process3 ブラウザ判定とアダプター拡張
#### sub1 ブラウザアダプター拡張
@target: `src/shared/utils/browser.ts`
@ref: `src/background/service.ts`
- [x] Offscreen Document APIのラッパーを追加
  - `createOffscreenDocument()`
  - `closeOffscreenDocument()`
  - `hasOffscreenDocument()`
- [x] Firefox用のフォールバック実装
  - Firefoxの場合はOffscreen APIを使用しない
- [x] 型チェックを実行
- [x] npm run build:firefox を実行してビルド確認
- [x] ユニットテストを追加（`src/shared/utils/__tests__/browser.test.ts`）
  - 28個のテストケースが全て成功

### process10 ユニットテスト
#### sub1 Offscreen Document のテスト
@target: `src/background/offscreen/__tests__/offscreen.test.ts` (新規)
- [x] Offscreen Document内のTTSEngine動作テスト
  - メッセージ受信テスト (OFFSCREEN_TTS_START, PAUSE, RESUME, STOP, UPDATE_SETTINGS)
  - start/pause/resume/stop 動作テスト
  - 設定更新テスト
  - エラーハンドリングテスト（無効なメッセージ、ペイロード欠如、TTS起動失敗）
  - 連続コマンドテスト
- [x] 型チェックを実行
- [x] npm run build:chrome を実行してビルド確認
- [x] npm run build:firefox を実行してビルド確認

#### sub2 BackgroundOrchestrator Offscreen統合テスト
@target: `src/background/__tests__/offscreenIntegration.test.ts`
- [x] Offscreen Document作成・管理のテスト
- [x] Service Worker ↔ Offscreen メッセージング テスト
- [x] ブラウザ別分岐のテスト（Chrome/Firefox）
- [x] エラーハンドリング（Offscreen作成失敗、sendMessage失敗、API非サポート）
- [x] 設定更新のフォワーディングテスト
- [x] 型チェックを実行
- [x] npm run build:chrome を実行してビルド確認
- [x] npm run build:firefox を実行してビルド確認

### process50 フォローアップ

#### sub1 動作確認テスト
- [ ] Chromeで拡張機能をロードし、以下を確認:
  - 設定ページを開いて読み上げ開始
  - 設定ページを閉じても読み上げ継続
  - Service Workerが停止しても読み上げ継続（devtoolsで確認）
- [ ] Firefoxで拡張機能をロードし、以下を確認:
  - 設定ページを開いて読み上げ開始
  - 設定ページを閉じても読み上げ継続
  - バックグラウンドスクリプトが永続化されていることを確認

#### sub2 既存機能の回帰テスト
- [ ] 再生/一時停止/停止の動作確認
- [ ] キューへのタブ追加・削除
- [ ] スキップ機能（次/前）
- [ ] 設定変更（速度・音量・ピッチ・音声選択）

### process100 リファクタリング
- [ ] コードレビューによる改善点の洗い出し
- [ ] エラーハンドリングの強化
- [ ] ログ出力の整理

### process200 ドキュメンテーション
- [ ] `CLAUDE.md` の更新
  - Offscreen Document実装に関する説明追加
  - クロスブラウザ対応の詳細記述
- [ ] `README.md` の更新
  - 技術仕様セクションにOffscreen Document APIについて追記
- [ ] コード内コメントの追加
  - Offscreen Document関連ロジックの説明
