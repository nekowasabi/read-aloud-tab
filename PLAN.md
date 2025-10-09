# title: OpenRouter API 接続機能の実装

## 概要
- 設定画面でOpenRouter APIキーを入力し、接続テストを実行できる機能を実装
- ユニットテストで実際の疎通確認を行い、API統合の基盤を構築

### goal
- ユーザがOpenRouter APIキーを設定画面で入力し、「接続テスト」ボタンで疎通確認できる
- テスト結果（成功/失敗）が明確に表示され、エラー時には具体的なメッセージが表示される
- 今後のAI要約・翻訳機能の基盤となるAPIクライアントが整備される

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること

## 開発のゴール
- OpenRouter API との安全な通信を実現するクライアントライブラリを実装
- 設定画面でAPIキーの接続テストをユーザが実行できるUIを提供
- モック・実APIの両方を網羅したユニットテストで品質を保証
- Phase 3（AI要約機能）の実装に向けた基盤を整備

## 実装仕様

### OpenRouter APIクライアント仕様
- **エンドポイント**: `https://openrouter.ai/api/v1/chat/completions`
- **認証**: `Authorization: Bearer ${apiKey}` ヘッダー
- **リクエスト形式**: JSON (Content-Type: application/json)
- **機能**:
  1. 接続テスト: 最小限のリクエストで認証・疎通を確認
  2. テキスト要約: コンテンツを要約するリクエスト送信
  3. エラーハンドリング: 401 (認証), 429 (レート制限), ネットワークエラーの処理

### 設定画面UI仕様
- 既存のAI設定セクションに「接続テスト」ボタンを追加
- テスト実行中: ローディングインジケータ表示、ボタン無効化
- テスト成功: 成功メッセージを表示（緑色）
- テスト失敗: エラーメッセージを表示（赤色）、具体的な原因を含む
- APIキー未入力時: バリデーションエラーを表示

### テスト仕様
- **モックテスト**: fetch APIをモックして各種レスポンスパターンをテスト
- **実API疎通テスト**: 環境変数 `OPENROUTER_API_KEY` がある場合のみ実行
  - 実際のAPIへリクエスト送信
  - レスポンス構造の検証
  - エラーハンドリングの確認

## 生成AIの学習用コンテキスト

### 既存実装
- `src/options/OptionsApp.tsx`
  - AI設定UIの既存実装（APIキー入力、モデル選択、有効化フラグ）
- `src/shared/utils/storage.ts`
  - StorageManager.getAiSettings(), saveAiSettings()
- `src/shared/types/ai.ts`
  - AiSettings インターフェース定義
- `src/options/__tests__/OptionsApp.test.tsx`
  - 既存のUI/設定保存テスト

### テスト環境
- `jest.config.js`
  - Jest設定（ts-jest, jsdom環境）
- `package.json`
  - テストスクリプト: `npm run test`, `npm run test:watch`

## Process

### process1 OpenRouter APIクライアントの実装
#### sub1 APIクライアントクラスの作成
@target: `src/shared/services/openrouter.ts` (新規作成)
@ref: `src/shared/types/ai.ts`, `src/shared/utils/storage.ts`

- [x] `OpenRouterClient` クラスを作成
  - コンストラクタでAPIキーとモデル名を受け取る
  - プライベートメソッド `_makeRequest()` で共通リクエスト処理
- [x] `testConnection()` メソッドを実装
  - 最小限のリクエストで接続テスト（軽量なプロンプトを使用）
  - レスポンスのステータスコードとボディを検証
  - 成功時は `{ success: true }` を返す
  - 失敗時は `{ success: false, error: string }` を返す
- [x] `summarize(content: string, maxTokens: number)` メソッドを実装
  - Phase 3で使用する要約機能の基礎実装
  - システムプロンプト: "Summarize the following content concisely."
  - ユーザープロンプト: content
- [x] エラーハンドリングを実装
  - 401 Unauthorized: "APIキーが無効です"
  - 429 Too Many Requests: "リクエスト制限に達しました。しばらく待ってから再試行してください"
  - 500系エラー: "サーバーエラーが発生しました"
  - ネットワークエラー: "ネットワーク接続を確認してください"
- [x] TypeScript型定義を追加
  - `OpenRouterRequest`, `OpenRouterResponse`, `ConnectionTestResult`
- [x] 型チェックとLintを通過させる
- [x] npm run test で全テストが通ることを確認
- [x] npm run build:firefox でビルドが成功することを確認

#### sub2 サービスディレクトリの作成
@target: `src/shared/services/` (新規ディレクトリ)

- [ ] ディレクトリを作成
- [ ] 今後の拡張に備えた構造を整備（他のAIサービス統合も想定）

### process2 設定画面への接続テスト機能追加
#### sub1 UIコンポーネントの更新
@target: `src/options/OptionsApp.tsx`
@ref: `src/shared/services/openrouter.ts`

- [x] 状態管理を追加
  - `const [isTestingConnection, setIsTestingConnection] = useState(false)`
  - `const [connectionTestResult, setConnectionTestResult] = useState<{success: boolean, message: string} | null>(null)`
- [x] `handleConnectionTest()` 関数を実装
  - APIキーの存在チェック（未入力時は早期リターン）
  - `setIsTestingConnection(true)` でローディング開始
  - `OpenRouterClient` インスタンス生成
  - `testConnection()` を呼び出し
  - 結果を `connectionTestResult` に設定
  - 成功/失敗に応じたメッセージを表示
  - finally ブロックで `setIsTestingConnection(false)`
- [x] AI設定セクションに「接続テスト」ボタンを追加
  - ボタンラベル: "接続テスト"
  - `disabled={isTestingConnection || !aiSettings.openRouterApiKey}`
  - `onClick={handleConnectionTest}`
- [x] テスト結果表示エリアを追加
  - 成功時: 緑色のメッセージ "✓ 接続に成功しました"
  - 失敗時: 赤色のメッセージ "✗ 接続に失敗しました: {エラー詳細}"
  - テスト未実行時: 非表示
- [x] ローディングインジケータを追加
  - テスト実行中は "接続テスト中..." と表示
- [x] 型チェックとLintを通過させる
- [x] npm run test で全テストが通ることを確認
- [x] npm run build:firefox でビルドが成功することを確認

#### sub2 スタイリングの追加
@target: `src/options/OptionsApp.tsx` (インラインまたは別CSSファイル)

- [x] 接続テストボタンのスタイル
- [x] 結果表示エリアのスタイル（成功=緑、失敗=赤）
- [x] ローディング中のスタイル

### process3 型定義の拡張
#### sub1 OpenRouter関連の型定義
@target: `src/shared/types/ai.ts`

- [x] `ConnectionTestResult` インターフェースを追加
  ```typescript
  export interface ConnectionTestResult {
    success: boolean;
    message?: string;
    error?: string;
  }
  ```
- [x] `OpenRouterRequest`, `OpenRouterResponse` インターフェースを追加
  - OpenRouter APIのリクエスト/レスポンス構造に対応
- [x] 型チェックとLintを通過させる
- [x] npm run test で全テストが通ることを確認
- [x] npm run build:firefox でビルドが成功することを確認

### process10 ユニットテスト
#### sub1 OpenRouterClientのモックテスト
@target: `src/shared/services/__tests__/openrouter.test.ts` (新規作成)
@ref: `src/shared/services/openrouter.ts`

- [x] テスト環境のセットアップ
  - `global.fetch` をモック
  - テスト用のAPIキー、モデル名を定義
- [x] 接続テスト成功ケース
  - モックで200レスポンスを返す
  - `testConnection()` が `{ success: true }` を返すことを検証
- [x] 接続テスト失敗ケース（401 Unauthorized）
  - モックで401レスポンスを返す
  - エラーメッセージに "APIキーが無効" が含まれることを検証
- [x] 接続テスト失敗ケース（429 Too Many Requests）
  - モックで429レスポンスを返す
  - エラーメッセージに "リクエスト制限" が含まれることを検証
- [x] ネットワークエラーケース
  - モックでネットワークエラーをスロー
  - エラーメッセージに "ネットワーク" が含まれることを検証
- [x] `summarize()` メソッドのテスト
  - 環境変数が設定されている場合にのみ実行
  - 正常系: 要約テキストが返ることを検証
  - リクエストボディに正しいプロンプトが含まれることを検証

#### sub2 OpenRouterClient実API疎通テスト
@target: `src/shared/services/__tests__/openrouter.integration.test.ts` (新規作成)

- [x] 環境変数チェック
  - `process.env.OPENROUTER_API_KEY` が存在する場合のみテストを実行
  - 存在しない場合は `test.skip()` でスキップ
- [x] 実際のAPI接続テスト
  - 本物のAPIキーを使用して `testConnection()` を呼び出し
  - レスポンスが成功することを検証
  - タイムアウト設定（10秒程度）
- [x] 実際の要約リクエストテスト
  - 短いテキストを `summarize()` に渡す
  - レスポンスが文字列であることを検証
  - レスポンスが空でないことを検証
- [x] エラーハンドリングテスト（無効なAPIキー）
  - 意図的に無効なAPIキーを使用
  - 401エラーが適切にハンドリングされることを検証

#### sub3 OptionsAppコンポーネントのテスト拡張
@target: `src/options/__tests__/OptionsApp.test.tsx`
@ref: `src/shared/services/openrouter.ts`

- [x] OpenRouterClientのモック
  - `jest.mock('../../shared/services/openrouter')` を追加
  - `testConnection` メソッドをモック化
- [x] 接続テストボタンの存在確認
  - "接続テスト" ボタンがレンダリングされることを確認
- [x] APIキー未入力時の挙動
  - APIキーが空の場合、ボタンがdisabledになることを確認
- [x] 接続テスト成功ケース
  - モックで成功レスポンスを返す
  - ボタンクリック後、成功メッセージが表示されることを確認
  - "接続に成功しました" が含まれることを確認
- [x] 接続テスト失敗ケース
  - モックで失敗レスポンスを返す
  - ボタンクリック後、エラーメッセージが表示されることを確認
  - エラー詳細が含まれることを確認
- [x] ローディング状態のテスト
  - テスト実行中、ボタンがdisabledになることを確認
  - "接続テスト中..." が表示されることを確認

### process50 フォローアップ
#### sub1 エラーメッセージの多言語対応（将来対応）
- [ ] 現在は日本語のみ、将来的にi18nライブラリ導入時に対応

#### sub2 リトライ機能の検討（将来対応）
- [ ] 429エラー時の自動リトライ機能（Phase 3で実装検討）

### process100 リファクタリング
- [ ] エラーメッセージを定数化
  - `src/shared/constants.ts` にエラーメッセージ定数を追加
- [ ] API通信の共通ロジックを抽出
  - 今後、他のAIサービス（Google Gemini等）統合時に再利用可能な構造に
- [ ] TypeScript型定義の整理
  - `src/shared/types/api.ts` など、API関連の型を別ファイルに分離検討

### process200 ドキュメンテーション
- [ ] `CLAUDE.md` のPhase 3セクションを更新
  - OpenRouter API統合の進捗状況を記載
  - 次のステップ（要約機能の実装）を明記
- [ ] `README.md` の更新（該当セクションがあれば）
  - OpenRouter APIキーの取得方法を記載
  - 環境変数設定方法（テスト実行用）を記載
- [ ] JSDocコメントの追加
  - OpenRouterClientの各メソッドに詳細なドキュメントを記載
  - パラメータ、戻り値、エラーケースを明記
