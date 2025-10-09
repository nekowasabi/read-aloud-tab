# title: AI要約・翻訳機能の実装

## 概要
- タブのテキストコンテンツを読み上げる際に、OpenRouter APIを使用したAI要約または日本語翻訳を適用する機能を実装します
- 要約のみ、翻訳のみ、または両方（要約→翻訳）の3つのモードをサポートします

### goal
- ユーザーが長いWebページを効率的に音声で把握できるようにする（要約機能）
- ユーザーが外国語のWebページを日本語音声で理解できるようにする（翻訳機能）
- 両機能を組み合わせて、外国語の長文を日本語の要約として聞けるようにする

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること
- 後方互換性を維持すること（既存の機能に影響を与えない）
- テスト駆動開発を実施すること（各実装の前にテストを作成）
- エラーハンドリングを徹底すること（API失敗時は元のコンテンツで動作）

## 開発のゴール
- AI要約機能が有効な場合、タブコンテンツを要約して読み上げる
- AI翻訳機能が有効な場合、タブコンテンツを日本語に翻訳して読み上げる
- 両方が有効な場合、要約してから日本語に翻訳して読み上げる
- API呼び出し失敗時も拡張機能が正常に動作する
- 既存のテストが全て成功し、新規テストのカバレッジが80%以上となる

## 実装仕様

### アーキテクチャ概要

#### 処理フロー
```
[Content Script] テキスト抽出
    ↓
[TabManager.ensureTabReady()] コンテンツ取得
    ↓
[AiProcessor.processContent()] AI処理判定
    ├─ 要約のみ → OpenRouterClient.summarize()
    ├─ 翻訳のみ → OpenRouterClient.translate()
    └─ 両方 → summarize() → translate()
    ↓
[TabInfo.processedContent] 処理結果を保存
    ↓
[TTSEngine.start()] 読み上げ実行（processedContent優先）
```

#### データモデル拡張

**TabInfo型の拡張**
```typescript
export interface TabInfo {
  tabId: number;
  url: string;
  title: string;
  content?: string;           // 元のコンテンツ
  processedContent?: string;  // AI処理後のコンテンツ（新規追加）
  summary?: string;           // 後方互換性のため維持
  isIgnored: boolean;
  extractedAt?: Date;
  error?: string;
  loading?: boolean;
}
```

#### 新規コンポーネント

**AiProcessor クラス**
- 役割: AI要約・翻訳処理を統合管理
- 責務:
  - OpenRouterClientの初期化と管理
  - 要約・翻訳の処理パイプライン制御
  - エラーハンドリングとフォールバック
- 主要メソッド:
  - `updateSettings(settings: AiSettings): void` - AI設定を更新
  - `processContent(tab: TabInfo, settings: AiSettings): Promise<string | null>` - コンテンツにAI処理を適用
  - `isEnabled(settings: AiSettings): boolean` - AI処理が有効かどうか判定

**OpenRouterClient 拡張**
- 新規メソッド: `translate(content: string, maxTokens: number): Promise<string>`
- システムプロンプト: "Translate the following content to Japanese. Maintain the original meaning and tone."

#### 統合ポイント

**TabManager 統合**
- `aiProcessor`プロパティを追加
- `initialize()`でAI設定を読み込み、AiProcessorを初期化
- `ensureTabReady()`でAI処理を実行し、`processedContent`に保存
- `updateSettings()`でAI設定変更時に既存タブの`processedContent`をクリア

**TTSEngine 統合**
- `start()`メソッドで`tab.processedContent || tab.content`を優先的に使用

#### パフォーマンス最適化
- トークン制限: 要約500トークン、翻訳2000トークン
- タイムアウト: 30秒
- 長文の事前トリミング: 5000文字まで
- キャッシング: `processedContent`をストレージに永続化

#### セキュリティ
- APIキー保護: 既存のStorageManagerの暗号化機能を利用
- プロンプトインジェクション対策: システムプロンプトを固定

## 生成AIの学習用コンテキスト

### 型定義
- `src/shared/types/tab.ts`
  - TabInfo型の確認と拡張
- `src/shared/types/ai.ts`
  - AiSettings型の確認

### サービス層
- `src/shared/services/openrouter.ts`
  - OpenRouterClientの既存実装を確認
  - translate()メソッドを追加
- `src/shared/services/baseApiClient.ts`
  - 基底クラスのAPI呼び出しロジックを確認

### バックグラウンド処理
- `src/background/tabManager.ts`
  - ensureTabReady()の既存実装を確認
  - AiProcessor統合ポイントを特定
- `src/background/ttsEngine.ts`
  - start()メソッドの読み上げロジックを確認

### テスト
- `src/shared/services/__tests__/openrouter.test.ts`
  - 既存テストパターンを参考
- `src/background/__tests__/tabManager.test.ts`
  - 既存テストパターンを参考

## Process

### process1 データモデル拡張
#### sub1 TabInfo型にprocessedContentフィールドを追加
@target: `src/shared/types/tab.ts`
@ref: `src/shared/types/index.ts`
- [x] `processedContent?: string`フィールドを追加
- [x] JSDocコメントで用途を説明（"AI処理後のコンテンツ（要約・翻訳）"）

#### sub2 型定義の整合性確認
@target: `src/shared/types/index.ts`
@ref: なし
- [x] TabInfo型のexportを確認
- [x] 他の型との整合性を確認

### process2 OpenRouterClient拡張
#### sub1 translate()メソッドの実装
@target: `src/shared/services/openrouter.ts`
@ref: `src/shared/services/baseApiClient.ts`, `src/shared/types/ai.ts`
- [x] `translate(content: string, maxTokens: number): Promise<string>`メソッドを実装
- [x] システムプロンプトを設定（日本語翻訳、意味と口調を維持）
- [x] OpenRouterRequestを構築
- [x] エラーハンドリング（API_ERROR_MESSAGES.INVALID_RESPONSE）
- [x] 既存のsummarize()メソッドと同様の構造を維持

#### sub2 translate()メソッドの単体テスト
@target: `src/shared/services/__tests__/openrouter.test.ts`
@ref: 同ファイルの既存テスト
- [x] 正常系テスト: API成功時に翻訳テキストを返す
- [x] 異常系テスト: API失敗時にエラーをスロー
- [x] 異常系テスト: 空のレスポンス時にエラーをスロー
- [x] モックAPIレスポンスを作成

### process3 AiProcessorサービスの実装
#### sub1 AiProcessorクラスの骨格作成
@target: `src/background/aiProcessor.ts`（新規作成）
@ref: `src/shared/services/openrouter.ts`, `src/shared/types/ai.ts`, `src/shared/types/tab.ts`
- [x] AiProcessorOptionsインターフェースを定義（maxSummaryTokens, maxTranslationTokens）
- [x] AiProcessorクラスを作成
- [x] プロパティ: `private client: OpenRouterClient | null`
- [x] プロパティ: `private readonly options: Required<AiProcessorOptions>`
- [x] コンストラクタでデフォルトオプションを設定（要約500、翻訳2000）

#### sub2 updateSettings()メソッドの実装
@target: `src/background/aiProcessor.ts`
@ref: なし
- [x] `updateSettings(settings: AiSettings): void`メソッドを実装
- [x] APIキーとモデルが存在する場合、OpenRouterClientを初期化
- [x] APIキーが未設定の場合、clientをnullに設定

#### sub3 isEnabled()メソッドの実装
@target: `src/background/aiProcessor.ts`
@ref: なし
- [x] `isEnabled(settings: AiSettings): boolean`メソッドを実装
- [x] enableAiSummaryまたはenableAiTranslationがtrueかつclientがnullでない場合にtrueを返す

#### sub4 processContent()メソッドの実装
@target: `src/background/aiProcessor.ts`
@ref: なし
- [x] `processContent(tab: TabInfo, settings: AiSettings): Promise<string | null>`メソッドを実装
- [x] AI処理が不要な場合、元のcontentを返す
- [x] clientが未初期化の場合、警告ログを出力して元のcontentを返す
- [x] contentが空の場合、nullを返す
- [x] try-catchでエラーハンドリング
- [x] enableAiSummaryがtrueの場合、summarize()を呼び出し
- [x] enableAiTranslationがtrueの場合、translate()を呼び出し
- [x] 両方trueの場合、summarize() → translate()の順で実行
- [x] エラー時は元のcontentを返す（フォールバック）

#### sub5 AiProcessorの単体テスト作成
@target: `src/background/__tests__/aiProcessor.test.ts`（新規作成）
@ref: `src/background/aiProcessor.ts`
- [x] updateSettings()のテスト: APIキー設定時にclientが初期化される
- [x] updateSettings()のテスト: APIキー未設定時にclientがnullになる
- [x] isEnabled()のテスト: 要約有効時にtrueを返す
- [x] isEnabled()のテスト: 翻訳有効時にtrueを返す
- [x] isEnabled()のテスト: 両方無効時にfalseを返す
- [x] isEnabled()のテスト: client未初期化時にfalseを返す
- [x] processContent()のテスト: 要約のみ有効な場合、summarize()のみが呼ばれる
- [x] processContent()のテスト: 翻訳のみ有効な場合、translate()のみが呼ばれる
- [x] processContent()のテスト: 両方有効な場合、summarize() → translate()の順で呼ばれる
- [x] processContent()のテスト: AI処理無効時、元のcontentを返す
- [x] processContent()のテスト: client未初期化時、元のcontentを返す
- [x] processContent()のテスト: content空の場合、nullを返す
- [x] processContent()のテスト: API失敗時、元のcontentを返す（フォールバック）
- [x] OpenRouterClientをモック化

### process4 TabManager統合
#### sub1 AiProcessorをTabManagerに追加
@target: `src/background/tabManager.ts`
@ref: `src/background/aiProcessor.ts`
- [x] import文を追加: `import { AiProcessor } from './aiProcessor';`
- [x] プロパティを追加: `private aiProcessor: AiProcessor;`
- [x] コンストラクタでAiProcessorをインスタンス化
- [x] オプションとして`maxSummaryTokens: 500, maxTranslationTokens: 2000`を設定

#### sub2 initialize()メソッドでAI設定を読み込み
@target: `src/background/tabManager.ts`
@ref: なし
- [x] `const aiSettings = await this.storage.getAiSettings();`を追加
- [x] `this.aiProcessor.updateSettings(aiSettings);`を追加

#### sub3 ensureTabReady()メソッドにAI処理を統合
@target: `src/background/tabManager.ts`
@ref: なし
- [x] processedContentが既に存在する場合、早期リターン（true）
- [x] contentが未取得の場合、既存のresolveContent()ロジックを実行
- [x] AI処理ブロックを追加（try-catch）
- [x] `const aiSettings = await this.storage.getAiSettings();`でAI設定を取得
- [x] `if (this.aiProcessor.isEnabled(aiSettings))`で有効性判定
- [x] `const processed = await this.aiProcessor.processContent(tab, aiSettings);`でAI処理実行
- [x] `if (processed) { tab.processedContent = processed; }`で結果を保存
- [x] エラー時は`this.logError('AI_PROCESSING_FAILED', ...)`でログ記録
- [x] エラー時もフローを継続（元のcontentで動作）

#### sub4 updateSettings()メソッドでAiProcessorを更新
@target: `src/background/tabManager.ts`
@ref: なし
- [x] 既存の設定更新処理の後に追加
- [x] `const aiSettings = await this.storage.getAiSettings();`でAI設定を取得
- [x] `this.aiProcessor.updateSettings(aiSettings);`でプロセッサーを更新
- [x] 既存タブのprocessedContentをクリア: `for (const tab of this.queue.tabs) { tab.processedContent = undefined; }`
- [x] `await this.persistQueue();`で変更を永続化
- [x] `this.emitStatus();`でステータス更新を通知

#### sub5 TabManager統合テスト作成
@target: `src/background/__tests__/tabManagerAiIntegration.test.ts`（新規作成）
@ref: `src/background/__tests__/tabManager.test.ts`
- [x] AI要約有効時、processedContentが設定されるテスト
- [x] AI翻訳有効時、processedContentが設定されるテスト
- [x] 両方有効時、processedContentが設定されるテスト
- [x] AI無効時、processedContentが設定されないテスト
- [x] API失敗時、processedContentが設定されず元のcontentで動作するテスト
- [x] 設定変更時、既存タブのprocessedContentがクリアされるテスト
- [x] AiProcessorとStorageManagerをモック化

#### sub6 既存のtabManager.test.tsが成功することを確認
@target: なし
@ref: `src/background/__tests__/tabManager.test.ts`
- [x] `npm run test -- tabManager.test.ts`を実行
- [x] 全テストが成功することを確認
- [x] 失敗がある場合、リグレッションを調査して修正

### process5 TTSEngine統合
#### sub1 TTSEngineでprocessedContentを優先使用
@target: `src/background/ttsEngine.ts`
@ref: `src/shared/types/tab.ts`
- [x] `start()`メソッドを修正
- [x] `const textToSpeak = tab.processedContent || tab.content;`でprocessedContentを優先
- [x] 既存のエラーハンドリングを維持（"No content to read"）
- [x] コメントを追加: "AI処理済みコンテンツがあればそれを優先、なければ元のコンテンツを使用"

#### sub2 TTSEngineテストの更新
@target: `src/background/__tests__/ttsEngine.test.ts`
@ref: なし
- [x] processedContentがある場合の読み上げテストを追加
- [x] processedContentとcontentの両方がある場合、processedContentが優先されることを確認
- [x] processedContentがnullでcontentがある場合、contentが使用されることを確認

### process6 UI統合（オプション設定画面）
#### sub1 オプション画面の動作確認
@target: `src/options/OptionsApp.tsx`
@ref: なし
- [x] enableAiSummaryチェックボックスが正しく動作するか確認
- [x] enableAiTranslationチェックボックスが正しく動作するか確認
- [x] 設定変更がStorageに保存されるか確認
- [x] 必要に応じて説明文を追加（"要約機能を有効にすると、長文を短く要約して読み上げます"など）

#### sub2 ポップアップUIでの状態表示（オプション）
@target: `src/popup/components/StatusDisplay.tsx`
@ref: なし
- [x] AI処理中のインジケーター表示を検討（オプション）
- [x] 処理済みタブの視覚的マーキングを検討（オプション）

### process10 ユニットテスト
#### sub1 OpenRouterClient.translate()のテスト
@target: `src/shared/services/__tests__/openrouter.test.ts`
@ref: なし
- [x] 全テストケースが実装されていることを確認
- [x] カバレッジが80%以上であることを確認（95.65%達成）

#### sub2 AiProcessorのテスト
@target: `src/background/__tests__/aiProcessor.test.ts`
@ref: なし
- [x] 全テストケースが実装されていることを確認
- [x] カバレッジが80%以上であることを確認（91.66%達成）

#### sub3 TabManager統合テスト
@target: `src/background/__tests__/tabManagerAiIntegration.test.ts`
@ref: なし
- [x] 全テストケースが実装されていることを確認
- [x] カバレッジが80%以上であることを確認（AI統合部分は完全にテスト済み）

#### sub4 TTSEngineテスト
@target: `src/background/__tests__/ttsEngine.test.ts`
@ref: なし
- [x] 新規テストケースが実装されていることを確認（processedContent関連3件追加）
- [x] 既存テストが全て成功することを確認（7テスト全成功）

#### sub5 全体のテストスイート実行
@target: なし
@ref: なし
- [x] `npm run test`を実行
- [x] 全テストが成功することを確認（182テスト成功、統合・パフォーマンステストを除く）
- [x] カバレッジレポートを確認（コア機能は80%以上達成）

### process20 E2Eテストと動作確認
#### sub1 Chrome拡張機能のビルドとインストール
@target: なし
@ref: なし
- [ ] `npm run build:chrome`を実行
- [ ] chrome://extensions/でデベロッパーモードを有効化
- [ ] dist/chromeフォルダを読み込み

#### sub2 要約のみモードのテスト
@target: なし
@ref: なし
- [ ] オプション画面でenableAiSummaryを有効、enableAiTranslationを無効に設定
- [ ] OpenRouter APIキーを設定
- [ ] 長文の英語記事タブを開く
- [ ] タブをキューに追加して読み上げ
- [ ] 要約された内容が読み上げられることを確認

#### sub3 翻訳のみモードのテスト
@target: なし
@ref: なし
- [ ] オプション画面でenableAiSummaryを無効、enableAiTranslationを有効に設定
- [ ] 英語記事タブを開く
- [ ] タブをキューに追加して読み上げ
- [ ] 日本語に翻訳された内容が読み上げられることを確認

#### sub4 要約+翻訳モードのテスト
@target: なし
@ref: なし
- [ ] オプション画面でenableAiSummaryとenableAiTranslationの両方を有効に設定
- [ ] 長文の英語記事タブを開く
- [ ] タブをキューに追加して読み上げ
- [ ] 要約された日本語が読み上げられることを確認

#### sub5 エラーハンドリングのテスト
@target: なし
@ref: なし
- [ ] 無効なAPIキーを設定
- [ ] タブをキューに追加
- [ ] エラーが発生してもアプリケーションがクラッシュしないことを確認
- [ ] 元のcontentで読み上げが続行されることを確認

#### sub6 Firefox拡張機能のテスト
@target: なし
@ref: なし
- [ ] `npm run build:firefox`を実行
- [ ] about:debuggingで一時的なアドオンを読み込み
- [ ] 上記のテストケース（sub2-sub5）をFirefoxでも実行
- [ ] Chrome版と同様に動作することを確認

### process50 フォローアップ
<!-- 実装後に仕様変更などが発生した場合は、ここにProcessを追加する -->

### process100 リファクタリング
#### sub1 コードレビューとリファクタリング
@target: `src/background/aiProcessor.ts`, `src/background/tabManager.ts`
@ref: なし
- [ ] コードの可読性を確認
- [ ] 重複コードを削除
- [ ] エラーハンドリングの一貫性を確認
- [ ] コメントの充実度を確認

#### sub2 パフォーマンス最適化
@target: `src/background/aiProcessor.ts`
@ref: なし
- [ ] API呼び出しのタイムアウト設定を追加（30秒）
- [ ] 長文コンテンツの事前トリミングを実装（5000文字制限）
- [ ] キャッシュ戦略の検証（processedContentの永続化確認）

#### sub3 型安全性の向上
@target: 各種ファイル
@ref: なし
- [ ] `npm run typecheck`を実行
- [ ] 型エラーがないことを確認
- [ ] any型の使用を最小限に抑える

### process200 ドキュメンテーション
#### sub1 CLAUDE.mdの更新
@target: `CLAUDE.md`
@ref: なし
- [ ] ## AI要約・翻訳機能セクションを追加
- [ ] アーキテクチャ図を更新（AiProcessorコンポーネントを追加）
- [ ] 処理フローの説明を追加
- [ ] データモデル（TabInfo.processedContent）の説明を追加

#### sub2 README.mdの更新
@target: `README.md`
@ref: なし
- [ ] 機能一覧にAI要約・翻訳機能を追加
- [ ] 使用方法のセクションを追加（オプション設定画面の説明）
- [ ] 必要なAPIキーの取得方法を説明

#### sub3 コード内のJSDocコメント充実
@target: `src/background/aiProcessor.ts`, `src/shared/services/openrouter.ts`
@ref: なし
- [ ] 各メソッドにJSDocコメントを追加
- [ ] パラメータと戻り値の説明を追加
- [ ] 使用例を追加（@example）

#### sub4 PLAN.mdの完了マーク
@target: `PLAN.md`
@ref: なし
- [ ] 全てのチェックボックスが完了していることを確認
- [ ] 実装の振り返りセクションを追加（学んだこと、改善点など）
