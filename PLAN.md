# title: OpenRouterプロバイダルーティング機能の実装

## 概要
- OpenRouter APIのプロバイダルーティング機能を実装し、ユーザーが特定のプロバイダ（DeepInfra、Together、OpenAIなど）を優先的に使用できるようにします
- 設定画面にプロバイダ指定のテキストボックスを追加し、指定がある場合のみAPIリクエストに`provider.order`を含めます

### goal
- ユーザーが設定画面で任意のプロバイダ名を入力できる
- プロバイダを指定した場合、OpenRouter APIがそのプロバイダを優先して使用する
- プロバイダを指定しない場合（空欄）、従来通り自動選択される

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること
- TDD（テスト駆動開発）で実装すること：先にテストを書き、実装し、リファクタリングする
- 既存機能（プロバイダ指定なし）が正常動作することを保証する
- TypeScript型安全性を維持する

## 開発のゴール
- プロバイダルーティング機能をTDDで着実に実装する
- すべてのユニットテストがパスする
- 統合テストで実際のAPI動作を確認する
- 既存のAI要約・翻訳機能との互換性を維持する

## 実装仕様

### OpenRouter API Provider Routing仕様
- APIリクエストボディに `provider` フィールドを追加可能
- フォーマット: `{ "provider": { "order": ["プロバイダ名"] } }`
- プロバイダ名の例: `DeepInfra`, `Together`, `OpenAI`, `Fireworks`
- 空の場合はフィールド自体を省略し、OpenRouterが自動選択

### 技術スタック
- TypeScript 5.x
- Jest + React Testing Library（テスト）
- Chrome/Firefox Storage API（設定保存）
- React 18（UI）

## 生成AIの学習用コンテキスト
### 型定義ファイル
- `src/shared/types/ai.ts`
  - AiSettings、OpenRouterRequest、OpenRouterResponse インターフェース定義

### サービス層
- `src/shared/services/openrouter.ts`
  - OpenRouterClient クラス（API通信）

### ストレージ層
- `src/shared/utils/storage.ts`
  - StorageManager クラス（設定の保存・検証）

### バックグラウンド処理
- `src/background/aiProcessor.ts`
  - AiProcessor クラス（AI要約・翻訳処理の統合管理）
- `src/background/aiPrefetcher.ts`
  - AiPrefetcher クラス（事前AI処理）

### UI
- `src/options/OptionsApp.tsx`
  - 設定画面のReactコンポーネント

### テストファイル
- `src/shared/services/__tests__/openrouter.test.ts`
  - OpenRouterClient のユニットテスト
- `src/options/__tests__/OptionsApp.test.tsx`
  - 設定画面のUIテスト
- `src/background/__tests__/aiProcessor.test.ts`
  - AiProcessor のユニットテスト

## Process

### process1 型定義の拡張
#### sub1 AiSettings インターフェースにプロバイダフィールドを追加
@target: `src/shared/types/ai.ts`
@ref: なし
- [x] `AiSettings` インターフェースに `openRouterProvider?: string` フィールドを追加
  - 省略可能（オプショナル）な文字列型
  - JSDocコメントで「特定のプロバイダを優先する場合に指定（例: DeepInfra, Together）」と説明

#### sub2 OpenRouterRequest インターフェースにプロバイダフィールドを追加
@target: `src/shared/types/ai.ts`
@ref: OpenRouter API仕様（https://openrouter.ai/docs/features/provider-routing）
- [x] `OpenRouterRequest` インターフェースに `provider?: { order: string[] }` フィールドを追加
  - 省略可能なオブジェクト型
  - JSDocコメントで「プロバイダルーティング設定」と説明

#### sub3 型定義のユニットテスト作成
@target: `src/shared/types/__tests__/ai.test.ts`（新規作成）
@ref: `src/shared/types/ai.ts`
- [x] テストファイルを新規作成
- [x] AiSettings インターフェースのプロパティ検証テスト
  - プロバイダフィールドが存在することを確認
  - 省略可能であることを確認
- [x] OpenRouterRequest インターフェースのプロパティ検証テスト
  - provider フィールドが存在することを確認
  - provider.order が文字列配列であることを確認

### process2 ストレージ層の更新
#### sub1 DEFAULT_AI_SETTINGS にプロバイダのデフォルト値を追加
@target: `src/shared/utils/storage.ts`
@ref: なし
- [x] `DEFAULT_AI_SETTINGS` オブジェクトに `openRouterProvider: ''` を追加
  - デフォルトは空文字列（プロバイダ指定なし）

#### sub2 validateAiSettings メソッドにプロバイダ検証ロジックを追加
@target: `src/shared/utils/storage.ts`
@ref: なし
- [x] `validateAiSettings()` メソッド内でプロバイダのトリム処理を追加
  - `openRouterProvider: (settings.openRouterProvider ?? this.DEFAULT_AI_SETTINGS.openRouterProvider).trim()`
  - 空白文字を除去し、未定義の場合は空文字列にする

#### sub3 ストレージ層のユニットテスト拡張
@target: `src/shared/utils/__tests__/storage.test.ts`
@ref: `src/shared/utils/storage.ts`
- [x] `validateAiSettings` のテストケースを追加
  - 空文字列のプロバイダをトリムするテスト
  - 有効なプロバイダ名（`DeepInfra`など）を保持するテスト
  - プロバイダが未定義の場合は空文字列になるテスト
  - 前後の空白を除去するテスト

### process3 OpenRouterClient の更新
#### sub1 コンストラクタにプロバイダパラメータを追加
@target: `src/shared/services/openrouter.ts`
@ref: なし
- [x] コンストラクタのシグネチャを更新
  - `constructor(apiKey: string, model: string, provider?: string)`
  - 第3引数としてプロバイダを追加（省略可能）
- [x] プライベートプロパティを追加
  - `private readonly provider?: string;`
- [x] コンストラクタ内でプロバイダを初期化
  - `this.provider = provider;`

#### sub2 リクエスト生成ロジックの更新（testConnection）
@target: `src/shared/services/openrouter.ts`
@ref: なし
- [x] `testConnection()` メソッド内のリクエストボディ生成を更新
  - `this.provider` が空でない場合のみ `provider: { order: [this.provider] }` を追加
  - 条件分岐: `...(this.provider ? { provider: { order: [this.provider] } } : {})`

#### sub3 リクエスト生成ロジックの更新（summarize）
@target: `src/shared/services/openrouter.ts`
@ref: なし
- [x] `summarize()` メソッド内のリクエストボディ生成を更新
  - testConnectionと同様の条件分岐を追加

#### sub4 リクエスト生成ロジックの更新（translate）
@target: `src/shared/services/openrouter.ts`
@ref: なし
- [x] `translate()` メソッド内のリクエストボディ生成を更新
  - testConnectionと同様の条件分岐を追加

#### sub5 OpenRouterClient のユニットテスト拡張
@target: `src/shared/services/__tests__/openrouter.test.ts`
@ref: `src/shared/services/openrouter.ts`
- [x] プロバイダなしでクライアントを初期化できるテスト
  - `new OpenRouterClient(apiKey, model)` が正常動作
- [x] プロバイダありでクライアントを初期化できるテスト
  - `new OpenRouterClient(apiKey, model, 'DeepInfra')` が正常動作
- [x] 空文字列のプロバイダは無視されるテスト
  - `new OpenRouterClient(apiKey, model, '')` でproviderフィールドがリクエストに含まれない
- [x] プロバイダが指定されている場合、リクエストボディに provider.order を含めるテスト
  - fetch モックを検証し、リクエストボディに `provider: { order: ['DeepInfra'] }` が含まれることを確認
- [x] プロバイダが空の場合、provider フィールドを含めないテスト
  - fetch モックを検証し、リクエストボディに `provider` フィールドが存在しないことを確認
- [x] testConnection でプロバイダが正しく送信されるテスト
- [x] summarize でプロバイダが正しく送信されるテスト
- [x] translate でプロバイダが正しく送信されるテスト

### process4 バックグラウンド処理の更新
#### sub1 AiProcessor の更新
@target: `src/background/aiProcessor.ts`
@ref: `src/shared/services/openrouter.ts`
- [x] `ensureClient()` メソッド内の OpenRouterClient インスタンス化を更新
  - `new OpenRouterClient(settings.openRouterApiKey, settings.openRouterModel, settings.openRouterProvider)`
  - 第3引数としてプロバイダを追加

#### sub2 AiPrefetcher の更新
@target: `src/background/aiPrefetcher.ts`
@ref: `src/shared/services/openrouter.ts`
- [x] `getClient()` メソッド内の OpenRouterClient インスタンス化を更新
  - `new OpenRouterClient(settings.openRouterApiKey, settings.openRouterModel, settings.openRouterProvider)`
  - 第3引数としてプロバイダを追加

#### sub3 AiProcessor のユニットテスト拡張
@target: `src/background/__tests__/aiProcessor.test.ts`
@ref: `src/background/aiProcessor.ts`
- [x] プロバイダ設定が OpenRouterClient に渡されるテスト
  - モックを検証し、`new OpenRouterClient('key', 'model', 'DeepInfra')` が呼ばれることを確認
- [x] プロバイダが空の場合は第3引数が空文字列であることを確認するテスト

### process5 UI実装
#### sub1 設定画面にプロバイダ入力フィールドを追加
@target: `src/options/OptionsApp.tsx`
@ref: なし
- [x] OpenRouterモデル名フィールドの直後に新規フィールドを追加
  - ラベル: 「プロバイダ指定（オプション）」
  - input要素の属性:
    - `id="openRouterProvider"`
    - `type="text"`
    - `value={aiSettings.openRouterProvider || ''}`
    - `onChange={(event) => handleAiSettingChange('openRouterProvider', event.target.value)}`
    - `placeholder="例: DeepInfra, Together, OpenAI"`
    - `aria-label="OpenRouterプロバイダ"`
- [x] ヒントテキストを追加
  - `<p className="setting-hint">特定のプロバイダを優先したい場合に指定してください。空欄の場合は自動選択されます。</p>`

#### sub2 接続テストハンドラの更新
@target: `src/options/OptionsApp.tsx`
@ref: `src/shared/services/openrouter.ts`
- [x] `handleConnectionTest()` 関数内の OpenRouterClient インスタンス化を更新
  - `new OpenRouterClient(aiSettings.openRouterApiKey, aiSettings.openRouterModel, aiSettings.openRouterProvider)`
  - 第3引数としてプロバイダを追加

#### sub3 設定画面のUIテスト拡張
@target: `src/options/__tests__/OptionsApp.test.tsx`
@ref: `src/options/OptionsApp.tsx`
- [x] プロバイダ入力フィールドが表示されるテスト
  - `screen.getByLabelText('OpenRouterプロバイダ')` が存在することを確認
- [x] プロバイダの値を変更できるテスト
  - `fireEvent.change()` でプロバイダ名を入力し、状態が更新されることを確認
- [x] プロバイダの値が保存されるテスト
  - `StorageManager.saveAiSettings()` が正しいプロバイダ値で呼ばれることを確認
- [x] 接続テスト時にプロバイダが使用されるテスト
  - `OpenRouterClient` モックがプロバイダ引数で呼ばれることを確認

### process10 ユニットテスト
#### sub1 全ユニットテストの実行
@target: すべてのテストファイル
@ref: なし
- [x] `npm run test` を実行
- [x] すべてのテストがパスすることを確認
- [x] カバレッジが適切であることを確認
  - Statements: 57.92% (1952/3370)
  - Branches: 48.82% (704/1442)
  - Functions: 55.71% (351/630)
  - Lines: 58.3% (1907/3271)
  - テスト結果: 37 passed, 414 tests passed

#### sub2 テストの追加・修正
@target: 各テストファイル
@ref: 各実装ファイル
- [x] 必要に応じてテストケースを追加
- [x] エッジケース（null、undefined、空文字列など）のテスト
  - 型定義テスト: `src/shared/types/__tests__/ai.test.ts`
  - ストレージテスト: `src/shared/utils/__tests__/storage.test.ts`
  - OpenRouterテスト: `src/shared/services/__tests__/openrouter.test.ts`
  - AiProcessorテスト: `src/background/__tests__/aiProcessor.test.ts`
  - OptionsAppテスト: `src/options/__tests__/OptionsApp.test.tsx`
- [x] 既存テストが引き続きパスすることを確認

### process20 統合テスト
#### sub1 統合テストの追加
@target: `src/shared/services/__tests__/openrouter.integration.test.ts`
@ref: `src/shared/services/openrouter.ts`
- [ ] プロバイダ指定での要約リクエストテストを追加
  - 環境変数 `OPENROUTER_PROVIDER` を使用
  - 実際のAPIを呼び出して成功することを確認
- [ ] プロバイダなしでの要約リクエストテストが引き続き成功することを確認

#### sub2 手動テスト
@target: ブラウザ拡張機能（Chrome/Firefox）
@ref: なし
- [ ] 設定画面でプロバイダを指定して保存できるか
- [ ] 接続テストがプロバイダ指定で成功するか
- [ ] 要約機能がプロバイダ指定で動作するか
- [ ] 翻訳機能がプロバイダ指定で動作するか
- [ ] プロバイダを空にして通常動作が維持されるか

### process50 フォローアップ
- 実装後に仕様変更や問題が発生した場合、ここにProcessを追加

### process100 リファクタリング
#### sub1 コードの整理
@target: 全実装ファイル
@ref: なし
- [ ] 重複コードの削減
- [ ] コメントの整理・追加
- [ ] 型定義の最適化

#### sub2 パフォーマンス確認
@target: `src/shared/services/openrouter.ts`
@ref: なし
- [ ] プロバイダ指定による追加のオーバーヘッドがないことを確認
- [ ] メモリリークがないことを確認

### process200 ドキュメンテーション
#### sub1 CLAUDE.md の更新
@target: `/Users/takets/repos/read-aloud-tab/CLAUDE.md`
@ref: なし
- [ ] OpenRouterプロバイダルーティング機能の説明を追加
  - 設定方法
  - 利用可能なプロバイダの例
  - デフォルト動作（空欄時）

#### sub2 コード内コメントの更新
@target: 各実装ファイル
@ref: なし
- [ ] JSDocコメントの追加・更新
- [ ] インラインコメントで重要なロジックを説明

#### sub3 テストドキュメントの更新
@target: テストファイル
@ref: なし
- [ ] 各テストケースの説明を明確化
- [ ] エッジケースのテストに注釈を追加

