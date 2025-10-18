# title: Firefox AMO版での音声・読み上げ停止問題の修正

## 概要
- Firefox版拡張機能をMozilla Add-ons（AMO）経由でインストールした際に、音声が男性になる問題と読み上げが途中で停止する問題を修正し、安定した読み上げ機能を提供する

### goal
- ユーザーがAMOからインストールした拡張機能で、設定した音声（日本語女性音声等）で長文コンテンツを最後まで読み上げられる

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること

## 開発のゴール
- AMO配布版でもabout:debugging版と同等の読み上げ品質を実現する
- Firefoxでの音声リスト取得タイミング問題を解決する
- チャンクサイズの最適化により長文コンテンツの安定読み上げを実現する
- エラーハンドリングを強化し、途中停止を防止する

## 実装仕様

### 問題1: 音声が男性になる
**原因**:
- デフォルト設定が `voice: null` （`src/shared/utils/storage.ts:5-10`）
- Firefoxでの `speechSynthesis.getVoices()` が初回呼び出し時に空配列を返すことがある
- バックグラウンドスクリプト（`src/background/ttsEngine.ts:656-676`）での音声リスト取得タイムアウトが3秒で短い
- AMO版では署名検証等でスクリプト起動が遅延し、音声リスト取得が間に合わない
- AMO版とabout:debugging版は異なる拡張機能IDを持つため、ストレージが完全に分離される

**修正方針**:
- 音声リスト取得タイムアウトを3秒→10秒に延長
- 日本語音声を優先的に選択する初期化ロジックを追加
- 音声リスト取得失敗時のリトライ機構（最大3回）を実装

### 問題2: 読み上げが途中で止まる
**原因**:
- チャンクサイズが小さすぎる（`src/background/ttsEngine.ts:101-107`）
  ```typescript
  const charsPerSecond = 4; // 保守的な読み上げ速度
  const maxChunkSize = Math.floor(8 * 4 * settings.rate);
  // rate 2.5の場合: maxChunkSize = 80文字
  // rate 3.0の場合: maxChunkSize = 96文字
  ```
  - 日本語では80-96文字は2〜3文程度と非常に短い
  - 長いコンテンツで数十〜数百のチャンクが生成され、チャンク遷移でエラーが発生しやすい
- Firefoxでの `speechSynthesis` API動作がChromeと異なる（pause/resume/cancelの動作）
- Observable-basedチャンク遷移（`src/background/ttsEngine.ts:192-196`）で `catchError` が `EMPTY` を返し、エラー発生時に処理が完全停止する
- Web Speech APIの約15秒タイムアウト制限（チャンク計算は8秒で保守的だが、Firefoxでの実際の動作で超過する可能性）

**修正方針**:
- Firefoxでのチャンクサイズを200-300文字に増加（ブラウザ別設定の導入）
- チャンク数の上限設定（最大80チャンク）
- チャンク遷移失敗時のリトライ回数を増加（2回→5回）
- `catchError` で処理停止ではなく次チャンクへスキップする仕組み
- タイムアウト検知と自動リカバリー機能

### AMO配布版とabout:debugging版の違い
| 項目 | about:debugging（開発版） | AMO配布版 |
|------|-------------------------|----------|
| 拡張機能ID | 一時的なID | 固定ID（manifest.jsonで指定） |
| ストレージ | 分離 | 分離 |
| 署名 | 不要 | Mozilla署名あり |
| 起動タイミング | 即座 | 署名検証後（やや遅延） |
| 権限チェック | 緩い | 厳格 |

## 生成AIの学習用コンテキスト

### コア実装ファイル
- `src/background/ttsEngine.ts`
  - TTSエンジンのメイン実装
  - 音声リスト取得ロジック（656-676行目）
  - チャンクサイズ計算ロジック（101-107行目）
  - Observable-basedチャンク遷移（153-198行目）

- `src/shared/utils/browser.ts`
  - ブラウザ判定ロジック（getBrowserType: 177-184行目）
  - 機能サポート判定（isFeatureSupported: 187-199行目）

- `src/shared/utils/storage.ts`
  - デフォルト設定定義（5-10行目）
  - 設定の読み込み・保存処理

- `src/shared/utils/textChunker.ts`
  - テキストチャンク化ユーティリティ
  - チャンク設定のデフォルト値（48-49行目）

### 設定ファイル
- `src/manifest/manifest.firefox.json`
  - Firefox用manifest設定（persistent: true）

## Process

### process1 音声設定の初期化改善

#### sub1 音声リスト取得タイムアウトの延長
@target: `src/background/ttsEngine.ts`
@ref: なし
- [x] `getVoices()` メソッドのタイムアウトを3秒→10秒に変更（定数: VOICES_TIMEOUT_MS = 10000, line 10）
- [x] Firefox向けの追加タイムアウト設定を導入（getVoicesOnce内で実装, lines 705-728）

#### sub2 日本語音声優先選択ロジックの追加
@target: `src/background/ttsEngine.ts`
@ref: `src/popup/components/SettingsPanel.tsx` (63-70行目の日本語音声フィルタリングロジック)
- [x] `applyVoice()` メソッドで音声が見つからない場合に日本語音声を自動選択（lines 386-421）
- [x] 日本語音声のフィルタリングロジックを共通化（isJapaneseVoice: lines 372-379, selectBestJapaneseVoice: lines 382-384）

#### sub3 音声リスト取得リトライ機構の実装
@target: `src/background/ttsEngine.ts`
@ref: なし
- [x] `getVoices()` メソッドに失敗時のリトライロジックを追加（最大3回、lines 701-752）
- [x] exponential backoff（500ms, 1s, 2s）を実装（VOICE_RETRY_DELAYS定数: line 12, MAX_VOICE_RETRIES: line 11）
- [x] リトライ状況のログ出力（lines 731-733, 738-740）

### process2 チャンクサイズの最適化

#### sub1 ブラウザ別チャンクサイズ設定の導入
@target: `src/background/ttsEngine.ts`
@ref: `src/shared/utils/browser.ts`
- [x] Firefox判定時にチャンクサイズを大きくする（CHARS_PER_SECOND_FIREFOX=3: line 18）
- [x] Chrome向けは現状維持（CHARS_PER_SECOND_CONSERVATIVE=4: line 17）
- [x] チャンクサイズ計算ロジックをリファクタリング（calculateChunkConfig()メソッド: lines 756-794）

#### sub2 チャンク数の上限設定
@target: `src/background/ttsEngine.ts`, `src/shared/utils/textChunker.ts`
@ref: なし
- [x] チャンク数が50を超える場合に警告ログを出力（CHUNK_COUNT_WARNING_THRESHOLD=50, lines 128-133）
- [x] チャンクサイズを自動調整してチャンク数を削減するロジック（calculateChunkConfig()で実装）
- [x] 長文コンテンツ用の特別処理を実装（ブラウザ別・速度別チャンクサイズ調整で対応）

#### sub3 速度別チャンクサイズの調整
@target: `src/background/ttsEngine.ts`
@ref: なし
- [x] rate 2.5-3.0でのチャンクサイズを最低150文字に設定（MIN_CHUNK_SIZE_HIGH_SPEED=150: line 20, calculateChunkConfig()内で適用）
- [x] 保守的な係数（charsPerSecond）をFirefox向けに緩和（CHARS_PER_SECOND_FIREFOX=3: line 18, calculateChunkConfig()で使用）

### process3 エラーハンドリング強化

#### sub1 チャンク遷移リトライ回数の増加
@target: `src/background/ttsEngine.ts`
@ref: なし
- [x] `maxChunkRetries` を2→5に変更（49行目）
  - コメント: `// === process3 sub1: チャンク遷移リトライ回数の増加（2→5）===`
- [x] リトライ時の待機時間は100ms維持（484-485行目）
  - コメント: `// === process3 sub1: リトライ時の待機時間（100ms）===`

#### sub2 catchErrorでの処理改善
@target: `src/background/ttsEngine.ts`
@ref: なし
- [x] Observable-basedチャンク遷移（210-246行目）の `catchError` を修正
  - コメント: `// === process3 sub2: catchErrorでの処理改善 ===`
- [x] エラー発生時に詳細なログを出力（213-225行目）
  - エラーの詳細情報（チャンク番号、リトライ数、エラーメッセージ等）をオブジェクト形式でログ
- [x] 最大リトライ数に達した場合のみ処理停止（229-235行目）
- [x] リトライ中のエラーはスキップ（238-245行目）

#### sub3 タイムアウト検知と自動リカバリー
@target: `src/background/ttsEngine.ts`
@ref: なし
- [x] 各チャンクの読み上げ開始時刻を記録（532行目）
  - コメント: `// === process3 sub3: タイムアウト検知と自動リカバリー ===`
  - `_chunkStartTime` にDate.now()を記録
- [x] 20秒以上のチャンク間ギャップを検知（540-546行目）
  - コメント: `// === process3 sub3: 20秒以上のギャップを検知 ===`
  - 警告ログ出力
- [x] チャンク実行時間の記録（559行目）
  - コメント: `// === process3 sub3: チャンク実行時間の記録 ===`
  - 実際の読み上げ時間を計測してログ出力

### process4 デバッグ機能追加

#### sub1 Firefox版詳細ログ出力
@target: `src/background/ttsEngine.ts`, `src/background/index.ts`
@ref: `src/shared/utils/browser.ts`
- [x] Firefox判定時にログレベルを詳細モードに変更（lines 86-91）
- [x] チャンク処理の各段階でログ出力（lines 215-225, 265-271）
- [x] 音声リスト取得状況のログ出力（lines 166-183）

#### sub2 チャンク処理進捗の可視化
@target: `src/background/ttsEngine.ts`
@ref: なし
- [x] チャンク処理進捗をコンソールに出力（X/Y chunks completed）（line 216）
- [x] 各チャンクの実際の読み上げ時間を記録（chunkProcessingTimes Map: line 65）
- [x] 異常に長いチャンク処理時間を検出（calculateAverageChunkTime, findLongestChunkTime: lines 962-974）

#### sub3 エラー発生時の詳細情報収集
@target: `src/background/ttsEngine.ts`
@ref: なし
- [x] エラー発生時にチャンク内容、設定、ブラウザ情報を記録（lines 293-302）
- [x] エラー統計情報の収集（errorStats Map: line 68, extractErrorType: lines 948-957）

### process5 音声の性別選択機能の実装（ハイブリッド方式）

#### sub1 voiceSelectorユーティリティの作成（パターンマッチング実装）
@target: `src/shared/utils/voiceSelector.ts` (新規作成)
@ref: `src/popup/components/SettingsPanel.tsx` (63-70行目の日本語音声フィルタリングロジック)
- [x] `VoiceFilter` インターフェースの定義（gender, language, quality）
- [x] `filterVoices()` 関数の実装（音声リストのフィルタリング）
- [x] `isFemaleVoice()` 関数の実装（音声名からの性別推測）
  - 女性キーワードリスト: 'female', 'woman', 'girl', '女性', 'kyoko', 'samantha', 'siri', etc.
  - 男性キーワードリスト: 'male', 'man', 'boy', '男性', 'hattori', 'daniel', 'thomas', etc.
  - デフォルト判定ロジック（日本語音声は女性を優先）
- [x] `isMaleVoice()` 関数の実装（音声名からの男性判定）

#### sub2 音声メタデータJSONの作成
@target: `src/shared/data/voiceMetadata.json` (新規作成)
@ref: なし
- [x] JSON構造の定義（言語コード → 音声リスト）
- [x] 日本語音声（ja-JP）のメタデータ定義
  - Kyoko (macOS/iOS): female, premium
  - Google 日本語 (Chrome/Edge): female, standard
  - Microsoft Ayumi (Windows/Edge): female, premium
  - Microsoft Ichiro (Windows): male, standard
- [x] 英語音声（en-US）の主要音声を定義（オプション）
- [x] メタデータのバリデーション（TypeScript型定義）

#### sub3 ハイブリッド方式のgetVoiceGender実装
@target: `src/shared/utils/voiceSelector.ts`
@ref: `src/shared/data/voiceMetadata.json`
- [x] `VoiceMetadata` 型定義の作成
- [x] `getVoiceGenderFromMetadata()` 関数の実装（JSON定義から検索）
  - 言語コードによる検索
  - 音声名の部分一致判定
- [x] `getVoiceGender()` 関数の実装（ハイブリッド方式）
  - ステップ1: JSON定義から検索
  - ステップ2: 見つからなければパターンマッチング
  - ステップ3: デフォルト値（female）を返す
- [x] `getVoiceQuality()` 関数の実装（音声品質の取得）

#### sub4 UI改善（設定パネルに性別フィルター追加）
@target: `src/popup/components/SettingsPanel.tsx`
@ref: `src/shared/utils/voiceSelector.ts`, `src/shared/types/tts.ts`
- [x] TTSSettings型に `preferredGender` フィールドを追加（'any' | 'female' | 'male'）
- [x] 性別フィルタードロップダウンの追加（音声選択の上部）
  - オプション: "すべて" (any) / "女性優先" (female) / "男性優先" (male)
- [x] `filterVoices()` を使用して音声リストを動的にフィルタリング
- [x] フィルタリング後の音声を optgroup で表示
  - "推奨音声（性別一致）" グループ
  - "その他の音声" グループ
- [x] 性別フィルター変更時にストレージへ保存

#### sub5 デフォルト音声選択ロジックの改善
@target: `src/background/ttsEngine.ts`
@ref: `src/shared/utils/voiceSelector.ts`, `src/shared/utils/storage.ts`
- [x] `applyVoice()` メソッドにフォールバックロジックを追加
  - voice指定あり → 指定音声を検索
  - voice指定なし、または見つからない → 性別優先選択
- [x] `selectBestVoice()` メソッドの新規作成
  - 言語フィルタリング（日本語優先）
  - 性別フィルタリング（設定から取得）
  - 品質優先順位（premium > standard）
  - プラットフォーム判定（ローカル音声を優先）
- [x] 選択した音声の情報をログ出力
- [x] 自動選択した音声をストレージに保存

#### sub6 ストレージへの音声性別設定の保存
@target: `src/shared/utils/storage.ts`
@ref: `src/shared/types/tts.ts`
- [x] DEFAULT_SETTINGSに `preferredGender: 'female'` を追加
- [x] `validateSettings()` で `preferredGender` のバリデーション
- [x] 設定の読み込み・保存処理の確認

#### sub7 既存の日本語音声フィルタリングロジックの共通化
@target: `src/popup/components/SettingsPanel.tsx`
@ref: `src/shared/utils/voiceSelector.ts`
- [x] `getJapaneseVoices()` を `voiceSelector.ts` に移行
- [x] `getAllVoices()` を削除し、`filterVoices()` を使用
- [x] SettingsPanelでの音声リスト取得を `voiceSelector` 経由に変更

### process10 ユニットテスト

#### sub1 音声リスト取得テスト
@target: `src/background/__tests__/ttsEngine.test.ts`
@ref: `src/background/ttsEngine.ts`
- [x] `getVoices()` メソッドのタイムアウト動作をテスト
- [x] リトライ機構のテスト
- [x] 日本語音声優先選択ロジックのテスト

#### sub2 チャンクサイズ計算テスト
@target: `src/background/__tests__/ttsEngine.test.ts`
@ref: `src/background/ttsEngine.ts`
- [x] Firefox向けチャンクサイズ計算のテスト
- [x] Chrome向けチャンクサイズ計算のテスト（既存動作の維持確認）
- [x] 速度別チャンクサイズのテスト

#### sub3 エラーハンドリングテスト
@target: `src/background/__tests__/ttsEngine.test.ts`
@ref: `src/background/ttsEngine.ts`
- [x] チャンク遷移失敗時のリトライテスト
- [x] `catchError` での次チャンクスキップテスト
- [x] タイムアウト検知のテスト

#### sub4 voiceSelectorユーティリティテスト
@target: `src/shared/utils/__tests__/voiceSelector.test.ts` (新規作成)
@ref: `src/shared/utils/voiceSelector.ts`
- [x] `isFemaleVoice()` 関数のテスト
  - 明示的な女性キーワードを含む音声名（'female', 'Kyoko', 'Samantha'等）
  - 明示的な男性キーワードを含む音声名（'male', 'Daniel', 'Thomas'等）
  - キーワードなしの音声名（デフォルトでfemale判定）
- [x] `isMaleVoice()` 関数のテスト
- [x] `filterVoices()` 関数のテスト
  - gender='female'フィルター
  - gender='male'フィルター
  - language='ja'フィルター
  - 複合フィルター（gender + language）
- [x] `getVoiceGenderFromMetadata()` 関数のテスト
  - JSON定義に存在する音声（正確な性別を返す）
  - JSON定義に存在しない音声（'unknown'を返す）
- [x] `getVoiceGender()` 関数のテスト（ハイブリッド方式）
  - JSON定義がある場合（メタデータから取得）
  - JSON定義がない場合（パターンマッチングへフォールバック）
- [x] `selectBestVoice()` 関数のテスト
  - 日本語音声の優先選択
  - 性別優先選択
  - 品質優先選択（premium > standard）

### process50 フォローアップ
<!-- 実装後に仕様変更などが発生した場合は、ここにProcessを追加する -->

#### sub1 AI処理トークン数の最適化
@target: `src/background/aiPrefetcher.ts`, `src/background/aiProcessor.ts`, `src/background/ttsEngine.ts`
@ref: `src/shared/services/openrouter.ts`

**問題の原因**:
- 要約+翻訳の両方が有効な場合、処理後のコンテンツが極端に短くなる問題が発生
- 例: 3000文字の元コンテンツ → 要約（480トークン ≒ 240文字） → 翻訳（1200トークン） → 最終的に50文字程度に圧縮
- チャンクサイズ60文字（Firefox 2.5倍速）に対して、50文字の処理済みコンテンツが1チャンクで読み上げられて終了
- ユーザーは「途中で終わった」と感じる（元の3000文字ではなく50文字しか読まれていない）

**フロー**:
```
元コンテンツ (3000文字)
  ↓ AI要約 (enableAiSummary: true)
  ↓ maxSummaryTokens: 480トークン ≒ 240文字程度の要約
  ↓ AI翻訳 (enableAiTranslation: true)
  ↓ maxTranslationTokens: 1200トークン
  ↓ 翻訳結果: 50文字程度に圧縮される場合がある
  ↓
最終的に tab.processedContent = 50文字のみ

チャンク化:
  - チャンク1: 50文字全体 ← これだけで終了！
  - 残りのコンテンツは存在しない
```

**修正内容**:
- [ ] プリフェッチャーのデフォルトトークン数を増加（`src/background/aiPrefetcher.ts` lines 22-23）
  - `DEFAULT_SUMMARY_MAX_TOKENS`: 480 → 1500
  - `DEFAULT_TRANSLATION_MAX_TOKENS`: 1200 → 2000
- [ ] AiProcessorのデフォルトトークン数を増加（`src/background/aiProcessor.ts` lines 36-37）
  - `maxSummaryTokens`: 1500（デフォルト）
  - `maxTranslationTokens`: 2000（デフォルト）
- [ ] processedContentが極端に短い場合の警告ログ追加（`src/background/ttsEngine.ts` lines 115-122）
  - processedContentが元コンテンツの10%未満の場合に警告を出力
  - ユーザーに「AI処理により大幅に短縮されました」と通知
- [ ] ユニットテストの更新
  - 新しいトークン数でのAI処理テストケース追加
  - 極端に短いprocessedContentの警告ログテスト追加

**期待される効果**:
- より詳細な要約・翻訳が生成され、読み上げコンテンツが充実する
- 3000文字の記事 → 要約（1500トークン ≒ 750文字） → 翻訳（2000トークン ≒ 500-700文字）
- チャンク数が増加し、ユーザーは「最後まで読まれた」と感じられる

**デメリット**:
- API利用料金が増加（約3倍）
- 処理時間が長くなる（要約・翻訳で各数秒〜10秒程度）
- プリフェッチのメリット（待機時間ゼロ）は維持される

### process100 リファクタリング

#### sub1 ブラウザ別設定の共通化
@target: `src/shared/constants.ts` (新規作成)
@ref: `src/background/ttsEngine.ts`, `src/shared/utils/browser.ts`
- [x] ブラウザ別のTTS設定を定数として定義
- [x] チャンクサイズ、タイムアウト、リトライ回数等を一元管理
- [x] 既存コードを新しい定数定義を使用するように修正

#### sub2 音声選択ロジックの共通化
@target: `src/shared/utils/voiceSelector.ts` (新規作成)
@ref: `src/background/ttsEngine.ts`, `src/popup/components/SettingsPanel.tsx`
- [x] 日本語音声フィルタリングロジックを共通ユーティリティに抽出
- [x] 音声選択の優先順位ロジックを実装
- [x] ポップアップとバックグラウンドで共通コードを使用

### process200 ドキュメンテーション

- [x] `CLAUDE.md` のトラブルシューティングセクションに本問題と解決策を追記
- [x] Firefox特有の制約事項を記載
- [x] AMO配布版とabout:debugging版の違いを明記
- [x] チャンクサイズ設定の推奨値をドキュメント化
- [x] エラーログの読み方ガイドを作成
- [x] 音声選択機能の使い方ガイドを作成
  - [x] 性別フィルターの使用方法
  - [x] 推奨音声の説明
  - [x] 各プラットフォームで利用可能な音声リスト
  - [x] 音声品質の違い（premium vs standard）
- [x] `src/shared/data/voiceMetadata.json` の構造とメンテナンス方法をドキュメント化
  - [x] 新しい音声の追加方法
  - [x] メタデータのフィールド説明
  - [x] 音声名の命名規則
- [ ] `README.md` に音声選択機能のスクリーンショット追加（オプション）

## 完了サマリー

### 実装完了時刻
**2025-10-18**

### 完了した主要実装

1. **エラーハンドリング強化** (process3)
   - チャンク遷移リトライ回数: 2→5回に増加
   - catchErrorでの詳細ログ出力とエラー時スキップ処理を実装
   - タイムアウト検知（20秒以上ギャップ）と自動リカバリー機能を追加
   - 実装ファイル: `src/background/ttsEngine.ts` (lines 49, 210-246, 532-559)

2. **デバッグ機能追加** (process4)
   - Firefox向け詳細ログ出力
   - チャンク処理進捗の可視化（X/Y chunks completed）
   - エラー発生時の詳細情報収集（チャンク内容、設定、ブラウザ情報）
   - 実装ファイル: `src/background/ttsEngine.ts`, `src/background/index.ts`

3. **音声の性別選択機能** (process5)
   - voiceSelectorユーティリティの作成（ハイブリッド方式）
   - 音声メタデータJSON（voiceMetadata.json）の定義
   - UI改善（性別フィルタードロップダウン、optgroup表示）
   - デフォルト音声選択ロジックの改善
   - 実装ファイル: `src/shared/utils/voiceSelector.ts`, `src/shared/data/voiceMetadata.json`, `src/popup/components/SettingsPanel.tsx`

4. **ユニットテスト** (process10)
   - 音声リスト取得、チャンクサイズ計算、エラーハンドリング、voiceSelector関数のテスト実装
   - 実装ファイル: `src/background/__tests__/ttsEngine.test.ts`, `src/shared/utils/__tests__/voiceSelector.test.ts`

5. **リファクタリング** (process100)
   - ブラウザ別TTS設定の共通化（src/shared/constants.ts）
   - 音声選択ロジックの共通化（voiceSelector.ts）
   - ポップアップとバックグラウンドでの共通コード活用

6. **ドキュメンテーション** (process200)
   - CLAUDE.mdへのトラブルシューティングセクション追記
   - Firefox/AMO版の相違点の明記
   - エラーログ読み方ガイド、音声選択ガイド、voiceMetadata.jsonメンテナンスガイド作成

### 関連ファイル

**コア実装**:
- `/Users/takets/repos/read-aloud-tab/src/background/ttsEngine.ts`
- `/Users/takets/repos/read-aloud-tab/src/shared/utils/voiceSelector.ts`
- `/Users/takets/repos/read-aloud-tab/src/shared/data/voiceMetadata.json`
- `/Users/takets/repos/read-aloud-tab/src/popup/components/SettingsPanel.tsx`
- `/Users/takets/repos/read-aloud-tab/src/shared/constants.ts`

**テスト**:
- `/Users/takets/repos/read-aloud-tab/src/background/__tests__/ttsEngine.test.ts`
- `/Users/takets/repos/read-aloud-tab/src/shared/utils/__tests__/voiceSelector.test.ts`

**ドキュメント**:
- `/Users/takets/repos/read-aloud-tab/CLAUDE.md`
