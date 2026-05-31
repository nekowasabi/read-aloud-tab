# Process 5: scheduler プリフェッチ抑止（playbackText 済みタブ除外）

## Implementation Brief（コピペ用）

- **背景**: ensureTabReady の短絡（Process 01）で再生経路の API 呼び出しはゼロになるが、PrefetchWorker が先回りでコンテンツ抽出・OpenRouter API を叩く経路が残っている。scheduler 段で確定テキスト済みタブを除外することで「API実行ゼロ」を完全保証する。
- **目的**: collectTargets にて `candidate.playbackText` が存在するタブをプリフェッチ対象から除外し、2周目以降の不要な API 呼び出しを抑止する。
- **変更範囲**: `src/background/prefetch/scheduler.ts` の `collectTargets` 関数（除外条件の拡張のみ）。型定義の変更は Process 01/03 で対応済みであることを前提とする。
- **参照する定数**: 数値リテラルは使用しない。除外条件は `isIgnored` および `playbackText` フィールドの真偽値のみで判定する。
- **禁止事項**:
  - 2周目以降のタブに対してコンテンツ抽出・OpenRouter API を起動すること
  - 数値リテラルをハードコードすること
  - `collectTargets` 以外の関数を変更すること（スコープ外）
  - playbackText フィールドを scheduler 内で加工・変換すること
- **出力順序**: 1) 実装 → 2) セルフレビュー → 3) 修正 → 4) 再レビュー → 5) ドキュメント更新確認 → 6) 品質ゲート

---

## Overview

複数タブを連続読み上げする場合、1周目でプリフェッチ・再生済みのタブが `playbackText` を保持している。2周目（ループ再生）に入ると、PrefetchScheduler の `collectTargets` がこれらのタブを再びプリフェッチ対象として選定し、PrefetchWorker が不要なコンテンツ取得・API 呼び出しを実行してしまう。

本 Process では `collectTargets` の **current 側（L149 の push 条件）と candidate 側（候補ループ L160 の除外条件）の両方**に `playbackText` 済み判定を追加し、確定テキストを既に保持しているタブをプリフェッチ対象から除外する。候補ループだけの除外では、`playbackText` 済みの現在タブ（current）が prefetch に残り、PLAN の『2周目 API 実行ゼロ』要件（PLAN.md:77,85,107）を破る。これにより再生経路とプリフェッチ経路の両方で「API実行ゼロ」が完全保証される。

---

## Affected Files

| # | ファイルパス | 変更内容 |
|---|---|---|
| 1 | `src/background/prefetch/scheduler.ts` | `collectTargets`（L145-171）について **current 側と candidate 側の両方**で `playbackText` 済みタブを除外する。(a) current タブの push 条件（L149）に `&& !current.playbackText` を追加 (b) 候補ループの除外条件（L160付近）に `\|\| candidate.playbackText` を追加 |
| - | （依存）`src/shared/types.ts` 等 | `SerializedTabInfo` に `playbackText` が含まれることを確認（Process 01/03 対応済み前提・変更不要） |

---

## Symbol Targets

| フィールド | 値 |
|---|---|
| file | `src/background/prefetch/scheduler.ts` |
| symbol | `collectTargets`（function, L145-171） |
| patch_only | true |
| disjoint_guarantee | true |
| pre_flight_checks | 1) `collectTargets` の現除外条件が `isIgnored` のみであること / 2) scheduler が参照するタブ型に `playbackText` フィールドが含まれること |

---

## Implementation Notes

1. **current 側と candidate 側の両方で `playbackText` 済みを除外する**。候補ループだけを除外しても、`playbackText` 済みの現在タブ（current）が prefetch に残り、PLAN の『2周目 API 実行ゼロ』要件（PLAN.md:77,85,107）を破るため、current の push 条件にも除外を加える必要がある。

   (a) current タブの push 条件（scheduler.ts:149）を変更する:

   ```typescript
   // 変更前: if (current && !current.isIgnored)
   // 変更後:
   if (current && !current.isIgnored && !current.playbackText) {
     targets.push(current);
   }
   ```

   (b) 候補ループ内（L160付近）の除外条件を変更する:

   ```typescript
   if (!candidate || candidate.isIgnored || candidate.playbackText) {
     continue;
   }
   ```

   **Why コメント**（各変更箇所の直上に記載）:
   ```typescript
   // Why: 確定テキスト済みタブは2周目に再生経路で即再生されるためプリフェッチ不要。
   //      current/candidate 両側で除外し、先回り API を抑止して「API実行ゼロ」を完全保証する。
   ```

2. `playbackText` が scheduler の参照型（`SerializedTabInfo` など）に存在することを確認する。型エラーが出る場合は Process 01/03 の型追加が前提条件として未完了であることを意味するため、先に Process 01/03 を完了させること。

3. 変更は current の push 条件と候補ループの除外条件の拡張のみ。その他のロジック（優先度計算、キューへの追加など）には一切触れない。

---

## Behavior Specification

**behavior_scope**: true  
**system_type**: transformation

### 入出力表

（current タブ・候補タブいずれにも同一規則を適用する）

| isIgnored | playbackText | collectTargets 採否 |
|---|---|---|
| true | 任意 | 除外（既存動作） |
| false | 有（非空文字列） | 除外（新規・current/candidate 両側） |
| false | 無 / 空 / undefined | 採用（既存動作） |

### Correctness Criteria

- `playbackText` が存在するタブが prefetch ターゲットリストに含まれない（**current 側・candidate 側の両方で除外されること**）
- 候補ループだけの除外では `playbackText` 済みの現在タブ（current）が残り、PLAN の『2周目 API 実行ゼロ』要件（PLAN.md:77,85,107）を破るため、current の push 条件にも除外を加えること
- `playbackText` が存在しないタブは従来通りプリフェッチ対象として採用される
- 既存の `isIgnored` による除外動作が維持される

### Left to Implementation

- 除外条件式の並び順（`isIgnored` を先に評価するか `playbackText` を先にするかの選択）

---

## Red Phase: テスト作成と失敗確認

scheduler のテストファイルが存在する場合、以下のテストケースを追加して失敗を確認する。テストファイルが存在しない場合は Green Phase の実装後に Manual Verification で代替する。

- [ ] `playbackText` が設定されたタブが `collectTargets` の結果に含まれないことを検証するテストを追加
  - 例: `candidate = { isIgnored: false, playbackText: '確定テキスト', ... }` → 結果リストに含まれない
- [ ] `playbackText` が空文字 / undefined のタブは結果に含まれることを検証するテストを追加
  - 例: `candidate = { isIgnored: false, playbackText: undefined, ... }` → 結果リストに含まれる
- [ ] `isIgnored: true` の既存除外動作が引き続き機能することを検証するテストを確認
- [ ] `npm run test -- --testPathPattern=scheduler` でテストが失敗することを確認（Red 確認）

---

## Green Phase: 最小実装と成功確認

- [ ] `src/background/prefetch/scheduler.ts` の `collectTargets` で current 側・candidate 側の両方を拡張
  - current（L149）変更前: `if (current && !current.isIgnored) {`
  - current（L149）変更後: `if (current && !current.isIgnored && !current.playbackText) {`
  - candidate（L160付近）変更前: `if (!candidate || candidate.isIgnored) { continue; }`
  - candidate（L160付近）変更後: `if (!candidate || candidate.isIgnored || candidate.playbackText) { continue; }`
  - Why コメントを各除外条件の直上に追記
- [ ] `npm run typecheck` が通過することを確認（型エラーがない場合 Process 01/03 完了済み）
- [ ] `npm run test -- --testPathPattern=scheduler` で追加テストが成功することを確認（Green 確認）
- [ ] 既存の scheduler テストに回帰がないことを確認

---

## Refactor Phase: 品質改善

- [ ] Why コメントの内容が実装意図を正確に表現しているか確認
- [ ] 除外条件の並び順が可読性の観点で最適か確認（`isIgnored` → `playbackText` の順が推奨）
- [ ] `collectTargets` 内の他の条件分岐と一貫したスタイルになっているか確認
- [ ] `npm run lint` を実行して lint エラーがないことを確認
- [ ] `npm run test` で全テストスイートが通過することを確認

---

## Manual Verification

- [ ] 2タブをキューに追加し、1周再生を完了させる（両タブの `playbackText` が設定された状態にする）
- [ ] ループ再生を有効にして2周目の再生を開始する
- [ ] Chrome DevTools の Network タブを開き、OpenRouter のエンドポイントへのリクエストを監視する
- [ ] **期待値**: 2周目の再生中に OpenRouter へのリクエストが一切発生しない（再生経路・プリフェッチ経路ともにゼロ）
- [ ] `playbackText` を持たない新規タブをキューに追加した場合は従来通りプリフェッチが実行されることを確認

---

## Dependencies

| 種別 | Process | 内容 |
|---|---|---|
| Requires | Process 01 | `playbackText` フィールドが `SerializedTabInfo` / scheduler 参照型に追加されていること |
| Requires | Process 03 | scheduler 参照型への `playbackText` 伝播が完了していること |
| Blocks | Process 200 | 「API実行ゼロ」の完全保証確認テスト |
