# title: 設定画面を別タブで開く機能とAI要約設定の追加

## 概要
- ポップアップの歯車ボタンをクリックすると、別タブで設定画面が開くようになる
- 設定画面にAI要約機能の設定項目（OpenRouter APIトークン、モデル名、要約有効化フラグ）を追加する

### goal
- ユーザーが歯車ボタンをクリックして、広い設定画面で各種設定を管理できる
- ユーザーがOpenRouter APIを使用したAI要約機能を有効化・設定できる

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること

## 開発のゴール
- ポップアップの歯車ボタンから別タブで設定画面を開けるようにする
- AI要約機能の設定（APIトークン、モデル名、要約有効化）を保存・管理できるようにする
- セキュリティを考慮したAPIキーの保存方法を実装する

## 実装仕様

### 追加する型定義
```typescript
// src/shared/types/ai.ts (新規ファイル)
export interface AiSettings {
  openRouterApiKey: string;
  openRouterModel: string;
  enableAiSummary: boolean;
}
```

### ストレージキーの追加
```typescript
export const STORAGE_KEYS = {
  // ... 既存
  AI_SETTINGS: 'ai_settings',
} as const;
```

### StorageManager の拡張
```typescript
class StorageManager {
  private static readonly DEFAULT_AI_SETTINGS: AiSettings = {
    openRouterApiKey: '',
    openRouterModel: 'meta-llama/llama-3.2-1b-instruct',
    enableAiSummary: false,
  };

  static async getAiSettings(): Promise<AiSettings>
  static async saveAiSettings(settings: AiSettings): Promise<void>
  static validateAiSettings(settings: Partial<AiSettings>): AiSettings
}
```

### BrowserAdapter の拡張
```typescript
async openOptionsPage(): Promise<void> {
  if (this.browserType === 'chrome') {
    return chrome.runtime.openOptionsPage();
  } else if (this.browserType === 'firefox') {
    return browser.runtime.openOptionsPage();
  }
  throw new Error('Unsupported browser');
}
```

### ポップアップの変更
- 歯車ボタンのクリックハンドラを `BrowserAdapter.openOptionsPage()` 呼び出しに変更
- `showSettings` 状態と `SettingsPanel` コンポーネントの使用箇所を削除（不要）

### 設定画面の拡張
- AI要約設定セクションを追加
  - OpenRouter APIトークン入力（type="password"）
  - OpenRouterモデル名入力（type="text"）
  - AI要約有効化チェックボックス
- エクスポート/インポートにAI設定を含める

## 生成AIの学習用コンテキスト

### 既存実装ファイル
- `src/popup/components/App.tsx`
  - ポップアップのメインコンポーネント（歯車ボタンあり）
- `src/options/OptionsApp.tsx`
  - 設定画面のメインコンポーネント
- `src/shared/utils/storage.ts`
  - ストレージ管理クラス
- `src/shared/utils/browser.ts`
  - BrowserAdapterクラス
- `src/shared/types/index.ts`
  - 型定義のエントリーポイント
- `src/shared/types/tts.ts`
  - TTS設定の型定義（参考）

### 参考実装
- `src/popup/components/IgnoreListManager.tsx`
  - リスト管理UIの実装例

## Process

### process1 型定義の追加
#### sub1 AI設定の型定義ファイルを作成
@target: `src/shared/types/ai.ts` (新規)
@ref: `src/shared/types/tts.ts`
- [ ] `AiSettings` インターフェースを定義
  - `openRouterApiKey: string`
  - `openRouterModel: string`
  - `enableAiSummary: boolean`

#### sub2 型定義のエクスポートを追加
@target: `src/shared/types/index.ts`
@ref: なし
- [ ] `export * from './ai';` を追加

#### sub3 ストレージキーの追加
@target: `src/shared/types/index.ts`
@ref: なし
- [ ] `STORAGE_KEYS` に `AI_SETTINGS: 'ai_settings'` を追加

### process2 ストレージ層の拡張
#### sub1 StorageManagerクラスにAI設定メソッドを追加
@target: `src/shared/utils/storage.ts`
@ref: `src/shared/types/ai.ts`
- [ ] `DEFAULT_AI_SETTINGS` 定数を定義
- [ ] `getAiSettings(): Promise<AiSettings>` メソッドを実装
- [ ] `saveAiSettings(settings: AiSettings): Promise<void>` メソッドを実装
- [ ] `validateAiSettings(settings: Partial<AiSettings>): AiSettings` メソッドを実装
  - APIキーの空文字列チェック
  - モデル名のデフォルト設定

### process3 BrowserAdapterの拡張
#### sub1 openOptionsPageメソッドを追加
@target: `src/shared/utils/browser.ts`
@ref: なし
- [ ] `openOptionsPage(): Promise<void>` メソッドを実装
  - Chrome: `chrome.runtime.openOptionsPage()`
  - Firefox: `browser.runtime.openOptionsPage()`
  - エラーハンドリング

### process4 ポップアップの修正
#### sub1 歯車ボタンの動作を変更
@target: `src/popup/components/App.tsx`
@ref: `src/shared/utils/browser.ts`
- [ ] 歯車ボタンの `onClick` ハンドラを変更
  - `BrowserAdapter.getInstance().runtime.openOptionsPage()` を呼び出し
- [ ] `showSettings` 状態を削除
- [ ] `SettingsPanel` コンポーネントの使用箇所を削除（309-315行目）
- [ ] 不要なインポートを削除

### process5 設定画面の拡張
#### sub1 AI設定の状態管理を追加
@target: `src/options/OptionsApp.tsx`
@ref: `src/shared/types/ai.ts`, `src/shared/utils/storage.ts`
- [ ] `AiSettings` のインポートを追加
- [ ] `aiSettings` 状態を追加
- [ ] `loadInitialData` 関数で AI設定を読み込み
- [ ] `handleAiSettingChange` ハンドラを実装

#### sub2 AI要約設定セクションのUIを追加
@target: `src/options/OptionsApp.tsx`
@ref: なし
- [ ] AI要約設定セクションを追加（「無視リスト」セクションの後）
  - セクションタイトル「AI 要約設定」
  - 要約有効化チェックボックス
  - OpenRouter APIトークン入力（type="password"）
  - OpenRouterモデル名入力（placeholder付き）

#### sub3 エクスポート/インポートにAI設定を含める
@target: `src/options/OptionsApp.tsx`
@ref: なし
- [ ] `ExportPayload` インターフェースに `aiSettings` を追加
- [ ] `handleExport` 関数で AI設定を含める
- [ ] `handleImport` 関数で AI設定を復元

### process6 スタイルの調整（必要に応じて）
@target: `src/options/styles.css` または該当するCSSファイル
@ref: 既存のスタイル
- [ ] AI設定セクションのスタイルを調整（必要な場合）
- [ ] パスワード入力フィールドのスタイルを確認

### process10 ユニットテスト
#### sub1 StorageManagerのテストを追加
@target: `src/shared/utils/__tests__/storage.test.ts`
@ref: `src/shared/utils/storage.ts`
- [ ] `getAiSettings` のテスト
- [ ] `saveAiSettings` のテスト
- [ ] `validateAiSettings` のテスト

#### sub2 BrowserAdapterのテストを追加
@target: `src/shared/utils/__tests__/browser.test.ts`
@ref: `src/shared/utils/browser.ts`
- [ ] `openOptionsPage` のテスト（Chrome/Firefox）

#### sub3 OptionsAppのテストを追加
@target: `src/options/__tests__/OptionsApp.test.tsx`
@ref: `src/options/OptionsApp.tsx`
- [ ] AI設定UIのレンダリングテスト
- [ ] AI設定変更のテスト
- [ ] エクスポート/インポートにAI設定が含まれるテスト

### process50 フォローアップ

### process100 リファクタリング
- [ ] 不要になった `SettingsPanel` コンポーネントの削除を検討
- [ ] 設定画面のコンポーネント分割を検討（AI設定セクションを独立コンポーネント化）

### process200 ドキュメンテーション
- [ ] CLAUDE.mdにAI設定機能の説明を追加
- [ ] README.mdにOpenRouter API設定方法を追加
