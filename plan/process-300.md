# Process 300: OODA レトロスペクティブ

## Implementation Brief（コピペ用）

- **背景**: ミッション完了後に得られた教訓を4箇所に永続化し、次セッション・横断プロジェクトで活用するためのレトロスペクティブ工程。
- **目的**: 本ミッション（キュー繰り返し再生機能）で実際に直面した設計上の発見・選択を記録し、同類の問題を将来のセッションで即座に回避できるようにする。
- **変更範囲**: .serena/memories/（write_memory）、stigmergy/lessons.jsonl または stigmergy/patterns/{category}.md、CLAUDE.md（高重要度時のみ）、byterover（brv が存在する場合のみ）。ソースコードの変更はしない。
- **参照する定数**: なし（知見永続化のみ）
- **禁止事項**: 事後正当化の捏造教訓を書かない（実際に検討した選択肢のみ）。実体験に基づかない「それっぽい教訓」の追加禁止。
- **出力順序**: Knowledge Phase → Manual Verification の順に処理する。

---

## Overview

Process 200（全実装・ドキュメント完了）の後に実施するレトロスペクティブ工程。本ミッションで実際に直面した設計上の障害・選択・発見を、次セッションで即座に参照できる形式で4箇所に永続化する。

レトロスペクティブは「教訓の発見 → 記述 → レビュー」の順で進める。Red/Green/Refactor フェーズはそれぞれ「知見抽出 → 記述 → 品質レビュー」に読み替える。

---

## Affected Files

| ファイル/場所 | 操作 | 条件 |
|---|---|---|
| `.serena/memories/lessons-queue-repeat-loop.md` | write_memory | 必須 |
| `stigmergy/lessons.jsonl` または `stigmergy/patterns/{category}.md` | 追記 | 必須（どちらか片方） |
| `CLAUDE.md` | 追記 | 重要度が高い知見のみ |
| byterover | brv store | `command -v brv` が成功した場合のみ |

---

## Symbol Targets

- patch_only: false
- disjoint_guarantee: n/a
- 対象シンボルなし（知見永続化のみ、ソースコード変更なし）

---

## Implementation Notes

本機能（キュー繰り返し再生）の実装で得られた教訓の例。実装後に実体験で更新すること。

### 教訓1: loopEnabled の置き場所

- **発見**: `loopEnabled` を `TTSSettings` に置けない。`validateSettings` がフィールド除去を行うため、設定保存時に値が消える。
- **採用した設計**: キュー状態は `ReadingQueue` + 専用コマンド（`SET_LOOP_MODE`）で運ぶ設計パターン。
- **Why**: TTSSettings はユーザー設定（音声・速度）専用。再生制御フラグはキュー状態として分離するのが責務境界として正しい。

### 教訓2: splice 除去がループの隠れた障害

- **発見**: `handlePlaybackEnd` の `splice` 除去がリピートの隠れた障害だった。
- **定石**: 「読了 = 除去」前提の再生キューにループを足す際は、`loopMode` フラグで `splice` を抑止する。除去後は再生可能タブがゼロになり、ループが開始できない。
- **Why**: 既存実装は「再生済みタブは常にキューから削除」が前提。この前提を壊さずにループを実現するには、除去タイミングを条件分岐で制御するのが最小変更。

### 教訓3: API 実行ゼロ要件には2経路の封鎖が必要

- **発見**: API 実行ゼロ要件（2周目以降はキャッシュのみ使用）を満たすには、再生経路（`ensureTabReady`）とプリフェッチ経路（`scheduler`）の両方を塞ぐ必要がある。片方だけでは先回り API が漏れる。
- **Why**: `ensureTabReady` だけガードしても、`AiPrefetcher` のスケジューラーが2周目のタブを新規プリフェッチ対象として投入してしまう。

### 教訓4: 2周目の正確な再生には selectPlaybackContent ガードも必要

- **発見**: `ensureTabReady` の短絡だけでは不十分。`selectPlaybackContent` で `translation` を再優先すると、2周目で文ズレが発生する。
- **Why**: 1周目でキャッシュされた `translation` が残存している場合、2周目で `content` を再取得しても `translation` が優先されてしまい、古い内容が読まれる。`selectPlaybackContent` にも2周目ガードが必要。

---

## Behavior Specification

- **behavior_scope**: false（レトロスペクティブ Process のため、機能動作仕様なし）
- 対象: 知見の永続化品質（記述の正確性・実体験への忠実性・次セッションでの検索可能性）

---

## Red Phase: 知見抽出（テスト作成と失敗確認に相当）

- [ ] 本ミッションの実装中に実際に直面した設計上の障害を列挙する
- [ ] 各障害に対して「採用した解法」と「採用しなかった代替案」を明確にする
- [ ] 列挙した教訓が「事後正当化でないか」をセルフレビューする
- [ ] 教訓が他のプロジェクト・機能にも適用可能かを確認する
- [ ] 記録すべき教訓のリストが揃っていることを確認する

---

## Green Phase: 記述（最小実装と成功確認に相当）

- [ ] `.serena/memories/lessons-queue-repeat-loop.md` に教訓を書き込む（`mcp__serena__write_memory` 使用）
  - 書式: `## 教訓タイトル` + `- 発見:` + `- 採用した設計:` + `- Why:`
- [ ] `stigmergy/lessons.jsonl` に JSONL 形式で追記する、または `stigmergy/patterns/{category}.md` に追記する
  - JSONL フィールド: `{ "date": "...", "category": "...", "title": "...", "discovery": "...", "pattern": "...", "why": "..." }`
- [ ] `command -v brv` を実行し、利用可能なら `brv store` でも保存する（利用不可の場合はスキップ・エラーにしない）
- [ ] 各記録が正しく書き込まれたことを確認する（read_memory 等で検証）

---

## Refactor Phase: 品質レビュー（品質改善に相当）

- [ ] 記録した教訓の文章が具体的で、次セッションの Claude が即座に行動に移せるレベルかを確認する
- [ ] 「Why」コメントが「採用しなかった選択肢との比較」になっているかを確認する（CLAUDE.md の Why コメント規約に準拠）
- [ ] 重要度が高い教訓（同じ失敗を複数回犯す可能性がある設計パターン）を特定し、CLAUDE.md への追記要否を判断する
- [ ] CLAUDE.md に追記する場合は、既存セクションとの重複・矛盾がないことを確認する
- [ ] stigmergy / serena の記録がそれぞれ独立して検索可能なキーワードを含んでいることを確認する

---

## Knowledge Phase: 知見の永続化（必須セクション・チェックボックス）

- [ ] `.serena/memories/` に教訓を保存（`mcp__serena__write_memory`、ファイル名: `lessons-queue-repeat-loop` 形式）
- [ ] `stigmergy/` に教訓・パターンを記録（`lessons.jsonl` 追記 or `patterns/{category}.md`）
- [ ] 重要度が高い知見を Memory（CLAUDE.md）に追記
- [ ] `command -v brv` を確認し、利用可能なら byterover に保存（無ければスキップ・エラーにしない）

---

## Manual Verification

- [ ] 次セッション開始時に `mcp__serena__read_memory` で `lessons-queue-repeat-loop` を検索し、本機能の教訓が想起されること
- [ ] `stigmergy/` の記録を grep したとき、`loopEnabled`・`splice`・`ensureTabReady`・`selectPlaybackContent` などのキーワードで教訓がヒットすること
- [ ] byterover を使用した場合、`brv query "loop repeat queue"` 等で教訓が返ること
- [ ] CLAUDE.md に追記した場合、追記箇所が既存の記述と矛盾していないこと

---

## Dependencies

- **Requires**: Process 200（全実装・ドキュメント完了後に実施）
- **Blocks**: なし
