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
- [x] プロバイダ指定での要約リクエストテストを追加
  - 環境変数 `OPENROUTER_PROVIDER` を使用
  - 実際のAPIを呼び出して成功することを確認
- [x] プロバイダなしでの要約リクエストテストが引き続き成功することを確認
  - 9つの統合テストが全て成功（13.987秒で完了）
  - プロバイダ指定・プロバイダなし両方のパターンを検証済み

#### sub2 手動テスト
@target: ブラウザ拡張機能（Chrome/Firefox）
@ref: なし
- [ ] 設定画面でプロバイダを指定して保存できるか
  - 設定画面を開く → AI設定セクション → 「プロバイダ指定（オプション）」フィールド
  - 例: "DeepInfra", "Together", "OpenAI" を入力
  - 「保存」ボタンをクリック → 保存成功のメッセージを確認
- [ ] 接続テストがプロバイダ指定で成功するか
  - プロバイダ名を入力後、「接続テスト」ボタンをクリック
  - 成功メッセージが表示されることを確認
- [ ] 要約機能がプロバイダ指定で動作するか
  - 任意のWebページを開く → 拡張機能のポップアップを開く
  - 「要約」ボタンをクリック → 要約が正常に生成されることを確認
- [ ] 翻訳機能がプロバイダ指定で動作するか
  - 英語のWebページを開く → 「翻訳」ボタンをクリック
  - 日本語に翻訳されることを確認
- [ ] プロバイダを空にして通常動作が維持されるか
  - プロバイダフィールドを空欄にして保存
  - 要約・翻訳が引き続き動作することを確認（OpenRouter自動選択）

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

---

# title: AI設定状態表示機能の実装

## 概要
ポップアップウィンドウの再生ボタン付近に、AI要約とAI翻訳の設定状態（ON/OFF）を視覚的に表示する機能を追加します。

### goal
- ユーザーがポップアップを開いた際に、AI要約・翻訳が有効かどうか一目で分かるようにする
- 設定ページを開かずに、現在のAI機能の状態を確認できるようにする
- リアルタイムで設定変更が反映されるようにする

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること
- TDD（テスト駆動開発）で実装すること：先にテストを書き、実装し、リファクタリングする
- 既存のポップアップUI機能との互換性を維持する
- TypeScript型安全性を維持する

## 開発のゴール
- AI設定状態表示コンポーネントをTDDで実装する
- すべてのユニットテストがパスする
- Chrome/Firefox両方で動作確認する
- パフォーマンスに影響を与えない軽量な実装にする

## 調査結果

### 現在のコードベース構造

#### 1. AI設定データ構造（`src/shared/types/ai.ts`）

```typescript
export interface AiSettings {
  openRouterApiKey: string;
  openRouterModel: string;
  enableAiSummary: boolean;        // ← 要約機能のON/OFF
  enableAiTranslation: boolean;    // ← 翻訳機能のON/OFF
  summaryPrompt: string;
  translationPrompt: string;
  openRouterProvider?: string;
}
```

#### 2. ストレージ管理（`src/shared/utils/storage.ts`）

- `StorageManager.getAiSettings()`: AI設定の取得
- `StorageManager.DEFAULT_AI_SETTINGS`: デフォルト値（両方OFF）
- Storage変更リスナーでリアルタイム更新可能

#### 3. 現在のポップアップ構成（`src/popup/components/App.tsx`）

```
App.tsx
 ├─ DiagnosticsBanner (開発者モード時のみ)
 ├─ エラーメッセージ
 ├─ アクションボタン（キューに追加など）
 ├─ StatusDisplay (タブ情報・進捗表示)
 ├─ QuickControls (音声設定スライダー)
 ├─ ControlButtons (再生/停止ボタン) ← この直後に追加
 └─ TabQueueList (キュー一覧)
```

#### 4. 既存の状態管理

- `settings` (TTSSettings): 音声設定は既に管理済み
- `activeTab`: 現在のタブ情報
- **AI設定の状態管理は未実装** ← 今回追加が必要

## 実装仕様

### 採用デザイン: 案1（詳細表示）

```
┌────────────────────────────────────┐
│ [▶️ 再生]  [⏹️ 停止]              │
├────────────────────────────────────┤
│ 🤖 要約: ✓ ON  | 🌐 翻訳: ✗ OFF    │  ← 新規追加
└────────────────────────────────────┘
```

**選定理由**:
- 一目で状態が分かる高い視認性
- アイコン + テキストで直感的
- 色分けでON/OFF状態を明確に区別

### データフロー図

```
┌─────────────────────────────────────────────────┐
│ Chrome Storage (sync)                           │
│ - STORAGE_KEYS.AI_SETTINGS                      │
│   {                                             │
│     enableAiSummary: boolean,                   │
│     enableAiTranslation: boolean,               │
│     ...                                         │
│   }                                             │
└─────────────────────────────────────────────────┘
                    ↓
                    ↓ StorageManager.getAiSettings()
                    ↓
┌─────────────────────────────────────────────────┐
│ App.tsx                                         │
│ - useState: aiSettings                          │
│ - useEffect: 初回読み込み                       │
│ - storage.onChanged: リアルタイム更新            │
└─────────────────────────────────────────────────┘
                    ↓
                    ↓ props
                    ↓
┌─────────────────────────────────────────────────┐
│ AiStatusIndicator.tsx                           │
│ - enableAiSummary: boolean                      │
│ - enableAiTranslation: boolean                  │
│                                                 │
│ 表示: "🤖 要約: ✓ ON | 🌐 翻訳: ✗ OFF"         │
└─────────────────────────────────────────────────┘
```

## Process

### process1 新規コンポーネント作成
#### sub1 AiStatusIndicator コンポーネントの実装
@target: `src/popup/components/AiStatusIndicator.tsx`（新規作成）
@ref: `src/shared/types/ai.ts`
- [ ] 新規ファイルを作成
- [ ] Props インターフェースを定義
  - `enableAiSummary: boolean`
  - `enableAiTranslation: boolean`
  - `compact?: boolean` (将来の拡張用)
- [ ] コンポーネント実装
  - 要約状態の表示（アイコン + ラベル + ON/OFF）
  - 翻訳状態の表示（アイコン + ラベル + ON/OFF）
  - ON/OFF に応じたクラス名の切り替え（enabled/disabled）
- [ ] `React.memo` でメモ化してパフォーマンス最適化

### process2 App.tsx の拡張
#### sub1 AI設定の状態管理追加
@target: `src/popup/components/App.tsx`
@ref: `src/shared/utils/storage.ts`
- [ ] Import文の追加
  - `import { AiSettings } from '../../shared/types';`
  - `import AiStatusIndicator from './AiStatusIndicator';`
- [ ] State の追加（line 44付近）
  - `const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);`

#### sub2 初期化処理の拡張
@target: `src/popup/components/App.tsx`
@ref: `src/shared/utils/storage.ts`
- [ ] useEffect内の初期化処理を更新（line 54-96付近）
  - `Promise.all` に `StorageManager.getAiSettings()` を追加
  - 取得したAI設定を `setAiSettings()` で保存
  - エラーハンドリング（失敗時はデフォルト値を使用）

#### sub3 Storage変更リスナーの拡張
@target: `src/popup/components/App.tsx`
@ref: `src/shared/types/index.ts` (STORAGE_KEYS)
- [ ] handleStorageChange関数を更新（line 100-123付近）
  - `STORAGE_KEYS.AI_SETTINGS` の変更を監視
  - 変更時に `setAiSettings()` を実行

#### sub4 コンポーネントの配置
@target: `src/popup/components/App.tsx`
@ref: なし
- [ ] ControlButtons の直後に配置（line 405-411付近）
  - 条件付きレンダリング: `{aiSettings && (<AiStatusIndicator ... />)}`
  - Props として `enableAiSummary` と `enableAiTranslation` を渡す

### process3 スタイリング
#### sub1 CSS の追加
@target: `src/popup/popup.css`
@ref: なし
- [ ] `.ai-status-indicator` スタイルの追加
  - flexbox レイアウト
  - 背景色、パディング、border-radius
  - マージン設定
- [ ] `.ai-status-item` スタイルの追加
  - flexbox レイアウト
  - gap設定
- [ ] `.ai-status-item.enabled` スタイルの追加
  - 緑色（#4caf50）
  - font-weight: 500
- [ ] `.ai-status-item.disabled` スタイルの追加
  - グレー色（#999）
- [ ] `.ai-status-icon`, `.ai-status-label`, `.ai-status-value` スタイルの追加
  - フォントサイズ調整
- [ ] `.ai-status-divider` スタイルの追加
  - 区切り線の色設定

### process4 テストの追加
#### sub1 AiStatusIndicator のユニットテスト作成
@target: `src/popup/components/__tests__/AiStatusIndicator.test.tsx`（新規作成）
@ref: `src/popup/components/AiStatusIndicator.tsx`
- [ ] テストファイルを新規作成
- [ ] テストケース: 両方ONの場合の表示
  - `enableAiSummary={true}`, `enableAiTranslation={true}`
  - "✓ ON" が2つ表示されることを確認
- [ ] テストケース: 両方OFFの場合の表示
  - `enableAiSummary={false}`, `enableAiTranslation={false}`
  - "✗ OFF" が2つ表示されることを確認
- [ ] テストケース: 要約のみONの場合の表示
  - `enableAiSummary={true}`, `enableAiTranslation={false}`
  - 要約の要素が `enabled` クラスを持つことを確認
- [ ] テストケース: 翻訳のみONの場合の表示
  - `enableAiSummary={false}`, `enableAiTranslation={true}`
  - 翻訳の要素が `enabled` クラスを持つことを確認

#### sub2 App.tsx のテスト拡張
@target: `src/popup/components/__tests__/App.test.tsx`
@ref: `src/popup/components/App.tsx`
- [ ] AI設定読み込みのテストケースを追加
  - `StorageManager.getAiSettings()` がマウント時に呼ばれることを確認
- [ ] AI設定変更のリスナーテストを追加
  - storage変更イベント発火時に state が更新されることを確認
- [ ] AiStatusIndicator が表示されることを確認するテスト
  - AI設定がある場合、コンポーネントがレンダリングされることを確認

### process10 ユニットテスト
#### sub1 全ユニットテストの実行
@target: すべてのテストファイル
@ref: なし
- [ ] `npm run test` を実行
- [ ] すべてのテストがパスすることを確認
- [ ] カバレッジが適切であることを確認

### process20 手動テスト
#### sub1 Chrome での動作確認
@target: Chrome拡張機能
@ref: なし
- [ ] ポップアップを開いた際にAI設定状態が表示されるか
  - 再生ボタンの下に "🤖 要約: ... | 🌐 翻訳: ..." が表示される
- [ ] 設定ページでAI要約をONにしたときリアルタイム更新されるか
  - 設定画面で「AI要約を有効化」をON → ポップアップで即座に反映
- [ ] 設定ページでAI翻訳をONにしたときリアルタイム更新されるか
  - 設定画面で「AI翻訳を有効化」をON → ポップアップで即座に反映
- [ ] ON状態が緑色で表示されるか
- [ ] OFF状態がグレー色で表示されるか

#### sub2 Firefox での動作確認
@target: Firefox拡張機能
@ref: なし
- [ ] Chromeと同様の動作確認を実施
- [ ] スタイルが正しく適用されているか確認
- [ ] storage API の互換性確認

### process100 リファクタリング
#### sub1 コードの整理
@target: 全実装ファイル
@ref: なし
- [ ] 重複コードの削減
- [ ] コメントの整理・追加
- [ ] 型定義の最適化

#### sub2 パフォーマンス確認
@target: `src/popup/components/AiStatusIndicator.tsx`
@ref: なし
- [ ] 不要な再レンダリングがないことを確認
- [ ] `React.memo` が適切に機能しているか確認
- [ ] メモリリークがないことを確認

### process200 ドキュメンテーション
#### sub1 CLAUDE.md の更新
@target: `/home/user/read-aloud-tab/CLAUDE.md`
@ref: なし
- [ ] AI設定状態表示機能の説明を追加
  - 表示内容
  - UI配置
  - リアルタイム更新の仕組み

## 実装後の動作フロー

### 1. 初回表示

```
ユーザーがポップアップを開く
  ↓
App.tsx: useEffect が実行
  ↓
StorageManager.getAiSettings() でAI設定を取得
  ↓
aiSettings state を更新
  ↓
AiStatusIndicator がレンダリング
  ↓
「🤖 要約: ✓ ON | 🌐 翻訳: ✗ OFF」が表示される
```

### 2. 設定変更時のリアルタイム更新

```
ユーザーが設定ページでAI翻訳をONに変更
  ↓
StorageManager.saveAiSettings() が実行
  ↓
chrome.storage.sync.set() でストレージを更新
  ↓
chrome.storage.onChanged イベントが発火
  ↓
App.tsx: handleStorageChange が実行
  ↓
aiSettings state を更新
  ↓
AiStatusIndicator が再レンダリング
  ↓
「🤖 要約: ✓ ON | 🌐 翻訳: ✓ ON」に表示が変わる
```

### 3. エラー時の挙動

```
AI設定の読み込みに失敗
  ↓
console.error でエラーログを出力
  ↓
デフォルト値（両方OFF）を設定
  ↓
「🤖 要約: ✗ OFF | 🌐 翻訳: ✗ OFF」が表示される
  ↓
ポップアップは正常に動作継続
```

## 修正ファイル一覧

| ファイル | 変更内容 | 行数 | 優先度 |
|---------|---------|-----|-------|
| `src/popup/components/AiStatusIndicator.tsx` | **新規作成** - AI設定状態表示コンポーネント | ~40行 | 高 |
| `src/popup/components/App.tsx` | AI設定のstate追加・読み込み・配置 | +20行 | 高 |
| `src/popup/popup.css` | スタイル追加 | +40行 | 高 |
| `src/popup/components/__tests__/AiStatusIndicator.test.tsx` | **新規作成** - 単体テスト | ~60行 | 中 |
| `src/popup/components/__tests__/App.test.tsx` | テスト拡張 | +20行 | 中 |

## 期待される効果

### ユーザビリティ向上

- **視認性**: ポップアップを開いた瞬間にAI機能の状態が分かる
- **効率性**: 設定ページを開かずに状態確認が可能
- **安心感**: 意図せずAI機能が有効/無効になっていないか確認できる

### 実装コスト

- **開発時間**: 約2-3時間（実装 + テスト）
- **コード量**: 約160行（コンポーネント + テスト + スタイル）
- **保守性**: シンプルな実装で保守しやすい

### テスト観点

1. **機能テスト**: 4つの状態パターン（ON/ON, ON/OFF, OFF/ON, OFF/OFF）
2. **統合テスト**: storage変更時のリアルタイム更新
3. **視覚的テスト**: デザインの視認性確認
4. **ブラウザ互換性**: Chrome/Firefox動作確認

## 将来的な拡張案

### 1. クリッカブル化

インジケーターをクリックで設定ページへ遷移:

```typescript
<div
  className="ai-status-indicator clickable"
  onClick={() => {
    BrowserAdapter.getInstance().runtime.openOptionsPage();
  }}
  title="クリックで設定を開く"
>
```

### 2. トグル機能

ポップアップから直接ON/OFF切り替え:

```typescript
const handleToggleSummary = async () => {
  const newSettings = {
    ...aiSettings,
    enableAiSummary: !aiSettings.enableAiSummary
  };
  await StorageManager.saveAiSettings(newSettings);
};
```

### 3. 詳細情報のツールチップ

マウスホバーでAPIキー設定状況などを表示

### 4. アニメーション

状態変更時にフェードイン/アウトアニメーションを追加

---

**作成日**: 2025-10-24
**担当**: Claude Code
**対象ブランチ**: `claude/add-ai-settings-text-011CUSqaC5JoVYDPPzRKf92x`
