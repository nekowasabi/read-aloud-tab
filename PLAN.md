# title: TTSチャンク間の音切れ（プツッという音）の完全解消

## 概要
- read-aloudの実装を調査し、Web Speech APIによるチャンク間の完全なギャップレス再生を実現する

### goal
- ユーザーが長文を読み上げる際、チャンク切り替え時に音切れ（プツッという音）が一切聞こえない、スムーズで自然な読み上げ体験を提供する

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること

## 開発のゴール
- read-aloud (https://github.com/ken107/read-aloud) と同等の完全なギャップレス音声再生を実現する
- チャンク切り替え時の音切れを完全に解消する
- Web Speech APIの15秒タイムアウト制約を守りつつ、最適なチャンクサイズを実現する

## 実装仕様

### read-aloudの調査結果

#### 成功要因1: 即座のPrefetch
- **タイミング**: `onstart`イベント時に次のチャンクをprefetch
- **効果**: チャンク開始直後から次の準備を開始し、十分な準備時間を確保
- **コード例**:
  ```javascript
  utterance.onstart = () => {
    if (nextText && engine.prefetch != null)
      engine.prefetch(nextText, options)
  }
  ```

#### 成功要因2: RxJS Observableによる宣言的な連鎖
- イベントドリブンではなく、Observable連鎖で管理
- `onend` → `cmd$.next({name: "forward"})` → 即座に次を再生
- `switchMap`や`concatMap`で非同期処理を連鎖

#### 成功要因3: タイミング計算による予測
- `nextStartTime = Date.now() + 650 / options.rate`
- チャンク間の遅延を予測計算して管理

#### 成功要因4: Prefetchキャッシュ
- `prefetchAudio = [utterance, options, url]`
- 準備済みのUtteranceをキャッシュし、即座に利用可能な状態を維持

### 現在の実装の問題点

#### 問題1: Prefetchタイミングが遅すぎる
- **現状**: `onboundary`の80%時点で準備開始
- **問題**: 準備完了までに時間が足りず、`onend`時に未準備の可能性
- **影響**: フォールバックの非同期処理により音切れ発生

#### 問題2: onend内の処理が重すぎる
- **現状**: `onend`内で`bindUtteranceEventsForChunk()`を実行 (ttsEngine.ts:486)
- **問題**: イベントバインディング処理中にギャップ発生
- **影響**: 数十〜数百ミリ秒の遅延が「プツッ」という音として聞こえる

#### 問題3: イベントバインディングの順序
- **現状**: `speak()`の直前にイベントをバインド
- **リスク**: タイミングによってはイベントが失われる可能性

#### 問題4: チャンクサイズが小さい
- **現状**: 80文字（rate 1.0で13-16秒）
- **問題**: 切り替え頻度が高く、わずかなギャップでも目立つ

## 生成AIの学習用コンテキスト
### 実装ファイル
- src/background/ttsEngine.ts
  - TTSEngineクラス：Web Speech APIを使用した音声合成エンジン
  - 特に注目: `prepareNextChunk()`, `bindUtteranceEventsForChunk()`, `playChunkAt()`

### 参考実装
- https://github.com/ken107/read-aloud
  - js/speech.js: RxJSベースの状態管理とprefetch機構
  - js/tts-engines.js: 各種TTSエンジンの実装とprefetchメソッド

## Process

### process1 Prefetchタイミングをonstartに変更
@target: src/background/ttsEngine.ts
@ref: https://github.com/ken107/read-aloud/blob/master/js/speech.js

- [ ] `bindUtteranceEventsForChunk()`の`onstart`ハンドラーに次チャンクのprefetch処理を追加
  - 現在の`onboundary`での80%判定を`onstart`に移動
  - チャンク開始直後（最初の`onstart`発火時）に次のチャンクを準備開始
- [ ] `onboundary`の80%判定コード（ttsEngine.ts:523-532）を削除
- [ ] `onstart`で`prepareNextChunk(this.currentChunkIndex + 1)`を呼び出す
  - 条件: 次のチャンクが存在し、未準備の場合のみ

### process2 イベントバインディングの事前実行
@target: src/background/ttsEngine.ts

- [ ] `prepareNextChunk()`メソッドを拡張
  - Utterance作成・設定適用に加えて、イベントバインディングも事前実行
  - 新規メソッド`bindPreparedUtteranceEvents()`を作成
- [ ] 準備済みUtteranceには既にイベントがバインド済みの状態を保持
  - `nextUtterance`と共に`nextChunk`情報も保持する必要がある
  - `private nextChunkInfo: {utterance: SpeechSynthesisUtterance, chunk: TextChunk} | null`

### process3 onendハンドラーの最小化
@target: src/background/ttsEngine.ts

- [ ] `onend`内の処理を最小限に削減
  ```typescript
  utterance.onend = () => {
    if (!this.isPaused && this.nextChunkInfo) {
      // 状態更新のみ（同期処理）
      this.currentChunkIndex++;
      this.utterance = this.nextChunkInfo.utterance;
      this.currentText = this.nextChunkInfo.chunk.text;
      const preparedInfo = this.nextChunkInfo;
      this.nextChunkInfo = null;
      this.chunkRetryCount = 0;

      // 即座に再生（イベントは既にバインド済み）
      this.speech.speak(preparedInfo.utterance);
    } else if (!this.nextChunkInfo) {
      // フォールバック
      this.playNextChunk().catch(...);
    }
  }
  ```
- [ ] 進捗100%通知はprefetch側で処理

### process4 チャンクサイズの最適化
@target: src/background/ttsEngine.ts

- [ ] `maxChunkSize: 80` → `120` に変更
  - rate 1.0: 120文字 ÷ 5文字/秒 = 24秒（危険）
  - rate 1.2: 120文字 ÷ 6文字/秒 = 20秒（危険）
  - rate 1.5: 120文字 ÷ 7.5文字/秒 = 16秒（許容範囲）
- [ ] または動的サイズ計算を導入
  ```typescript
  const safeReadingTime = 12; // 安全マージン
  const charsPerSecond = 5;
  const maxChunkSize = Math.floor(safeReadingTime * charsPerSecond * settings.rate);
  // rate 1.0 → 60文字
  // rate 1.5 → 90文字
  // rate 2.0 → 120文字
  ```

### process5 準備状態の管理改善
@target: src/background/ttsEngine.ts

- [ ] `nextUtterance`を`nextChunkInfo`に置き換え
  ```typescript
  private nextChunkInfo: {
    utterance: SpeechSynthesisUtterance;
    chunk: TextChunk;
    index: number;
  } | null = null;
  ```
- [ ] `cleanup()`で`nextChunkInfo`をクリア
- [ ] `pause()`時も`nextChunkInfo`をクリア（再開時に再準備）

### process10 ユニットテスト

@target: src/background/__tests__/ttsEngine.test.ts

- [ ] `onstart`でのprefetch動作をテスト
  - 最初のチャンクの`onstart`で2番目のチャンクが準備されることを確認
- [ ] 準備済みUtteranceでの即座の再生をテスト
  - `onend`から次の`speak()`までの時間が最小化されることを確認
- [ ] フォールバック動作のテスト
  - 準備が間に合わなかった場合の動作確認
- [ ] 動的チャンクサイズのテスト（実装する場合）
  - 各rateでのチャンクサイズが適切であることを確認

### process50 フォローアップ

#### 追加調査: RxJS導入の検討
- read-aloudのようなObservableベースのアーキテクチャへの移行を検討
- イベントドリブンからストリーム処理への段階的な移行計画
- メリット: より宣言的で、タイミング制御が容易
- デメリット: 大規模なリファクタリングが必要

#### パフォーマンス測定
- チャンク間のギャップ時間を計測するメトリクス追加
- `onend`発火から次の`onstart`までの時間をログ出力
- 目標: 50ms以下（人間が知覚できない範囲）

### process100 リファクタリング

- [ ] `bindUtteranceEventsForChunk()`を分割
  - 共通イベント処理
  - チャンク固有の処理
- [ ] prefetch関連のロジックを独立したメソッドに抽出
  - `shouldPrefetchNext()`: prefetchが必要かどうかの判定
  - `getPrefetchIndex()`: 次のprefetch対象インデックスを取得

### process200 ドキュメンテーション

- [ ] CLAUDE.mdに音切れ対策の実装方針を追記
  - Prefetchのタイミング戦略
  - イベントバインディングのベストプラクティス
- [ ] ttsEngine.tsのコメントを更新
  - `prepareNextChunk()`の詳細な説明
  - `onstart`でのprefetch理由を明記
- [ ] パフォーマンス特性をドキュメント化
  - チャンクサイズとrate設定の関係
  - タイムアウトリスクの説明

