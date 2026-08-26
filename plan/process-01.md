# Process 1: playbackText 確定テキストキャッシュ（型 + 書込 + 短絡）

## Implementation Brief（コピペ用）

- 背景: 複数タブを連続再生する際、2周目でも resolveContent（コンテンツ抽出 + OpenRouter API）が再実行されており、不要なAPI呼び出しと待機が発生している。
- 目的: 1周目に確定した読み上げテキストを `playbackText` に write-once キャッシュし、2周目以降は抽出もAPI呼び出しも不要にする（API実行ゼロ保証）。
- 変更範囲:
  - `src/shared/types/tab.ts`
  - `src/shared/types/helpers.ts`
  - `src/background/tabManager.ts`
- playbackText の保存場所: `src/shared/types/tab.ts` の `TabInfo` に `playbackText?: string` を追加し、`ReadingQueue.tabs[]` に保存する（独立 storage key（`PLAYBACK_TEXT_CACHE_KEY`）は作らない）
- 禁止事項:
  - 2周目に resolveContent を呼ぶ
  - playbackText を `storage.sync` に保存する（`storage.local` 限定）
  - `updateSettings` のクリア対象に playbackText を含める
  - 数値リテラルの直書き（定数名のみ参照）
- 出力順序: 1) 実装 2) セルフレビュー 3) 修正 4) 再レビュー 5) ドキュメント更新確認 6) 品質ゲート

---

## Overview

各 `TabInfo` に `playbackText?: string` フィールドを追加し、`processNext` で1周目の確定読み上げテキストを write-once で書き込む。2周目以降は `ensureTabReady` 冒頭の短絡ガードで `resolveContent`（コンテンツ抽出 + AI API）を完全スキップし、`selectPlaybackContent` 冒頭ガードで1周目の確定テキストをそのまま返す。これにより2周目以降のAPI実行ゼロを保証する。

---

## Affected Files

| ファイル | 変更概要 |
|---|---|
| `src/shared/types/tab.ts` | `TabInfo` に `playbackText?: string` 追加、`cloneTabInfo` で伝播 |
| `src/shared/types/helpers.ts` | `SerializedTabInfo` が spread で `playbackText` を自動継承することを確認（型明示） |
| `src/background/tabManager.ts` | `ensureTabReady` 短絡ガード追加、`selectPlaybackContent` 優先返却ガード追加、`processNext` write-once 書込追加、`onTabLoading`・`onTabUpdated` で playbackText の stale 破棄追加 |

---

## Symbol Targets

### src/shared/types/tab.ts

| Symbol | Kind | 推定行 | patch_only | disjoint_guarantee |
|---|---|---|---|---|
| `TabInfo` | interface | L8-21 | true | false（tabManager.ts を Process 2 と共有） |
| `cloneTabInfo` | function | L23-32 | true | false |

- pre_flight_checks: `TabInfo` に `playbackText` が未存在であることを確認してから追加

### src/shared/types/helpers.ts

| Symbol | Kind | 推定行 | patch_only | disjoint_guarantee |
|---|---|---|---|---|
| `SerializedTabInfo` | interface | L2-7 | true | true |

- `createSerializedTab` は変更不要見込み（`...tab` スプレッドで自動継承）

### src/background/tabManager.ts

| Symbol | Kind | 推定行 | patch_only | disjoint_guarantee |
|---|---|---|---|---|
| `processNext` | method | L371-448 | true | false |
| `ensureTabReady` | method | L1002-1043 | true | false |
| `selectPlaybackContent` | method | L1070-1087 | true | false |
| `onTabLoading` | method | L518-537 | true | false |
| `onTabUpdated` | method | L539-606 | true | false |

- pre_flight_checks: `ensureTabReady` の `resolveContent` が抽出 + API の唯一経路であることを確認
- pre_flight_checks: `onTabLoading`（reload 検知時 L530-532）・`onTabUpdated`（URL 変更時 L551-555）が `content/summary/translation` を `undefined` にしている箇所を確認

---

## Implementation Notes

### 1. `src/shared/types/tab.ts` — TabInfo へのフィールド追加

`TabInfo` インターフェースに以下を追加する：

```typescript
// Why: 2周目以降の即再生用キャッシュ。translation>summary>content の1周目確定結果を
// 1本化し、抽出/API再実行を不要にする
playbackText?: string;
```

`cloneTabInfo` に `playbackText: tab.playbackText` を追加して複製漏れを防止する。

### 2. `src/background/tabManager.ts` — ensureTabReady 短絡ガード

`isIgnored` チェックの直後、`resolveContent` 呼び出しの前に以下を追加する：

```typescript
if (tab.playbackText) {
  return true;
}
```

これにより `resolveContent`（= `emitContentRequest` 抽出 + `aiProcessor.processContent` API）を完全スキップし、2周目の API 実行ゼロを保証する。

### 3. `src/background/tabManager.ts` — selectPlaybackContent 優先返却ガード

メソッド冒頭に以下を追加する：

```typescript
if (tab.playbackText) {
  return tab.playbackText;
}
```

2周目は「1周目に実際に流した確定テキスト」をそのまま再生し、`translation` 再優先による文ズレを防止する。

### 4. `src/background/tabManager.ts` — processNext write-once 書込

`selectPlaybackContent` の戻り値が非 null かつ `tab.playbackText` 未設定のとき、以下を追加する（`selectPlaybackContent` 呼出直後、既存 `persistQueue()` 呼出の前）：

```typescript
// Why: write-once。常時上書きせず1周目の確定結果のみ固定する。
// 2周目は selectPlaybackContent ガードが先に return するためここは実行されない
if (playbackText && !tab.playbackText) {
  tab.playbackText = playbackText;
}
```

直後の既存 `persistQueue()`（L427 付近）により `storage.local` へ自動永続化される。

### 5. `src/background/tabManager.ts` — playbackText の stale 破棄

`playbackText` は write-once だが、同一タブの reload（`onTabLoading`）・URL 変更（`onTabUpdated`, url changed）時には `content/summary/translation` と同じ箇所で `playbackText` も `undefined` にして破棄する。これを怠ると新 URL で旧確定テキストを読む stale playback が発生する。

- `onTabLoading`（reload 検知、L530-532 で `content/summary/translation = undefined`）: 同箇所に `tab.playbackText = undefined` を追加する。
- `onTabUpdated`（URL 変更、`tab.url !== update.url` 分岐、L551-555 で `summary/translation/content = undefined`）: 同箇所に `tab.playbackText = undefined` を追加する。

```typescript
// Why: write-once キャッシュは「同一 URL の確定テキスト」前提。reload / URL 変更で
// コンテンツが変わるため、content/summary/translation と同じ箇所で playbackText も破棄する。
// 破棄を怠ると新 URL で旧確定テキストを読む stale playback が発生する
tab.playbackText = undefined;
```

短絡点（`ensureTabReady` 冒頭ガード `if (tab.playbackText) return true;`、`selectPlaybackContent` 冒頭ガード `if (tab.playbackText) return tab.playbackText;`）と書込点（`processNext` の write-once）は、破棄後は `playbackText` が `undefined` になるため再度 `resolveContent` 経路で確定テキストが取得・再書込される。この破棄方針と短絡/書込ロジックは矛盾しない。

### 6. `src/shared/types/helpers.ts` — SerializedTabInfo 確認

`SerializedTabInfo` は `...tab` スプレッドで `playbackText` を自動継承するが、型の明示性のため `Omit` 対象外であることを確認する。`createSerializedTab` は変更不要の見込みだが、シリアライズ経路で `playbackText` が欠落しないことをテストで確認する。

---

## Behavior Specification

### ensureTabReady の入出力

| tab.playbackText | resolveContent 呼出 | 抽出(emitContentRequest) | OpenRouter API | 結果 content |
|---|---|---|---|---|
| 有（非空） | しない | しない | しない | playbackText（selectPlaybackContent が返す） |
| 無/空 | する（既存） | 条件付（content 無時） | 条件付（AI 有効時） | resolveContent 結果 → selectPlaybackContent |

### processNext の書込動作（selectPlaybackContent 結果非 null 時）

| tab.playbackText 既存 | 動作 |
|---|---|
| 未設定 | `tab.playbackText = 確定テキスト`、`persistQueue` で永続化 |
| 設定済 | 書き込まない（write-once） |

### onTabLoading / onTabUpdated の stale 破棄動作

| イベント | 条件 | playbackText | content/summary/translation |
|---|---|---|---|
| `onTabLoading` | reload 検知 | `undefined` に破棄 | `undefined`（既存） |
| `onTabUpdated` | URL 変更（`tab.url !== update.url`） | `undefined` に破棄 | `undefined`（既存） |
| `onTabUpdated` | URL 不変 | 維持 | 維持（既存） |

### Correctness Criteria

- `playbackText` 有時に `resolveContent` spy 呼出が 0 回であること
- 1周目で `playbackText` が `storage.local` に永続化されること
- 2周目に流れるテキストが1周目の確定テキストと一致すること
- reload（`onTabLoading`）・URL 変更（`onTabUpdated`）後に `playbackText` が破棄され、再度 `resolveContent` 経路を通ること

### Left to Implementation

- 短絡を `ensureTabReady` と `selectPlaybackContent` の両方に置く（本 Plan 確定）
- Why コメントの文言
- 変数名

---

## Red Phase: テスト作成と失敗確認

> Process 11 で詳細テストを実装する。本 Process では型追加後 typecheck が通ること、既存テストが回帰しないことを確認する。

- [x] `TabInfo` に `playbackText` が存在しないことを確認してテスト作成前提を記録
- [x] `npm run typecheck` が現時点でエラーなく通ることを確認（ベースライン記録）
- [x] `npm run test` で既存テストが全件グリーンであることを確認（ベースライン記録）
- [x] `playbackText` 有時に `ensureTabReady` が `resolveContent` を呼ばないことを検証するユニットテストを作成（Process 11 で実装済み）
- [x] `playbackText` 有時に `selectPlaybackContent` がその値を返すことを検証するユニットテストを作成（Process 11 で実装済み）
- [x] `processNext` が1周目に `playbackText` を書き込み、2周目は書き込まないことを検証するユニットテストを作成（Process 11 で実装済み）
- [x] シリアライズ経路で `playbackText` が欠落しないことを検証するユニットテストを作成（Process 11 で実装済み）
- [x] GREEN であること（typecheck && test 全件グリーン）を確認

---

## Green Phase: 最小実装と成功確認

- [x] `src/shared/types/tab.ts`: `TabInfo` に `playbackText?: string` を追加（Why コメント付き）
- [x] `src/shared/types/tab.ts`: `cloneTabInfo` に `playbackText: tab.playbackText` を追加
- [x] `src/shared/types/helpers.ts`: `SerializedTabInfo` が `playbackText` を継承していることを型レベルで確認（変更不要、Omit 対象外で自動継承）
- [x] `src/background/tabManager.ts`: `ensureTabReady` 冒頭に `playbackText` 短絡ガードを追加
- [x] `src/background/tabManager.ts`: `selectPlaybackContent` 冒頭に `playbackText` 優先返却ガードを追加
- [x] `src/background/tabManager.ts`: `processNext` に write-once 書込ロジックを追加（Why コメント付き）
- [x] `src/background/tabManager.ts`: `onTabLoading`・`onTabUpdated` に stale 破棄追加（Why コメント付き）
- [x] `npm run typecheck` でエラーなし（GREEN 確認）
- [x] `npm run test` で全テスト全件グリーン（587 passed）
- [x] 既存テストが回帰していないことを確認

---

## Refactor Phase: 品質改善

- [x] Why コメントが実装コードに追加済み（tabManager.ts の各ガード・write-once・stale破棄点、tab.ts の playbackText フィールド）
- [x] `playbackText` の write-once 書込箇所に重複条件がないことを確認（`if (playbackText && !tab.playbackText)` の1箇所のみ）
- [x] `ensureTabReady` と `selectPlaybackContent` の両ガードが意図通りに連動していることをコードレビュー済み
- [x] `cloneTabInfo` の `playbackText` 伝播が、他の optional フィールドと一貫したスタイルであることを確認
- [x] 不要な `@ts-expect-error` や型アサーションが増えていないことを確認（test ファイルの as any を型付きアクセスに置換）
- [x] `npm run lint` — 変更ファイルに新規エラーなし（既存の pre-existing エラーは影響なし）
- [x] `npm run test` で全件グリーン（587 passed）

---

## Manual Verification

- [ ] AI 要約 ON で 2 タブをキューに追加し、1 周目に要約完了まで待機することを確認
- [ ] 2 周目に DevTools Network タブを開き、OpenRouter への API リクエストが発生しないことを確認
- [ ] 2 周目に Chrome/Firefox Service Worker コンソールで `resolveContent` のログが出力されないことを確認
- [ ] 2 周目の再生開始が即座（待機なし）であることを目視確認
- [ ] 2 周目の再生中に速度を 1.0x → 2.5x に変更し、流れるテキストが1周目と同一でかつ新速度で再生されることを確認
- [ ] `chrome.storage.local` に `playbackText` が書き込まれていることを DevTools Application タブで確認
- [ ] `chrome.storage.sync` に `playbackText` が書き込まれていないことを確認

---

## Dependencies

- Requires: なし（最初の機能 Process）
- Blocks:
  - Process 02（弱依存: `TabInfo` 型変更を参照）
  - Process 05（`playbackText` フィールドの存在を前提とする機能）
  - Process 11（詳細ユニットテスト実装）
