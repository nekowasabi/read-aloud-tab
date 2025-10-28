# リファクタリング計画書

**プロジェクト**: Read Aloud Tab  
**作成日**: 2025-10-28  
**バージョン**: 1.0.4  
**目的**: コードベースの保守性、可読性、テスト容易性の向上

---

## 📊 現状分析

### プロジェクト規模
- **総ファイル数**: 68 TypeScript/TSX ファイル（テスト除く）
- **総行数**: 約9,894行
- **テスト状況**: 36スイート、409テスト成功（21スキップ）
- **カバレッジ**: 57.92% (statements)

### 大規模ファイルの特定

| ファイル | 行数 | 複雑度 | リファクタリング優先度 |
|---------|-----|-------|-------------------|
| `src/background/service.ts` | 1,185 | 高 | 🔴 最優先 |
| `src/background/tabManager.ts` | 1,071 | 高 | 🔴 最優先 |
| `src/background/ttsEngine.ts` | 999 | 高 | 🟡 高 |
| `src/background/offscreen/offscreen.ts` | 481 | 中 | 🟢 中 |
| `src/popup/components/App.tsx` | 446 | 中 | 🟢 中 |
| `src/options/OptionsApp.tsx` | 435 | 中 | 🟢 低 |

### コード品質の課題

#### 1. 責任の集中（God Object）
- **`service.ts`** (1,185行): バックグラウンド処理の全てを管理
  - メッセージハンドリング
  - Offscreen Document管理
  - Keep-alive制御
  - タブ管理統合
  - AI処理統合
  
- **`tabManager.ts`** (1,071行): キュー管理の全責務を担当
  - キュー状態管理
  - 読み上げ制御
  - ストレージ永続化
  - イベントリスナー管理
  - コンテンツ解決

#### 2. 密結合
- `service.ts` → `tabManager.ts` → `ttsEngine.ts` の強い依存関係
- テストのモック作成が複雑
- 機能追加時の変更範囲が広い

#### 3. 重複コード
- エラーハンドリングパターンの重複
- ロギングロジックの重複
- 設定管理の分散

#### 4. テスト課題
- 統合テストが多く、単体テストが少ない
- モックが複雑で保守コストが高い
- エッジケースのカバレッジ不足

---

## 🎯 リファクタリング目標

### 主要目標
1. **単一責任の原則 (SRP)**: 各クラスが1つの責任のみを持つ
2. **テスト容易性**: 依存関係の注入とモック化の簡素化
3. **保守性向上**: コードの理解と変更が容易に
4. **パフォーマンス維持**: 既存機能の性能を保持
5. **後方互換性**: ユーザーデータとAPIの互換性確保

### 品質指標目標
- **カバレッジ**: 57% → 75%以上
- **平均ファイル行数**: 300行以下
- **最大ファイル行数**: 600行以下
- **循環的複雑度**: 関数あたり10以下

---

## 📋 リファクタリング計画

### Phase 1: 基盤整備（優先度: 🔴 最優先）

#### Task 1.1: 共通インターフェースの整理
**対象**: `src/shared/types/`

**作業内容**:
- [ ] 型定義を責務ごとに分割
  - `src/shared/types/queue.ts` - キュー関連型
  - `src/shared/types/tts.ts` - TTS関連型
  - `src/shared/types/ai.ts` - AI処理関連型（✅ 既存）
  - `src/shared/types/messaging.ts` - メッセージング型
- [ ] インターフェースの継承関係を整理
- [ ] 不要な型定義の削除

**期待効果**:
- 型の再利用性向上
- 循環依存の解消
- IDE補完の改善

**工数**: 2-3日

---

#### Task 1.2: ユーティリティ関数の統合
**対象**: `src/shared/utils/`

**作業内容**:
- [ ] エラーハンドリングの統一
  ```typescript
  // src/shared/utils/errorHandler.ts (新規)
  export class ErrorHandler {
    static handle(error: unknown, context: string): void;
    static createError(code: string, message: string): ExtensionError;
    static wrapAsync<T>(fn: () => Promise<T>): Promise<Result<T>>;
  }
  ```
- [ ] ロギングの統一
  ```typescript
  // src/shared/utils/logger.ts (新規)
  export class Logger {
    static create(component: string): LoggerLike;
    static setLevel(level: LogLevel): void;
  }
  ```
- [ ] 設定管理の統合（`storage.ts`の改善）

**期待効果**:
- コードの重複削減
- エラー処理の一貫性
- デバッグの容易化

**工数**: 3-4日

---

### Phase 2: `service.ts` のリファクタリング（優先度: 🔴 最優先）

#### Task 2.1: メッセージハンドラーの分離
**対象**: `src/background/service.ts` (1,185行 → 約300行に削減)

**作業内容**:
- [ ] メッセージハンドリングを独立クラスに分離
  ```typescript
  // src/background/messaging/MessageRouter.ts (新規)
  export class MessageRouter {
    private handlers: Map<string, MessageHandler>;
    
    registerHandler(type: string, handler: MessageHandler): void;
    handleMessage(message: Message): Promise<Response>;
  }
  
  // src/background/messaging/handlers/ (新規ディレクトリ)
  // - QueueMessageHandler.ts
  // - TTSMessageHandler.ts
  // - AIMessageHandler.ts
  // - SettingsMessageHandler.ts
  ```

**期待効果**:
- メッセージタイプごとの責任分離
- 新規メッセージタイプの追加が容易に
- 単体テストの簡素化

**工数**: 5-6日

---

#### Task 2.2: Keep-alive管理の独立化
**対象**: `src/background/keepAliveController.ts` の強化

**作業内容**:
- [ ] Keep-alive戦略を`service.ts`から完全分離
- [ ] インターフェースの明確化
  ```typescript
  // src/background/keepalive/KeepAliveStrategy.ts (改善)
  export interface KeepAliveStrategy {
    start(): Promise<void>;
    stop(): Promise<void>;
    getMetrics(): KeepAliveMetrics;
  }
  
  export class ChromeKeepAlive implements KeepAliveStrategy {
    // Chrome Offscreen Document方式
  }
  
  export class FirefoxKeepAlive implements KeepAliveStrategy {
    // Firefox persistent script方式（no-op）
  }
  ```

**期待効果**:
- ブラウザ別実装の明確化
- テストの独立化
- 保守性向上

**工数**: 3-4日

---

#### Task 2.3: Offscreen Document管理の改善
**対象**: `src/background/offscreen/offscreen.ts` (481行)

**作業内容**:
- [ ] ライフサイクル管理の分離
  ```typescript
  // src/background/offscreen/OffscreenManager.ts (新規)
  export class OffscreenManager {
    async create(): Promise<void>;
    async destroy(): Promise<void>;
    isActive(): boolean;
    sendCommand(command: OffscreenCommand): Promise<void>;
  }
  ```
- [ ] TTS処理の責任明確化
- [ ] ポート通信の抽象化

**期待効果**:
- Offscreen Documentの責任範囲の明確化
- Chrome固有ロジックの隔離
- テスト容易性向上

**工数**: 4-5日

---

### Phase 3: `tabManager.ts` のリファクタリング（優先度: 🔴 最優先）

#### Task 3.1: キュー管理の責任分離
**対象**: `src/background/tabManager.ts` (1,071行 → 約400行に削減)

**作業内容**:
- [ ] キュー状態管理を独立クラスに分離
  ```typescript
  // src/background/queue/QueueState.ts (新規)
  export class QueueState {
    private tabs: TabInfo[] = [];
    private currentIndex: number = 0;
    
    addTab(tab: TabInfo, position: AddPosition): void;
    removeTab(tabId: number): void;
    moveTab(fromIndex: number, toIndex: number): void;
    getCurrentTab(): TabInfo | null;
    skip(direction: 'next' | 'previous'): TabInfo | null;
    
    // Immutable operations for predictable state
    clone(): QueueState;
    snapshot(): QueueSnapshot;
  }
  ```

- [ ] イベント管理を独立化
  ```typescript
  // src/background/queue/QueueEventEmitter.ts (新規)
  export class QueueEventEmitter {
    on<T>(event: QueueEvent, listener: (data: T) => void): Unsubscribe;
    emit<T>(event: QueueEvent, data: T): void;
    removeAllListeners(event?: QueueEvent): void;
  }
  ```

**期待効果**:
- 状態変更の予測可能性向上
- イベントリスナー管理の簡素化
- テストの独立化

**工数**: 5-6日

---

#### Task 3.2: ストレージ層の抽象化
**対象**: `src/shared/utils/storage.ts`との連携

**作業内容**:
- [ ] リポジトリパターンの導入
  ```typescript
  // src/background/queue/QueueRepository.ts (新規)
  export interface QueueRepository {
    load(): Promise<QueueSnapshot>;
    save(snapshot: QueueSnapshot): Promise<void>;
    clear(): Promise<void>;
  }
  
  export class ChromeStorageQueueRepository implements QueueRepository {
    // Chrome Storage API実装
  }
  
  export class InMemoryQueueRepository implements QueueRepository {
    // テスト用メモリ実装
  }
  ```

**期待効果**:
- ストレージ実装の交換可能性
- テストでのモック不要
- デバウンス処理の一元管理

**工数**: 3-4日

---

#### Task 3.3: コンテンツ解決の責任分離
**対象**: `ContentResolver`の独立化

**作業内容**:
- [ ] コンテンツ取得戦略の分離
  ```typescript
  // src/background/content/ContentResolver.ts (改善)
  export class ContentResolver {
    constructor(
      private contentFetcher: ContentFetcher,
      private aiProcessor: AiProcessor,
      private prefetchStore: PrefetchStore
    ) {}
    
    async resolve(tab: TabInfo): Promise<ResolvedContent>;
  }
  
  // src/background/content/ContentFetcher.ts (新規)
  export class ContentFetcher {
    async fetchFromTab(tabId: number): Promise<string>;
    async extractContent(html: string): Promise<string>;
  }
  ```

**期待効果**:
- AI処理とコンテンツ取得の分離
- プリフェッチロジックの明確化
- 再利用性向上

**工数**: 4-5日

---

### Phase 4: `ttsEngine.ts` のリファクタリング（優先度: 🟡 高）

#### Task 4.1: チャンク管理の分離
**対象**: `src/background/ttsEngine.ts` (999行 → 約500行に削減)

**作業内容**:
- [ ] チャンク処理を独立クラスに
  ```typescript
  // src/background/tts/ChunkPlayer.ts (新規)
  export class ChunkPlayer {
    constructor(
      private speech: SpeechSynthesis,
      private chunkTransitionStrategy: ChunkTransitionStrategy
    ) {}
    
    async playChunks(chunks: TextChunk[], settings: TTSSettings): Promise<void>;
    pause(): void;
    resume(): void;
    stop(): void;
  }
  ```

- [ ] Observable処理の整理
  ```typescript
  // src/background/tts/ChunkTransitionStrategy.ts (新規)
  export interface ChunkTransitionStrategy {
    setup(chunks: TextChunk[]): Observable<ChunkEvent>;
  }
  
  export class RxJSChunkTransition implements ChunkTransitionStrategy {
    // 既存のRxJSロジック
  }
  ```

**期待効果**:
- チャンク遷移ロジックの明確化
- リトライ処理の独立化
- テストの簡素化

**工数**: 4-5日

---

#### Task 4.2: 音声選択の改善
**対象**: `src/shared/utils/voiceSelector.ts`との連携

**作業内容**:
- [ ] 音声リスト管理の強化
  ```typescript
  // src/background/tts/VoiceManager.ts (新規)
  export class VoiceManager {
    private voiceCache: Map<string, SpeechSynthesisVoice[]>;
    
    async getVoices(lang: string, retryCount?: number): Promise<SpeechSynthesisVoice[]>;
    async selectVoice(preferences: VoicePreferences): Promise<SpeechSynthesisVoice | null>;
    clearCache(): void;
  }
  ```

**期待効果**:
- 音声取得の信頼性向上
- リトライロジックの一元化
- キャッシュ管理の明確化

**工数**: 2-3日

---

### Phase 5: UI層のリファクタリング（優先度: 🟢 中）

#### Task 5.1: コンポーネントの分割
**対象**: `src/popup/components/App.tsx` (446行 → 約200行に削減)

**作業内容**:
- [ ] 状態管理の分離（Context API活用）
  ```typescript
  // src/popup/context/QueueContext.tsx (新規)
  export const QueueContext = createContext<QueueContextValue>(null!);
  
  export function QueueProvider({ children }: Props) {
    // 状態管理ロジック
  }
  ```

- [ ] カスタムフックの統合
  ```typescript
  // src/popup/hooks/useQueueOperations.ts (新規)
  export function useQueueOperations() {
    const { queue, updateQueue } = useContext(QueueContext);
    
    return {
      addTab: useCallback((tab: TabInfo) => { ... }, []),
      removeTab: useCallback((tabId: number) => { ... }, []),
      skipTo: useCallback((direction: Direction) => { ... }, []),
    };
  }
  ```

**期待効果**:
- コンポーネントの再利用性向上
- ロジックとViewの分離
- テストの独立化

**工数**: 3-4日

---

#### Task 5.2: 設定画面の改善
**対象**: `src/options/OptionsApp.tsx` (435行)

**作業内容**:
- [ ] フォーム管理の最適化（React Hook Form検討）
- [ ] 設定セクションのコンポーネント化
  ```typescript
  // src/options/components/sections/ (新規)
  // - TTSSettingsSection.tsx
  // - AISettingsSection.tsx
  // - IgnoreListSection.tsx
  ```

**期待効果**:
- バリデーションの一元化
- フォーム状態管理の簡素化
- 設定項目の追加が容易に

**工数**: 3-4日

---

### Phase 6: テスト強化（優先度: 🟡 高）

#### Task 6.1: 単体テストの追加
**対象**: カバレッジの低いモジュール

**作業内容**:
- [ ] 新規作成クラスの単体テスト追加
- [ ] エッジケースのテスト追加
- [ ] モック戦略の統一
  ```typescript
  // src/tests/mocks/ (新規)
  // - mockBrowser.ts
  // - mockStorage.ts
  // - mockSpeechSynthesis.ts
  ```

**期待効果**:
- カバレッジ75%以上達成
- リグレッション防止
- リファクタリングの安全性向上

**工数**: 5-6日

---

#### Task 6.2: 統合テストの改善
**対象**: 既存の統合テスト

**作業内容**:
- [ ] テストシナリオの整理
- [ ] テストデータの共通化
- [ ] 非同期処理のテスト安定化

**期待効果**:
- テスト実行時間の短縮
- フレーキーテストの削減
- CI/CDの信頼性向上

**工数**: 3-4日

---

### Phase 7: パフォーマンス最適化（優先度: 🟢 低）

#### Task 7.1: メモリ使用量の最適化
**作業内容**:
- [ ] イベントリスナーのリーク調査
- [ ] 不要なキャッシュの削除
- [ ] WeakMapの活用検討

**期待効果**:
- 長時間動作時の安定性向上
- メモリリークの防止

**工数**: 2-3日

---

#### Task 7.2: バンドルサイズの削減
**作業内容**:
- [ ] Tree-shaking最適化
- [ ] 動的importの活用
- [ ] 不要な依存関係の削除

**期待効果**:
- 拡張機能の読み込み速度向上
- ストレージ容量の削減

**工数**: 2-3日

---

## 📅 実施スケジュール

### タイムライン（目安）

| Phase | タスク | 工数 | 累計工数 |
|-------|--------|------|---------|
| Phase 1 | 基盤整備 | 5-7日 | 5-7日 |
| Phase 2 | service.tsリファクタリング | 12-15日 | 17-22日 |
| Phase 3 | tabManager.tsリファクタリング | 12-15日 | 29-37日 |
| Phase 4 | ttsEngine.tsリファクタリング | 6-8日 | 35-45日 |
| Phase 5 | UI層リファクタリング | 6-8日 | 41-53日 |
| Phase 6 | テスト強化 | 8-10日 | 49-63日 |
| Phase 7 | パフォーマンス最適化 | 4-6日 | 53-69日 |

**合計工数**: 約53-69日（約2.5-3.5ヶ月）

### マイルストーン

- **M1 (Phase 1完了)**: 基盤整備完了、共通インターフェース確立
- **M2 (Phase 2-3完了)**: コア処理のリファクタリング完了
- **M3 (Phase 4-5完了)**: 全モジュールのリファクタリング完了
- **M4 (Phase 6-7完了)**: テスト・最適化完了、リリース準備

---

## ⚠️ リスクと対策

### リスク1: 既存機能の破壊
**対策**:
- 各Phaseごとに全テストを実行
- リグレッションテストの追加
- 段階的なリファクタリング（Big Bang禁止）

### リスク2: スケジュール遅延
**対策**:
- Phaseごとの完了判定基準明確化
- 週次レビューでの進捗確認
- 優先度の再評価と調整

### リスク3: ユーザーデータの互換性問題
**対策**:
- マイグレーションスクリプトの作成
- バージョン管理の強化
- ロールバック手順の確立

### リスク4: パフォーマンス低下
**対策**:
- ベンチマークテストの実施
- プロファイリングツールの活用
- パフォーマンス閾値の設定

---

## 🎯 成功基準

### 定量的指標
- ✅ テストカバレッジ 75%以上
- ✅ 最大ファイル行数 600行以下
- ✅ 平均ファイル行数 300行以下
- ✅ 全テスト成功率 100%
- ✅ ビルド時間 現状維持（±10%）
- ✅ メモリ使用量 現状維持（±10%）

### 定性的指標
- ✅ 新機能追加の工数が50%削減
- ✅ バグ修正の平均時間が30%削減
- ✅ コードレビュー時間が40%削減
- ✅ 新規開発者のオンボーディング時間が50%削減

---

## 📝 実施ガイドライン

### 開発プロセス
1. **計画**: 各タスクの詳細設計を作成
2. **テスト先行**: TDDアプローチを採用
3. **レビュー**: コードレビュー必須
4. **ドキュメント**: CLAUDE.md、README.mdの更新

### コーディング規約
- TypeScript strict mode必須
- ESLint/Prettierの遵守
- JSDocコメントの記述
- 単一責任の原則の厳守

### Git戦略
- Feature branchで開発
- Phase単位でPull Request作成
- Squash mergeでコミット整理
- タグ付けでマイルストーン管理

---

## 🔄 レビュー・更新プロセス

### 週次レビュー
- 進捗状況の確認
- ブロッカーの特定と解消
- 優先度の再評価

### Phase完了レビュー
- 成功基準の達成確認
- 次Phaseへの影響評価
- ドキュメントの更新

### 計画の更新
- 実績工数の記録
- 新規課題の追加
- スケジュールの調整

---

## 📚 参考資料

### 関連ドキュメント
- [CLAUDE.md](./CLAUDE.md) - プロジェクトアーキテクチャ
- [PLAN.md](./PLAN.md) - OpenRouterプロバイダルーティング実装計画
- [README.md](./README.md) - プロジェクト概要

### 技術参考
- Clean Architecture（Robert C. Martin）
- Refactoring（Martin Fowler）
- Test-Driven Development（Kent Beck）
- SOLID原則

---

## 付録

### A. 新規ディレクトリ構造（提案）

```
src/
├── background/
│   ├── messaging/              # 新規: メッセージハンドリング
│   │   ├── MessageRouter.ts
│   │   └── handlers/
│   │       ├── QueueMessageHandler.ts
│   │       ├── TTSMessageHandler.ts
│   │       ├── AIMessageHandler.ts
│   │       └── SettingsMessageHandler.ts
│   ├── queue/                  # 新規: キュー管理
│   │   ├── QueueState.ts
│   │   ├── QueueEventEmitter.ts
│   │   └── QueueRepository.ts
│   ├── tts/                    # 新規: TTS処理
│   │   ├── ChunkPlayer.ts
│   │   ├── ChunkTransitionStrategy.ts
│   │   └── VoiceManager.ts
│   ├── content/                # 新規: コンテンツ取得
│   │   ├── ContentResolver.ts
│   │   └── ContentFetcher.ts
│   ├── keepalive/              # 改善: Keep-alive管理
│   │   ├── KeepAliveStrategy.ts
│   │   ├── ChromeKeepAlive.ts
│   │   └── FirefoxKeepAlive.ts
│   ├── offscreen/
│   │   └── OffscreenManager.ts # 新規
│   ├── service.ts              # リファクタリング後（約300行）
│   ├── tabManager.ts           # リファクタリング後（約400行）
│   └── ttsEngine.ts            # リファクタリング後（約500行）
├── shared/
│   ├── types/
│   │   ├── messaging.ts        # 新規
│   │   └── ...
│   └── utils/
│       ├── errorHandler.ts     # 新規
│       └── logger.ts           # 新規
├── tests/
│   └── mocks/                  # 新規: テスト用モック
│       ├── mockBrowser.ts
│       ├── mockStorage.ts
│       └── mockSpeechSynthesis.ts
└── ...
```

### B. 破壊的変更の一覧

現時点で破壊的変更は**なし**。全ての変更は内部実装の改善であり、外部APIは維持されます。

---

**策定者**: Claude (AI Assistant)  
**最終更新**: 2025-10-28
