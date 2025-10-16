# title: TTSチャンク間の音切れ（プツッという音）の完全解消 - RxJS Observable化による根本的改善

## 概要
- read-aloudの実装を調査した結果、RxJS Observableによる宣言的なアーキテクチャが音切れ解消の鍵であることが判明
- 現在のイベントドリブンアーキテクチャでは、`onend`内の処理が重く、状態管理が分散し、競合状態が発生
- チャンク切り替え部分をObservable化することで、read-aloudと同等の完全なギャップレス再生を実現する

### goal
- ユーザーが長文を読み上げる際、チャンク切り替え時に音切れ（プツッという音）が一切聞こえない、スムーズで自然な読み上げ体験を提供する

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること

## 開発のゴール
- read-aloud (https://github.com/ken107/read-aloud) と同等の完全なギャップレス音声再生を実現する
- チャンク切り替え時の音切れを完全に解消する
- Web Speech APIの15秒タイムアウト制約を守りつつ、最適なチャンクサイズを実現する

## read-aloudの調査結果

### 重要な発見

#### 1. WebSpeechEngineにはprefetchメソッドが存在しない
- 事前準備は一切していない
- 毎回`new SpeechSynthesisUtterance()`を作成
- オーバーラップキューイングもしていない
- **結論**: process1-3（prefetch）とprocess6（オーバーラップキューイング）は不要、むしろ有害な可能性

#### 2. RxJS Observableによる宣言的アーキテクチャ
read-aloudが音切れを解消できている理由は以下の通り：

##### a. onend内の処理が最小限
```javascript
utterance.onend = onEvent.bind(null, {type: 'end', charIndex: text.length});
```
- イベントを通知するだけ（同期的）
- 重い処理は一切ない

##### b. Observable連鎖による即座の遷移
```javascript
// イベント受信後の処理
if (event.type == "end") {
  if (!piperState) {
    cmd$.next({name: "forward"})  // ← 同期的にストリームへ通知
  }
}
```
- `cmd$`（Subject）に即座に通知
- パイプラインが自動的に次を処理

##### c. switchMapによる競合状態の排除
```javascript
cmd$.pipe(
  scan((current, cmd) => { /* 状態管理 */ }),
  switchMap(x => x.playback$)  // ← 前のObservableを自動キャンセル
)
```
- 新しいチャンク開始時に前のObservableを自動キャンセル
- 前のチャンクのイベントが次のチャンクと干渉しない

##### d. 自動再生時はdebounceをスキップ
```javascript
debounce(x => x.delay ? rxjs.timer(x.delay) : rxjs.of(0))
```
- `cmd$.next({name: "forward"})`時に`delay`プロパティを指定しない
- `rxjs.of(0)`により即座に次へ遷移
- **ほぼ同期的な処理**

#### 3. 単一utteranceのみ保持
```javascript
this.speak = function(text, options, onEvent) {
  utter = new SpeechSynthesisUtterance();
  // ... 設定 ...
  speechSynthesis.speak(utter);
}
```
- 複数のutteranceを保持しない
- `speak()`呼び出しごとに新規作成
- シンプルで予測可能

### 現在の実装（process1-7）の根本的な問題

#### ❌ process1-3（Prefetch）の問題
- **問題1**: utteranceを事前作成してもWeb Speech APIは初期化しない
- **問題2**: `speak()`が呼ばれた時点で初期化開始
- **問題3**: イベントを事前バインドすることで予期しない動作を引き起こす可能性
- **結論**: prefetchしても初期化遅延は避けられず、逆に複雑化

#### ❌ process6（オーバーラップキューイング）の問題
- **問題1**: 50%時点で既にイベントバインド済みのutteranceをキューに入れる
- **問題2**: Web Speech APIがこれを正しく処理できない可能性
- **問題3**: `onstart`, `onboundary`が予期しないタイミングで発火
- **問題4**: 状態の不整合、重複再生、音切れが発生
- **結論**: Web Speech APIの自然な動作に反する

#### ❌ イベントドリブンアーキテクチャの限界
1. **状態が分散**: `isPaused`, `nextChunkInfo`, `nextChunkQueued`等が各所に散在
2. **非同期処理の遅延**: `onend`内の`playNextChunk()`が遅い
3. **競合状態**: 前のチャンクのイベントと次のチャンクが干渉
4. **複雑な制御フロー**: prefetch→キューイング→フォールバックの分岐が多い

## 実装仕様

### Phase 1: 最小限のObservable導入（推奨アプローチ）

#### 目標
イベントドリブンを保ちつつ、チャンク切り替え部分だけをObservable化することで、小さな変更で大きな効果を得る。

#### 主要な変更点

##### 1. チャンク切り替え用のSubjectを導入
```typescript
private chunkTransition$ = new Subject<'next' | 'complete'>();
```

##### 2. onend内を最小化（read-aloud方式）
```typescript
utterance.onend = () => {
  this.lastChunkEndTime = Date.now();
  if (hooks.onProgress) hooks.onProgress(100);

  if (!this.isPaused) {
    // 即座にSubjectへ通知（同期的）
    this.chunkTransition$.next('next');
  }
};
```

##### 3. Observable連鎖で次を処理
```typescript
this.chunkTransition$.pipe(
  // 状態更新（同期的）
  tap(() => {
    this.currentChunkIndex++;
  }),
  // 次のチャンクが存在するか確認
  filter(() => this.currentChunkIndex < this.chunks.length),
  // 新しいutteranceを作成・再生（前の処理を自動キャンセル）
  switchMap(() => {
    const chunk = this.chunks[this.currentChunkIndex];
    const utterance = this.createUtteranceFn();
    utterance.text = chunk.text;
    this.applySettings(utterance);
    this.bindUtteranceEvents(utterance, hooks, chunk);

    // speak()を即座に呼ぶ
    this.speech.speak(utterance);

    return of(utterance);
  }),
  // エラーハンドリング
  catchError((error) => {
    this.logger.error('[TTSEngine] Chunk transition failed', error);
    hooks.onError(error);
    return EMPTY;
  })
).subscribe();
```

##### 4. 削除するもの
- ❌ `nextChunkInfo`構造体
- ❌ `nextChunkQueued`フラグ
- ❌ `prepareNextChunk()`メソッド
- ❌ `bindUtteranceEventsForPrefetchedChunk()`メソッド
- ❌ `onstart`でのprefetch呼び出し
- ❌ `onboundary`内の50%キューイング
- ❌ `onend`内の複雑な分岐（キュー済み/未キュー/フォールバック）

##### 5. 保持するもの
- ✅ チャンク分割ロジック（これは有効）
- ✅ 動的チャンクサイズ計算（process4）
- ✅ パフォーマンス計測（process7）
- ✅ エラーハンドリングとリトライ
- ✅ `bindUtteranceEvents()`（シンプル版）

#### 利点
- ✅ `onend`内が軽量化（ギャップ削減）
- ✅ `switchMap`で競合状態を排除
- ✅ 既存コードの大部分を保持
- ✅ 段階的な移行が可能
- ✅ read-aloudの実績ある方式に近づく

### Phase 2: read-aloud完全移行（将来的な選択肢）

#### 目標
read-aloudと同じRxJS中心のアーキテクチャに完全移行し、状態管理を完全に一元化する。

#### 実装内容

##### 1. コマンドストリーム導入
```typescript
private cmd$ = new Subject<Command>();

type Command =
  | { name: 'start'; text: string }
  | { name: 'pause' }
  | { name: 'resume' }
  | { name: 'stop' }
  | { name: 'forward' }
  | { name: 'backward' };
```

##### 2. 状態管理をscan()で一元化
```typescript
cmd$.pipe(
  scan((state, cmd) => {
    // 全ての状態遷移をここで管理
    switch (cmd.name) {
      case 'start':
        return { ...state, status: 'playing', chunkIndex: 0 };
      case 'forward':
        return { ...state, chunkIndex: state.chunkIndex + 1 };
      // ...
    }
  }, initialState),
  switchMap(state => this.createPlayback(state)),
  subscribe(/* ... */)
)
```

##### 3. prefetch/キューイングを削除
- シンプルな方式に戻す
- Observableの連鎖で十分高速

#### 利点
- ✅ read-aloudの実績ある方式
- ✅ 状態管理が完全に一元化
- ✅ 宣言的で保守しやすい
- ✅ テストが書きやすい

#### デメリット
- ❌ 大規模なリファクタリングが必要
- ❌ 既存のテストを大幅に書き換える必要がある
- ❌ RxJSの依存関係追加

## 生成AIの学習用コンテキスト

### 実装ファイル
- src/background/ttsEngine.ts
  - TTSEngineクラス：Web Speech APIを使用した音声合成エンジン
  - 現在の実装: イベントドリブン + prefetch + オーバーラップキューイング
  - 変更予定: Observable化によるシンプルな実装

### テストファイル
- src/background/__tests__/ttsEngine.test.ts
  - TTSEngineの単体テスト
  - 現在: 31テスト（process1-7の実装をテスト）
  - 変更予定: Observable連鎖のテスト追加

### 参考実装
- https://github.com/ken107/read-aloud
  - js/speech.js: RxJSベースの状態管理とチャンク切り替え
    - `cmd$`, `playbackState$`, `scan()`, `switchMap()`, `debounce()`の使い方
    - `onend` → `cmd$.next({name: "forward"})` → 即座の遷移
  - js/tts-engines.js: WebSpeechEngineの実装
    - prefetchメソッドが存在しないこと
    - 単一utteranceのシンプルな管理
    - イベントハンドラーが最小限

## Process

### process1 チャンク切り替えObservable化の準備
@target: src/background/ttsEngine.ts
@ref: https://github.com/ken107/read-aloud/blob/master/js/speech.js

- [ ] RxJS依存関係の追加
  - `package.json`に`rxjs`を追加
  - 必要な型定義のインポート
- [ ] `chunkTransition$: Subject<'next' | 'complete'>`フィールドを追加
- [ ] `subscription: Subscription | null`フィールドを追加（購読管理用）
- [ ] 型チェック実施: `npm run typecheck`
- [ ] テスト実施: `npm test`

### process2 onendハンドラーの最小化（read-aloud方式）
@target: src/background/ttsEngine.ts

- [ ] `bindUtteranceEvents()`メソッドの`onend`を最小化
  ```typescript
  utterance.onend = () => {
    this.lastChunkEndTime = Date.now();
    if (hooks.onProgress) hooks.onProgress(100);

    if (!this.isPaused) {
      // 即座にSubjectへ通知（同期的）
      if (this.currentChunkIndex + 1 < this.chunks.length) {
        this.chunkTransition$.next('next');
      } else {
        this.chunkTransition$.next('complete');
      }
    }
  };
  ```
- [ ] 既存の複雑な分岐（キュー済み/未キュー/フォールバック）を削除
- [ ] 型チェック実施: `npm run typecheck`
- [ ] テスト実施: `npm test`

### process3 Observable連鎖による次チャンク再生
@target: src/background/ttsEngine.ts

- [ ] `setupChunkTransitionPipeline()`メソッドを作成
  ```typescript
  private setupChunkTransitionPipeline(hooks: PlaybackHooks): void {
    this.subscription = this.chunkTransition$.pipe(
      tap((event) => {
        if (event === 'next') {
          this.currentChunkIndex++;
          this.logger.info(`[TTSEngine] Transitioning to chunk ${this.currentChunkIndex + 1}/${this.chunks.length}`);
        } else if (event === 'complete') {
          this.logger.info('[TTSEngine] All chunks completed');
          this.cleanup();
          if (hooks.onComplete) hooks.onComplete();
        }
      }),
      filter((event) => event === 'next'),
      filter(() => this.currentChunkIndex < this.chunks.length),
      switchMap(() => {
        // 新しいutteranceを作成
        const chunk = this.chunks[this.currentChunkIndex];
        const utterance = this.createUtteranceFn();
        utterance.text = chunk.text;
        this.applySettings(utterance);
        this.bindUtteranceEvents(utterance, hooks, chunk);

        // 状態更新
        this.utterance = utterance;
        this.currentText = chunk.text;
        this.chunkRetryCount = 0;

        // speak()を即座に呼ぶ
        this.speech.speak(utterance);

        return of(utterance);
      }),
      catchError((error) => {
        this.logger.error('[TTSEngine] Chunk transition failed', error);
        hooks.onError(error instanceof Error ? error : new Error(String(error)));
        return EMPTY;
      })
    ).subscribe();
  }
  ```
- [ ] `start()`メソッドで`setupChunkTransitionPipeline()`を呼び出す
- [ ] 型チェック実施: `npm run typecheck`
- [ ] テスト実施: `npm test`

### process4 不要なコードの削除
@target: src/background/ttsEngine.ts

- [ ] `nextChunkInfo`フィールドを削除
- [ ] `nextChunkQueued`フィールドを削除
- [ ] `prepareNextChunk()`メソッドを削除
- [ ] `bindUtteranceEventsForPrefetchedChunk()`メソッドを削除
- [ ] `onstart`内のprefetch呼び出しを削除
- [ ] `onboundary`内の50%キューイングロジックを削除
- [ ] 型チェック実施: `npm run typecheck`
- [ ] テスト実施: `npm test`

### process5 cleanup処理の更新
@target: src/background/ttsEngine.ts

- [ ] `cleanup()`メソッドで`chunkTransition$`の購読を解除
  ```typescript
  cleanup(): void {
    // Observableの購読を解除
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    // 既存のcleanup処理
    // ...
  }
  ```
- [ ] `pause()`メソッドでも購読を解除（必要に応じて）
- [ ] 型チェック実施: `npm run typecheck`
- [ ] テスト実施: `npm test`

### process6 動的チャンクサイズの保持
@target: src/background/ttsEngine.ts

- [ ] process4で実装した動的チャンクサイズ計算を維持
  ```typescript
  const safeReadingTime = 12; // 安全マージン
  const charsPerSecond = 5;
  const maxChunkSize = Math.floor(safeReadingTime * charsPerSecond * settings.rate);
  ```
- [ ] これはread-aloudにも存在する有効な最適化
- [ ] 型チェック実施: `npm run typecheck`
- [ ] テスト実施: `npm test`

### process7 パフォーマンス計測の保持
@target: src/background/ttsEngine.ts

- [ ] `lastChunkEndTime`を使ったギャップ時間計測を維持
- [ ] `onstart`内でのログ出力を維持
  ```typescript
  utterance.onstart = () => {
    if (this.lastChunkEndTime > 0) {
      const gap = Date.now() - this.lastChunkEndTime;
      this.logger.info(`[TTSEngine] Chunk transition gap: ${gap}ms`);
    }
    // ...
  };
  ```
- [ ] 型チェック実施: `npm run typecheck`
- [ ] テスト実施: `npm test`

### process10 ユニットテスト

@target: src/background/__tests__/ttsEngine.test.ts

- [ ] Observable連鎖のテスト
  - `chunkTransition$.next('next')`が呼ばれることを確認
  - `switchMap`により次のチャンクが再生されることを確認
  - 前のチャンクの処理が自動キャンセルされることを確認
- [ ] `onend`の最小化テスト
  - `onend`内で重い処理が実行されないことを確認
  - Subjectへの通知のみが実行されることを確認
- [ ] cleanup処理のテスト
  - 購読が正しく解除されることを確認
- [ ] 既存のテストの修正
  - process1-3（prefetch）のテストを削除
  - process6（オーバーラップキューイング）のテストを削除
  - 動的チャンクサイズ（process4）のテストは維持
  - パフォーマンス計測（process7）のテストは維持
- [ ] 型チェック実施: `npm run typecheck`
- [ ] テスト実施: `npm test`

### process50 フォローアップ

#### Phase 2への移行検討
- [ ] Phase 1の効果を測定
  - ギャップ時間が50ms以下になったか確認
  - 音切れが解消されたか確認
- [ ] Phase 1で不十分な場合のみPhase 2を検討
  - 完全なRxJS中心アーキテクチャへの移行
  - `cmd$`, `scan()`, `debounce()`の導入

#### 追加最適化の検討
- [ ] read-aloudの他の最適化手法を調査
  - タイミング計算による予測（`nextStartTime = Date.now() + 650 / options.rate`）
  - より高度なObservableパターン
- [ ] 型チェック実施: `npm run typecheck`
- [ ] テスト実施: `npm test`

### process100 リファクタリング

- [ ] `bindUtteranceEvents()`のシンプル化
  - prefetch関連のロジックを削除したシンプル版に戻す
- [ ] 状態管理の整理
  - 不要になったフィールドの完全削除
  - Observable連鎖に関連する状態のみを保持
- [ ] ログ出力の整理
  - Observable連鎖に関連するログを追加
  - 不要になったprefetch関連のログを削除
- [ ] 型チェック実施: `npm run typecheck`
- [ ] テスト実施: `npm test`

### process200 ドキュメンテーション

- [ ] CLAUDE.mdに音切れ対策の実装方針を追記
  - RxJS Observable化の理由と利点
  - read-aloudのアーキテクチャ分析結果
  - Phase 1とPhase 2の違い
- [ ] ttsEngine.tsのコメントを更新
  - Observable連鎖の詳細な説明
  - `chunkTransition$`の役割を明記
  - `switchMap`による競合状態排除の説明
- [ ] PLAN.mdの更新
  - 実装完了後の結果を記録
  - ギャップ時間の測定結果を記録
  - 今後の改善案を記録
- [ ] 型チェック実施: `npm run typecheck`
- [ ] テスト実施: `npm test`
