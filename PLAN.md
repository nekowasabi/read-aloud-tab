# title: textChunker の startOffset 計算バグ修正

## 概要
- 記事の読み上げが途中で終わってしまう問題を解決する
- テキストチャンキング時の offset 計算ロジックを修正し、全文が正確に読み上げられるようにする

### goal
- ユーザーが長文記事を読み上げ機能で利用する際、最後まで途切れることなく読み上げが完了する

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること

## 開発のゴール
- textChunker.ts の startOffset 計算バグを修正し、チャンク分割が正確に行われるようにする
- テストを追加して offset 計算の正確性を保証する
- 実際の長文記事で最後まで読み上げが完了することを確認する

## 実装仕様

### 問題の詳細
**src/shared/utils/textChunker.ts:123-124** に startOffset 計算のバグが存在する:

```typescript
// 現在のバグコード（間違い）
currentChunk = sentence;
currentStartOffset += currentChunk.length;  // 新しいsentenceの長さを足している
```

このコードでは、**新しいチャンク（sentence）の長さ**を offset に足してしまっており、**前のチャンクの長さ**が考慮されていない。

### 影響
1. **offsetのずれ**: 各チャンクの startOffset/endOffset が実際のテキスト位置とずれる
2. **進捗計算の誤り**: onboundary イベントでの currentPosition 計算が狂う
3. **読み上げ範囲の不足**: チャンクが元のテキスト全体をカバーしきれず、途中で終わる

### 修正方針（Option A）
順序を修正する:
```typescript
// 正しいコード
currentStartOffset += currentChunk.length;  // 先に前のチャンクの長さを足す
currentChunk = sentence;  // その後、新しいチャンクを開始
```

### 具体例
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

## 生成AIの学習用コンテキスト
### 実装対象ファイル
- src/shared/utils/textChunker.ts
  - chunkText 関数の startOffset 計算ロジック

### テストファイル
- src/shared/utils/__tests__/textChunker.test.ts
  - offset 計算の正確性を検証するテストを新規作成

### 参照ファイル
- src/background/ttsEngine.ts
  - チャンキング機能の利用箇所
  - offset を使った進捗計算ロジック

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

### process50 フォローアップ

### process100 リファクタリング

### process200 ドキュメンテーション
- [x] PLAN.md の作成（本ファイル）
- [ ] 修正内容をコミットメッセージに記載
