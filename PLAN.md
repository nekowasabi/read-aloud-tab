# title: プリフェッチ機能の重複処理問題の修正

## 概要
- 次のタブの読み上げ準備（要約・翻訳のプリフェッチ）が実装されているが、2重のAI処理により効果が発揮されていない問題を修正する
- 修正により、読み上げ中に次のタブのAI処理が先行実行され、タブ切り替え時の待機時間がゼロになる

### goal
- ユーザーが複数タブを連続読み上げする際、タブ切り替え時に待たされることなくスムーズに次のタブの読み上げが開始される
- AI要約・翻訳が有効な場合でも、先行処理により即座に読み上げが継続される

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること

## 開発のゴール
- プリフェッチ機能の2重処理問題を解決し、次のタブへの切り替え待機時間を解消する
- Observable構造（ギャップレス再生）に影響を与えない安全な修正を行う
- 型安全性を向上させ、`@ts-expect-error`を排除する

## 実装仕様

### 現状の問題点

#### 1. 2重のAI処理が発生
```typescript
// TabManager.ensureTabReady() (lines 968-1022)
private async ensureTabReady(tab: TabInfo): Promise<boolean> {
  // (1) まずresolveContentを呼び出し（プリフェッチ待機）
  if (this.resolveContent) {
    const result = await this.resolveContent(tab);  // 975-997行目
    // プリフェッチ済みの要約/翻訳を取得
  }

  // (2) その後、またAiProcessorで処理！
  try {
    const aiSettings = await StorageManager.getAiSettings();
    if (this.aiProcessor.isEnabled(aiSettings)) {
      const processed = await this.aiProcessor.processContent(tab, aiSettings);  // 1003-1017行目
      // プリフェッチ結果を上書き
    }
  }
}
```

**問題**: プリフェッチで取得した`summary`/`translation`を無視して再処理している

#### 2. resolveContentの設定方法が不適切
```typescript
// service.ts:117-119
// @ts-expect-error - resolveContent is private but we need to set it
this.tabManager['resolveContent'] = this.createContentResolver;
```

- `resolveContent`は`private readonly`プロパティ
- 型チェックを無理やり回避
- コンストラクタで渡すべき設計を後から代入

#### 3. Observable構造への影響
- **影響なし**: TTSEngineは最終的なテキストのみを受け取る
- データ準備レイヤーと再生レイヤーが完全に分離されている

## 生成AIの学習用コンテキスト

### 背景仕様
- `.kiro/specs/queue-prefetch-summary/requirements.md`
  - プリフェッチ機能の要件定義
- `.kiro/specs/queue-prefetch-summary/design.md`
  - プリフェッチのアーキテクチャ設計
- `CLAUDE.md`
  - プロジェクト全体のアーキテクチャとkeep-alive戦略

### 修正対象ファイル
- `src/background/tabManager.ts`
  - ensureTabReady()メソッドの修正（AiProcessor呼び出し削除）
  - setContentResolver()メソッドの追加
- `src/background/service.ts`
  - resolveContentの設定方法を改善

### 参照ファイル
- `src/background/aiPrefetcher.ts`
  - プリフェッチのコーディネーター
- `src/background/prefetch/scheduler.ts`
  - プリフェッチのスケジューリング
- `src/background/prefetch/worker.ts`
  - 要約・翻訳のパイプライン
- `src/background/ttsEngine.ts`
  - Observable構造（影響確認用）

## Process

### process1 AiProcessorの重複処理を削除
#### sub1 TabManager.ensureTabReady()内のAI処理を削除
@target: `src/background/tabManager.ts`
@ref: `src/background/aiProcessor.ts`

- [x] 調査: ensureTabReady()でAiProcessorが呼ばれる箇所を特定（lines 1003-1017）
- [ ] TabManager.ensureTabReady()内のAI処理ブロックを削除
  - lines 1003-1017の`aiProcessor.processContent()`呼び出しを削除
  - プリフェッチ結果（`tab.summary`, `tab.translation`）をそのまま使用
- [ ] selectPlaybackContent()の優先順位が正しく機能することを確認
  - `translation` → `summary` → `content` の優先順位
- [ ] AiProcessorインスタンスの保持が不要になったか確認
  - constructor内の`this.aiProcessor`初期化を削除検討

#### sub2 resolveContentの結果を正しく反映
@target: `src/background/tabManager.ts:968-1001`
@ref: `src/background/service.ts:126-171`

- [ ] resolveContentから返却されたsummary/translationをTabInfoに反映
  - 既存のコード（lines 980-988）が正しく動作していることを確認
- [ ] プリフェッチ結果がない場合のフォールバック処理を確認
  - `resolveContent`がnullを返した場合の処理（lines 989-996）

### process2 resolveContentの設計を改善
#### sub1 TabManagerにsetContentResolver()を追加
@target: `src/background/tabManager.ts`

- [ ] publicメソッド`setContentResolver(resolver: ContentResolver)`を追加
  - `resolveContent`を`private`から設定可能にする
  - 型安全な設定方法を提供
- [ ] constructorのoptionsから`resolveContent`を受け取る既存実装を維持
  - 下位互換性を保つ

#### sub2 BackgroundOrchestratorから正式に設定
@target: `src/background/service.ts:117-119`

- [ ] `@ts-expect-error`を削除
- [ ] constructorで`resolveContent`をTabManagerに渡す
  - BackgroundOrchestratorのconstructor内でTabManagerを初期化する際に渡す
  - または、TabManager初期化後に`setContentResolver()`を呼び出す
- [ ] 型エラーが発生しないことを確認

### process3 プリフェッチログの追加
#### sub1 スケジューリングログ
@target: `src/background/prefetch/scheduler.ts`

- [ ] PrefetchScheduler.handleStatusUpdate()にジョブ投入ログを追加
  - スケジューリングされたタブIDと優先度を出力
- [ ] reconcileSchedule()でキャンセルされたジョブのログを追加

#### sub2 ワーカーログ
@target: `src/background/prefetch/worker.ts`

- [ ] PrefetchWorker.runJob()の処理開始時にログ追加
  - 要約/翻訳の有効/無効状態を出力
- [ ] 要約生成完了時、翻訳生成完了時のログを追加
  - 生成されたテキストの長さとプレビューを出力

#### sub3 resolveContent待機ログ
@target: `src/background/service.ts:140-156`

- [ ] 既存のログが適切か確認
  - "Waiting for AI prefetch"
  - "AI prefetch completed"
  - "AI prefetch timeout"
- [ ] プリフェッチ結果の有無をログに追加
  - summary/translationが実際に取得できたかを出力

### process10 ユニットテスト

#### sub1 TabManager.ensureTabReady()のテスト
@target: `src/background/__tests__/tabManager.test.ts`

- [ ] プリフェッチ結果がある場合のテスト
  - resolveContentがsummary/translationを返す場合
  - TabInfoに正しく反映されることを確認
- [ ] プリフェッチ結果がない場合のテスト
  - resolveContentがnullを返す場合
  - コンテンツリクエストが発行されることを確認
- [ ] AiProcessorが呼ばれないことを確認
  - aiProcessor.processContent()がモックされていないことを確認

#### sub2 プリフェッチ統合テスト
@target: `src/background/__tests__/aiPrefetcher.test.ts`

- [ ] 既存のテストが全てパスすることを確認
- [ ] プリフェッチ → 待機 → 読み上げのフロー全体をテスト
  - PrefetchWorkerが要約/翻訳を生成
  - resolveContentが待機して結果を取得
  - TabManagerが結果を使用して読み上げ

### process50 フォローアップ

#### sub1 パフォーマンス検証
- [ ] プリフェッチが実際に動作することを確認
  - 開発者ツールでログを確認
  - タブ切り替え時の待機時間を測定
- [ ] Observable構造（ギャップレス再生）に影響がないことを確認
  - チャンク遷移が正常に動作することを確認

#### sub2 エッジケース対応
- [ ] AI設定が無効な場合のテスト
  - enableAiSummary=false, enableAiTranslation=false
  - プリフェッチがスキップされることを確認
- [ ] APIキーが未設定の場合のテスト
  - プリフェッチが失敗しても読み上げが継続することを確認

### process100 リファクタリング

#### sub1 AiProcessorの役割整理
@target: `src/background/aiProcessor.ts`

- [ ] AiProcessorの使用箇所を確認
  - TabManagerから完全に削除できるか検討
  - 他に使用している箇所がないか確認
- [ ] 不要になった場合は削除を検討

#### sub2 型定義の整理
@target: `src/shared/types.ts`

- [ ] TabInfoのprocessedContentフィールドが不要になったか確認
- [ ] ContentResolverの型定義が適切か確認

### process200 ドキュメンテーション

- [ ] CLAUDE.mdにプリフェッチ機能の動作を追記
  - AiPrefetcherによる先行処理の仕組み
  - resolveContentによる待機ロジック
  - 2重処理問題の解決について
- [ ] .kiro/specs/queue-prefetch-summary/design.mdを更新
  - 実装状況を反映
  - 既知の問題を削除

