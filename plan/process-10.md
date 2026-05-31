# Process 10: ループ制御ユニットテスト（reactive 状態遷移）

## Implementation Brief（コピペ用）

- **背景**: Process 02 で実装するループ制御（`handlePlaybackEnd` 分岐）を TDD 手法で検証するためのテストファイルを新規作成する。
- **目的**: `loopEnabled=true` 時に末尾タブ読了後 `currentIndex` が 0 に戻り再生継続・`tabs` が `splice` されないことを保証する。後方互換として `loopEnabled=false` の従来停止動作も回帰ゲートとして検証する。
- **変更範囲**: `src/background/__tests__/tabManagerLoop.test.ts`（新規作成のみ）。プロダクションコードへの変更なし。
- **参照する定数**: なし。loop 終端（読めるタブが皆無）は `findNextReadableIndex` が `-1` を返し `stopInternal(false)` で停止する設計のため、ガード定数（`MAX_LOOP_GUARD_COUNT` 等）は使わない。
- **禁止事項**:
  - `loopEnabled=false` の既存挙動を変える検証にしない（回帰ゲートを壊さない）
  - プロダクションコード（`tabManager.ts` 等）を本 Process 内で変更しない
  - `tabManagerPlaybackEnd.test.ts` の既存テストを削除・変更しない
- **出力順序**: Red Phase（テスト作成・失敗確認）→ Green Phase（Process 02 実装後パス確認）→ Refactor Phase（セットアップ集約）

---

## Overview

Process 02 のループ制御ロジック（`handlePlaybackEnd` における `loopEnabled` 分岐）を検証する TDD テストを実装する。

テスト対象の状態遷移は Process 02 の仕様表に準拠し、以下の 5 ケースを網羅する：

1. `loopEnabled=true` かつ末尾タブ読了 → `currentIndex` が 0 に戻り、`queue.tabs` は不変、再生継続
2. `loopEnabled=true` かつ中間タブ読了 → `currentIndex=i+1`、`splice` されない
3. `loopEnabled=false` かつ末尾読了 → `splice` 除去・キュー空・`status='idle'`（回帰ゲート）
4. `loopEnabled=true` かつ全タブが `isIgnored=true`（読めるタブが皆無）→ `findNextReadableIndex` が `-1` を返し `stopInternal(false)` 経由で `idle`（ガード定数は使わない）
5. `loopEnabled=true` かつ唯一タブ → 同一タブ再生継続

---

## Affected Files

| ファイル | 新規/変更 | 備考 |
|---|---|---|
| `src/background/__tests__/tabManagerLoop.test.ts` | 新規作成 | テスト専用。プロダクションコード変更なし |

---

## Symbol Targets

| ファイル | シンボル | patch_only | disjoint_guarantee | pre_flight_checks |
|---|---|---|---|---|
| `src/background/__tests__/tabManagerLoop.test.ts` | -（新規テストファイル） | false | n/a（test-only） | 既存 `tabManagerPlaybackEnd.test.ts` の `onEnd` コールバック捕捉パターンを踏襲 |

---

## Implementation Notes

1. **セットアップ流儀**: 既存 `src/background/__tests__/tabManagerPlaybackEnd.test.ts` のセットアップを踏襲する。
   - `chrome.storage` モックの初期化
   - `onEnd` コールバック捕捉（`TabManager` 内部の `onPlaybackEnd` ハンドラを取得）
   - `flushPersistence()` で永続化フラッシュを明示的に呼出す（`persistQueue` は遅延バッチのため）

2. **テストケース詳細**（Process 02 の状態遷移表に対応）:

   ```
   Case A: loopEnabled=true, 末尾タブ読了
     - 初期状態: tabs=[t0, t1, t2], currentIndex=2, loopEnabled=true
     - onEnd 発火後: currentIndex===0
     - queue.tabs.length===3（splice されない）
     - status==='reading'（再生継続）

   Case B: loopEnabled=true, 中間タブ読了
     - 初期状態: tabs=[t0, t1, t2], currentIndex=1, loopEnabled=true
     - onEnd 発火後: currentIndex===2
       （次 index は completedIndex+1。末尾で前方に読可タブが無い場合は wrap(0)。
        process-02 の確定式 findNextReadableIndex(completedIndex+1) → wrap(0) → -1 と整合）
     - queue.tabs.length===3（splice されない）

   Case C: loopEnabled=false, 末尾読了（回帰ゲート）
     - 初期状態: tabs=[t0], currentIndex=0, loopEnabled=false
     - onEnd 発火後: queue.tabs.length===0
     - status==='idle'

   Case D: loopEnabled=true, 全タブ isIgnored=true（読めるタブが皆無）
     - 初期状態: tabs=[{isIgnored:true}, {isIgnored:true}], loopEnabled=true
     - onEnd 発火後: status==='idle'
       （findNextReadableIndex が completedIndex+1・wrap(0) ともに -1 を返し、
        stopInternal(false) で idle 遷移することを assert する。ガード定数は使わない）

   Case E: loopEnabled=true, 唯一タブ
     - 初期状態: tabs=[t0], currentIndex=0, loopEnabled=true
     - onEnd 発火後: currentIndex===0（同一タブ再生継続）
     - queue.tabs.length===1
   ```

3. **`flushPersistence()` 呼出**: 各 assertion 前に必ず呼出して永続化バッファをフラッシュする。

4. **モック構成**: `chrome.runtime.sendMessage`、`chrome.tabs.query`、`chrome.storage.local` は `tabManagerPlaybackEnd.test.ts` と同一のモック設定を使用する。

---

## Behavior Specification

behavior_scope: **false**（検証対象の振る舞いは Process 02 で仕様化済み）。本 Process はテスト実装のみ。

---

## Red Phase: テスト作成と失敗確認

- [ ] `src/background/__tests__/tabManagerLoop.test.ts` を新規作成する
- [ ] `tabManagerPlaybackEnd.test.ts` のセットアップコードを参照し、`beforeEach` で `chrome.storage` モックと `TabManager` インスタンスを初期化する
- [ ] Case A（`loopEnabled=true` 末尾読了→`currentIndex=0`）テストを記述する
- [ ] Case B（`loopEnabled=true` 中間読了→`currentIndex=completedIndex+1`、末尾なら wrap(0)）テストを記述する
- [ ] Case C（`loopEnabled=false` 末尾読了→`idle` 回帰ゲート）テストを記述する
- [ ] Case D（全タブ `isIgnored` で読めるタブ皆無→`findNextReadableIndex` が -1→`stopInternal(false)`→`idle`）テストを記述する
- [ ] Case E（唯一タブ再生継続）テストを記述する
- [ ] `npm run test -- tabManagerLoop` を実行し、**Case 別に期待値を分けて確認する**（全 Case 一律 red ではない）:
  - **RED（失敗）を期待**: Case A / B / E（`loopEnabled=true` の新規挙動）、および `setLoopEnabled` 未実装に起因するケース、Case D（`loopEnabled=true` 分岐未実装のため）
  - **GREEN（pass）を期待**: Case C（`loopEnabled=false` 末尾→`idle` の回帰ゲート）は**既存挙動**であり実装前から pass であるべき（process-02.md:164 も同ケースを GREEN と期待しており整合させる）
- [ ] RED 期待ケースの失敗メッセージが「期待値と実際値の不一致」であることを確認する（テスト自体の構文エラーでないこと）
- [ ] GREEN 期待ケース（Case C）が実装前から pass し、回帰ゲートのベースラインとして機能することを確認する

---

## Green Phase: 最小実装と成功確認

- [ ] Process 02 の実装完了後、`npm run test -- tabManagerLoop` を実行する
- [ ] Case A〜E の全テストが **pass** することを確認する
- [ ] `npm run test -- tabManagerPlaybackEnd` を実行し、**既存全テスト（`tabManagerPlaybackEnd.test.ts`、実際は5件）** に **回帰なし** を確認する（固定件数「4テスト」表記は誤りなので使わない）
- [ ] `npm run test` を実行し、全テストスイートが pass することを確認する

---

## Refactor Phase: 品質改善

- [ ] 各テストケースで重複しているセットアップコード（`TabManager` 初期化・モック設定）を `beforeEach` に集約する
- [ ] テストデータ（`TabInfo` のモックオブジェクト）をファクトリ関数 `createMockTab()` に切り出す
- [ ] リファクタ後に `npm run test -- tabManagerLoop` が全 pass を維持することを確認する

---

## Manual Verification

対象外: 自動テストで十分。本 Process はユニットテストのみ。

---

## Dependencies

- **Requires**: Process 02（`handlePlaybackEnd` のループ制御実装）
- **Blocks**: Process 200
