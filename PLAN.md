# title: Read Aloud Tab - Phase 2 複数タブ対応と高度な設定機能

## 概要
- ブラウザ拡張機能「Read Aloud Tab」に複数タブのキュー管理機能と高度な設定機能を実装する
- 複数タブを順番に読み上げ、無視リスト管理、キーボードショートカット設定などの機能を追加

### goal
- ユーザーが複数のタブを選択して連続読み上げができる
- 読み上げたくないドメインを無視リストで管理できる
- キーボードショートカットで読み上げを制御できる

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること
- Chrome Manifest V3とFirefox WebExtensionsの両方に対応すること
- TypeScript 5.x、React 18、Web Speech APIを使用すること

## 開発のゴール
- Phase 1で実装済みの単一タブ読み上げ機能を拡張し、複数タブの順次読み上げを実現
- ユーザー設定の永続化とマイグレーション対応
- 大量タブ（100+）でもパフォーマンス劣化しない設計

## 実装仕様

### 読み上げキュー管理
```typescript
interface ReadingQueue {
  tabs: TabInfo[];
  currentIndex: number;
  status: 'idle' | 'reading' | 'paused';
  settings: TTSSettings;
}

interface TabInfo {
  tabId: number;
  url: string;
  title: string;
  content?: string;
  summary?: string;
  isIgnored: boolean;
  position: number;
}
```

### メッセージング仕様
- Background ↔ Popup: Port通信によるリアルタイム状態同期
- Background ↔ Content: Runtime.sendMessageによるコンテンツ取得
- Storage: chrome.storage.syncによるデバイス間同期

## 生成AIの学習用コンテキスト

### 既存実装ファイル
- `src/background/index.ts`
  - 現在のバックグラウンドサービス実装
- `src/shared/types.ts`
  - 既存の型定義
- `src/shared/utils/storage.ts`
  - ストレージユーティリティ
- `src/popup/components/App.tsx`
  - メインポップアップコンポーネント

### テンプレート参照
- `/Users/takets/repos/private_dotfiles/ai_doc/invase/plan/template.md`
  - 計画書フォーマット

## Process

### process1 データモデル拡張 ✅
#### sub1 型定義の拡張 ✅
@target: `src/shared/types.ts`
@ref: `src/shared/types.ts`
- [x] ReadingQueueインターフェースの追加
- [x] TabInfoインターフェースの追加
- [x] QueueMessageタイプの定義
  - QUEUE_ADD, QUEUE_REMOVE, QUEUE_REORDER, QUEUE_SKIP
- [x] QueueStatusタイプの定義
  - idle, reading, paused, error

#### sub2 ストレージスキーマ拡張 ✅
@target: `src/shared/utils/storage.ts`
@ref: `src/shared/types.ts`
- [x] キューデータの永続化メソッド追加
  - saveQueue(), loadQueue(), clearQueue()
- [x] マイグレーション関数の実装
  - v1 → v2スキーマ変換
- [x] 無視リスト管理API
  - addIgnoredDomain(), removeIgnoredDomain(), getIgnoredDomains()

### process2 タブ管理システム実装
#### sub1 TabManagerクラス作成
@target: `src/background/tabManager.ts` (新規)
@ref: `src/shared/types.ts`, `src/background/ttsEngine.ts`
- [x] 既存の型定義とTTS依存関係を確認し、`ReadingQueue`/`TabInfo`/`QueueStatus`の整合性と不足項目を洗い出す
- [x] `tabManager.ts` にクラススケルトンを作成し、TTSエンジン・ストレージ・ステータス通知コールバックを依存性注入できるコンストラクタ/初期化関数を整備する
- [x] キュー操作メソッド `addTab`/`removeTab`/`reorderTabs`/`skipTab` を実装し、タブIDの重複排除・インデックス再計算・境界チェック・操作後の状態スナップショット返却を担保する
- [x] 状態遷移ロジック `processNext`/`pause`/`resume`/`stop` を有限状態マシンとして整理し、非同期完了時の次タブ遷移とエラー時の復旧フロー、コンテンツ未取得時の保留処理を実装する
- [x] キュー永続化ヘルパー (`persistQueue`/`restoreQueue`) を用意し、各操作後の即時保存・初期化時の復元・破損データ検証を行う
- [x] タブライフサイクルイベント `onTabClosed`/`onTabUpdated` を実装し、クローズ済みタブの除去・URL変化の反映・無視ドメインフラグ更新を行う自動クリーンアップ (`cleanupClosedTabs`/`validateQueue`) を組み込む
- [x] 状態通知インターフェースを定義し、購読者登録APIと `emitStatus`/`emitProgress` のペイロード構造を固めて後続のメッセージング層が利用できるようにする

#### sub2 メッセージングシステム拡張
@target: `src/shared/messages.ts` (新規)
@ref: `src/shared/types.ts`
- [x] `messages.ts` のファイル構成方針を固め、Chrome/Firefox共通で利用できるディスクリミネーティッドユニオン型をベースにメッセージ種類を整理する
- [x] キュー操作コマンド (`QUEUE_ADD`/`QUEUE_REMOVE`/`QUEUE_REORDER`/`QUEUE_SKIP`/`QUEUE_CONTROL`) のペイロード型とバリデーションヘルパーを定義し、`TabManager` API とのマッピング表を作成する
- [x] 状態・進捗ブロードキャスト (`QUEUE_STATUS_UPDATE`/`QUEUE_PROGRESS_UPDATE`/`QUEUE_ERROR`) のメッセージ型を設計し、`TabInfo` の最小シリアライズ形と購読先で必要なメタ情報を明確化する
- [x] メッセージハンドラーインターフェースと購読解除ユーティリティを整備し、ポート通信・runtimeメッセージ双方で再利用できる抽象化を提供する
- [x] エラー伝播ポリシー（recoverable / fatal）とロギング契約を定義し、無効メッセージ受信時の対処とデバッグログ出力方針を明示する

### process3 バックグラウンドサービス統合
#### sub1 既存サービスの拡張
@target: `src/background/index.ts`
@ref: `src/background/tabManager.ts`, `src/shared/messages.ts`
- [x] TabManagerインスタンスの初期化
- [x] メッセージハンドラーの統合
- [x] キューイベントの処理
- [x] Port通信の実装
  - onConnect, onMessage, sendUpdate

#### sub2 TTSエンジン連携
@target: `src/background/ttsEngine.ts`
@ref: `src/background/tabManager.ts`
- [x] onEnd コールバックの拡張
  - 次のタブへの自動遷移
- [x] エラーハンドリングの強化
- [x] 音声設定の動的変更対応

### process4 UIコンポーネント実装
#### sub1 タブキューリスト
@target: `src/popup/components/TabQueueList.tsx` (新規)
@ref: `src/popup/components/App.tsx`
- [x] キューアイテムコンポーネント
  - タイトル、URL、操作ボタン表示
- [x] ドラッグ&ドロップ実装
  - react-beautiful-dndの統合
- [x] 現在読み上げ中インジケーター
- [x] キーボードナビゲーション
  - フォーカス管理、Ariaラベル

#### sub2 カスタムフック実装
@target: `src/popup/hooks/useTabQueue.ts` (新規)
@ref: `src/shared/messages.ts`
- [x] キュー状態管理
- [x] リアルタイム更新サブスクリプション
- [x] 楽観的UI更新
- [x] エラー状態管理

#### sub3 メインApp統合
@target: `src/popup/components/App.tsx`
@ref: `src/popup/components/TabQueueList.tsx`
- [x] TabQueueListの統合
- [x] 状態管理の更新
- [x] レイアウト調整

### process5 高度な設定機能
#### sub1 無視リスト管理UI
@target: `src/popup/components/IgnoreListManager.tsx` (新規)
@ref: `src/shared/utils/storage.ts`
- [x] ドメインパターン入力フォーム
- [x] 無視リスト表示
- [x] 削除機能
- [x] バリデーション
  - URLパターン検証、重複チェック

#### sub2 オプションページ実装
@target: `src/options/index.tsx` (新規)
@ref: `src/shared/utils/storage.ts`
- [x] 設定ページレイアウト
- [x] 詳細設定コンポーネント
  - 音声選択、速度、音量
- [x] エクスポート/インポート機能
- [x] HTMLファイル作成
  - `src/options/index.html`

#### sub3 キーボードショートカット
@target: マニフェストファイル、`src/background/index.ts`
@ref: `manifest/manifest.chrome.json`, `manifest/manifest.firefox.json`
- [x] commands権限の追加
- [x] デフォルトショートカット定義
- [x] コマンドハンドラー実装
- [x] 設定UI作成

### process10 ユニットテスト
#### sub1 TabManagerテスト
@target: `src/background/__tests__/tabManager.test.ts` (新規)
- [ ] キュー操作テスト
- [ ] タブライフサイクルテスト
- [ ] エラーケーステスト

#### sub2 UIコンポーネントテスト
@target: `src/popup/components/__tests__/TabQueueList.test.ts` (新規)
- [x] レンダリングテスト
- [x] ユーザーインタラクションテスト
- [x] ドラッグ&ドロップテスト

#### sub3 カスタムフックテスト
@target: `src/popup/hooks/__tests__/useTabQueue.test.ts` (新規)
- [x] 状態管理テスト
- [x] リアルタイム更新テスト

### process50 フォローアップ
#### sub1 パフォーマンス最適化
- [x] 大量タブ（100+）での動作検証
  - Jestで200件の`TabInfo`を投入し`processNext`が100ms以内で進行するか測定するテストを作成（Red）
  - TabManagerにバッチ永続化（debounce）・高速探索・キャッシュ上限を導入しテストをパスさせる（Green）
  - キュー内部表現を`Map`＋インデックス配列に抽出しパフォーマンスコードを整理（Refactor）
- [ ] メモリ使用量の最適化
  - 大容量コンテンツ保持後に`cleanupOldContent`が解放するかのユニットテストを追加（Red）
  - LRUクリアと`useTabQueue`アンマウント時の`disconnect`処理を実装（Green）
  - メモリ閾値を`shared/constants.ts`へ集約し共通ユーティリティ化（Refactor）
- [ ] コンテンツクリーンアップ戦略
  - 再起動時や旧スキーマインポート時の破損防止テストを追加（Red）
  - `migrateStorageSchema`拡張と起動時`validateQueue`/`cleanupClosedTabs`実行を実装（Green）
  - ストレージ整合ロジックを`QueueSanitizer`クラスに切り出し（Refactor）

#### sub2 エッジケース対応
- [ ] タブクラッシュ時の復旧
  - `chrome.tabs.onRemoved/onUpdated`をモックしクラッシュ→復帰テストを追加（Red）
  - ロード中停止＋完了時再開、`skipTab`フォールバックを導入（Green）
  - イベント処理を`TabLifecycleController`に分離（Refactor）
- [ ] 拡張機能の再起動対応
  - サービスワーカー再起動後の状態復旧テスト、Port再接続テストを追加（Red）
  - 起動時スナップショット送信と`onStartup`フックを実装（Green）
  - 初期化処理を`bootstrapBackground`ヘルパーに集約（Refactor）
- [ ] ネットワークエラー処理
  - コンテンツ抽出失敗やインポート失敗のエラーフローを検証するテストを追加（Red）
  - リトライ＋`QUEUE_ERROR`通知/UIトースト表示を実装（Green）
  - エラーコードを`shared/errors.ts`に統一（Refactor）

- スケジュール
  - 大量タブ耐性→メモリ最適化→エッジケース復旧の順にRed-Green-Refactorを回す
  - 各ステップ後に`npm test`/`npm run typecheck`/`npm run build:*`で回帰確認

- [x] 共通コンポーネントの抽出
  - Red: `TabQueueList`/`IgnoreListManager` の重複 UI を検出するレンダリングテストを追加
  - Green: 共通 `ListCard`・`InputWithButton` コンポーネントを導入し既存 UI を置換
  - Refactor: Jest ベースの簡易ストーリーテストと props API ドキュメント整備
- [x] 型定義の整理
  - Red: 型整合性テストで `TabInfo` 等の重複・不一致を検知
  - Green: Queue 系型をモジュール分割し、`SerializedTabInfo` 等を整理
  - Refactor: Barrel ファイルと `shared/constants.ts` を整備して循環参照を解消
- [x] エラーハンドリングの統一
  - Red: エラーログフォーマットを検証するユニットテストを追加
  - Green: `createExtensionError` を実装し、TabManager/Background/UI のエラー通知を統一
  - Refactor: `LoggerLike` 経由のエラーログと共通エラーコード管理に集約
- スケジュール: 共通コンポーネント → 型整理 → エラー統一の順で TDD を回し、各ステップで `npm test`/`npm run typecheck`/lint を実行

### process200 ドキュメンテーション
- [ ] README.mdの更新
  - 新機能の使用方法
- [ ] CHANGELOG.mdの作成
  - Phase 2の変更履歴
- [ ] 開発者向けドキュメント
  - アーキテクチャ説明、API仕様
- [ ] ユーザーガイド作成
  - 複数タブ読み上げの使い方
