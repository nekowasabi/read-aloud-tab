# title: 読み上げ機能の完全性確保（チャンク計算と進捗管理の修正）

## 概要
- 記事の読み上げが途中で終わる問題と、進捗が早期に100%になり次のタブに切り替わる問題を解決する
- テキストチャンキングの offset 計算バグを修正し、進捗計算を実際の音声完了と同期させる

### goal
- ユーザーが長文記事を読み上げ機能で利用する際、最後まで途切れることなく読み上げが完了する
- 進捗バーが実際の音声再生と同期し、音声完了前に次のタブに切り替わらない

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること

## 開発のゴール
- textChunker.ts の startOffset 計算バグを修正し、チャンク分割が正確に行われるようにする
- TTSEngine の進捗計算を修正し、音声再生完了まで100%に到達しないようにする
- テストを追加して offset 計算と進捗計算の正確性を保証する
- 実際の長文記事で最後まで読み上げが完了し、適切なタイミングで次のタブに移行することを確認する

## 実装仕様

### 問題1: textChunker の startOffset 計算バグ
**src/shared/utils/textChunker.ts:123-124** に startOffset 計算のバグが存在する:

```typescript
// 現在のバグコード（間違い）
currentChunk = sentence;
currentStartOffset += currentChunk.length;  // 新しいsentenceの長さを足している
```

このコードでは、**新しいチャンク（sentence）の長さ**を offset に足してしまっており、**前のチャンクの長さ**が考慮されていない。

#### 影響
1. **offsetのずれ**: 各チャンクの startOffset/endOffset が実際のテキスト位置とずれる
2. **進捗計算の誤り**: onboundary イベントでの currentPosition 計算が狂う
3. **読み上げ範囲の不足**: チャンクが元のテキスト全体をカバーしきれず、途中で終わる

#### 修正方針（Option A）
順序を修正する:
```typescript
// 正しいコード
currentStartOffset += currentChunk.length;  // 先に前のチャンクの長さを足す
currentChunk = sentence;  // その後、新しいチャンクを開始
```

#### 具体例
テキスト: "こんにちは。これはテストです。さようなら。" (45文字)
maxChunkSize=15 の場合：

**修正前（間違い）:**
- chunk 0: startOffset=0, endOffset=7, text="こんにちは。"
- 次の currentStartOffset = 0 + **10** = 10 ← 間違い（sentenceの長さ）
- chunk 1: startOffset=**10**, endOffset=20 ← ずれている

**修正後（正しい）:**
- chunk 0: startOffset=0, endOffset=7, text="こんにちは。"
- 次の currentStartOffset = 0 + **7** = 7 ✓（前のchunkの長さ）
- chunk 1: startOffset=**7**, endOffset=17 ✓ 正確

### 問題2: 進捗計算の早期100%到達
**src/background/ttsEngine.ts** の進捗計算において、`onboundary` イベントが音声再生前に発火するため、進捗が実際の音声完了より早く100%に達する問題が存在する。

#### タイムライン
```
1. テキスト: "これはテストです。" (最後のチャンク)
2. onboundary (最後の文字) 発火 → progress = 100% 🚨
3. UI が「完了」と判断 → 次のタブに切り替え
4. [2-3秒の遅延]
5. "です。" の音声再生が完了
6. onend 発火 → playNextChunk() 呼び出し
   しかし既にUIは次のタブに移動済み
```

#### 影響
1. **音声の途切れ**: 最後の数秒が再生される前に次のタブに切り替わる
2. **UX の低下**: ユーザーが完全に聞き終わる前に内容が変わる
3. **進捗の不正確さ**: 進捗バーが実際の再生状態を反映していない

#### 修正方針（Option A）
進捗を99%でキャップし、`onend` で確実に100%にする:

```typescript
// calculateProgress() の修正
private calculateProgress(): number {
  if (this.totalLength === 0) {
    return 0;
  }
  const ratio = this.currentPosition / this.totalLength;
  // 99%でキャップ（onend で100%にする）
  return Math.max(0, Math.min(99, ratio * 100));
}

// bindUtteranceEventsForChunk() の修正
utterance.onend = () => {
  if (!this.isPaused) {
    // 完了時に明示的に100%を通知
    if (this.currentHooks?.onProgress) {
      this.currentHooks.onProgress(100);
    }
    // その後、次のチャンクへ移動
    this.playNextChunk().catch(...);
  }
};
```

#### 他の選択肢
- **Option B**: 最後のチャンクのみ95%でキャップ（より正確だが複雑）
- **Option C**: onboundary の debounce 処理（複雑でメリットが少ない）

## 生成AIの学習用コンテキスト
### 実装対象ファイル
- src/shared/utils/textChunker.ts
  - chunkText 関数の startOffset 計算ロジック
- src/background/ttsEngine.ts
  - calculateProgress メソッドの進捗計算上限
  - bindUtteranceEventsForChunk メソッドの onend ハンドラ

### テストファイル
- src/shared/utils/__tests__/textChunker.test.ts
  - offset 計算の正確性を検証するテスト
- src/background/__tests__/ttsEngine.test.ts
  - 進捗が99%でキャップされることを確認
  - onend で100%になることを確認

### 参照ファイル
- src/background/tabManager.ts
  - handlePlaybackProgress: 進捗受信と次タブへの切り替えロジック
- src/background/offscreen/offscreen.ts
  - TTSEngine の利用箇所

## Process
### process1 textChunker.ts のバグ修正
#### sub1 startOffset 計算順序の修正
@target: src/shared/utils/textChunker.ts
@ref: なし
- [x] 123-124行目の順序を修正
  - `currentStartOffset += currentChunk.length;` を先に実行
  - その後 `currentChunk = sentence;` を実行
  - これにより、前のチャンクの長さが正確に offset に反映される

### process2 包括的なテストの追加
#### sub1 textChunker のユニットテスト作成
@target: src/shared/utils/__tests__/textChunker.test.ts
@ref: src/shared/utils/textChunker.ts
- [x] テストファイルを新規作成
- [x] offset 計算の正確性を検証
  - 各チャンクの startOffset/endOffset が連続していることを確認
  - 全チャンクの endOffset が元のテキスト長と一致することを確認
- [x] エッジケースのテスト
  - 空テキスト
  - 単一チャンク（maxChunkSize 以下）
  - 複数チャンク（長文）
  - 境界条件（ちょうど maxChunkSize）
- [x] チャンクテキストの整合性検証
  - 全チャンクを結合すると元のテキストになることを確認

### process10 ユニットテスト
- process2 で実施済み

### process50 フォローアップ: 進捗計算の修正
#### sub1 進捗計算の99%キャップ実装
@target: src/background/ttsEngine.ts
@ref: なし
- [ ] calculateProgress() メソッドを修正
  - 進捗の上限を99%に変更（100% は onend でのみ到達）
  - 計算ロジック: `Math.min(99, ratio * 100)`

#### sub2 onend での100%進捗通知
@target: src/background/ttsEngine.ts
@ref: なし
- [ ] bindUtteranceEventsForChunk() メソッドの onend ハンドラを修正
  - playNextChunk() の前に `hooks.onProgress(100)` を呼び出し
  - 音声完了時に確実に100%を通知してから次のチャンクへ移行

#### sub3 進捗計算のテスト追加
@target: src/background/__tests__/ttsEngine.test.ts
@ref: src/background/ttsEngine.ts
- [ ] 進捗が99%でキャップされることを確認するテストを追加
- [ ] onend で100%になることを確認するテストを追加
- [ ] 既存テストが引き続きパスすることを確認

### process60 AI要約の途中切れ問題修正
#### sub1 maxSummaryTokens の増加
@target: src/background/tabManager.ts, src/background/aiProcessor.ts
@ref: なし
- [x] maxSummaryTokens を 500 → 1500 に増加（3倍）
  - tabManager.ts (line 128): AiProcessor初期化時の設定
  - aiProcessor.ts (line 36): デフォルト値の変更
  - これにより、要約が最後まで完了する十分な長さを確保

#### sub2 デフォルトプロンプトの改善
@target: src/shared/utils/storage.ts
@ref: なし
- [x] summaryPrompt の改善 (line 31)
  - 完全な要約を保証する指示を追加
  - 構造化された要約フォーマット（キーポイント・詳細・結論）
  - 最後に必ず結論を含めるよう明示的に指示

#### 問題の詳細
デバッグログ解析により判明:
- TTS/チャンキングシステムは完璧に動作（17チャンク全て正常再生）
- 実際の問題: AI要約が途中で切れている（883文字で"...みたいな。"と終了）
- 原因: maxSummaryTokens=500 が小さすぎてトークン制限で打ち切られる
- 影響: ユーザーが記事の全体像を把握できず、読み上げが不自然に終わる

#### 期待される効果
- 要約が最後まで完了する（結論を含む完全な要約）
- ユーザーが記事の全体像を正確に把握できる
- 読み上げが途中で不自然に終わる問題が解消される

### process100 リファクタリング

### process200 ドキュメンテーション
- [x] PLAN.md の作成（本ファイル）
- [ ] 修正内容をコミットメッセージに記載
  - process1-2: "fix(textChunker): correct startOffset calculation in chunk splitting"
  - process50: "fix(tts): cap progress at 99% until audio playback completes"
  - process60: "fix(ai): increase maxSummaryTokens and improve summary prompt for complete summaries"
