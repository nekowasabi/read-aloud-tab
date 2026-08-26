---
task_id: "T-20260531-queue-repeat-loop"
title: "キューリピート再生 ＋ 確定テキストキャッシュ"
status: planning
created: "2026-05-31"
scope:
  - src/shared/types/tab.ts
  - src/shared/types/queue.ts
  - src/shared/types/helpers.ts
  - src/shared/messages.ts
  - src/shared/utils/storage.ts
  - src/background/tabManager.ts
  - src/background/runtimeCommandRouter.ts
  - src/background/service.ts
  - src/background/prefetch/scheduler.ts
  - src/popup/hooks/tabQueue/useQueueCommands.ts
  - src/popup/components/ControlButtons.tsx
  - src/popup/hooks/useTabQueue.ts
  - src/popup/components/App.tsx
depends_on: []
risk_flags: [data_migration, backwards_incompatible, frontend]
quality_gate:
  command: "npm run typecheck && npm run test && npm run lint"
  min_quality_score: "-"
commit_mode: manual
---

# Commander's Intent
**Purpose**: キュー全体を API 再実行ゼロで無限リピートし、タブ切替待機を撲滅する。
**End State**: loopEnabled トグルで確定テキスト(playbackText)を使い2周目以降は抽出・OpenRouter を呼ばず周回再生。
**Key Tasks**: (1) playbackText を processNext 書込・ensureTabReady/selectPlaybackContent 短絡 (2) handlePlaybackEnd を loop 分岐で splice 抑止＋先頭周回 (3) QUEUE_SET_LOOP 経路と popup トグル配線。

# ★ Constants（唯一の正・他は定数名で参照）
| 定数名 | 値 | 単位 | 備考 |
|---|---|---|---|
| DEFAULT_LOOP_ENABLED | false | bool | loopEnabled 省略時の既定（後方互換） |
| STORAGE_KEYS.READING_QUEUE | 'readingQueue' | - | 既存。queue は storage.local 維持 |
| QUEUE_SCHEMA_VERSION | 2 | - | 実体は STORAGE_KEYS.SCHEMA_VERSION＋storage.ts のリテラル2。optional 追加で bump 不要 |
> 数値の単一ソース。process・コードは定数名のみ参照。TTL/容量上限は作らない（MVP）。
> playbackText は ReadingQueue.tabs[].playbackText（TabInfo フィールド）として storage.local に保存し、独立 storage key（PLAYBACK_TEXT_CACHE_KEY）は作らない。ループ終端は findNextReadableIndex の -1→stopInternal で処理し、ガード定数（MAX_LOOP_GUARD_COUNT）も作らない。
# Scope
**対象**: frontmatter `scope` の13ファイル ＋ 新規テスト/ドキュメント。
**対象外**: キャッシュ無効化/リフレッシュ/TTL/容量上限 — MVP除外 ／ リピート回数・単一タブリピート — 要件はキュー全体ループのみ ／ スナップショット固定 — 動的追従が要件 ／ contentResolver.ts 改変 — 短絡は ensureTabReady 側 ／ SCHEMA bump・マイグレーション関数 — optional 追加で既存互換。
# Required Sections（risk_flags 連動）
| Flag | 必須セクション | 反映先 |
|---|---|---|
| data_migration | Migration & Compat | process-01/02 |
| backwards_incompatible | Backwards Compat Guard | process-02 |
| frontend | Frontend Constraints | process-04 |
> 対象外: security/external_api/multi_id/performance（API削減・splice削減で改善方向）。
# Progress Map
| Process | Title | Status | Disjoint | Type | File |
|---|---|---|---|---|---|
| 01 | playbackText キャッシュ | ☑ | n | 変換 | [→ plan/process-01.md](plan/process-01.md) |
| 02 | キュー全体ループ | ☑ | n | react | [→ plan/process-02.md](plan/process-02.md) |
| 03 | QUEUE_SET_LOOP 経路 | ☑ | y | - | [→ plan/process-03.md](plan/process-03.md) |
| 04 | popup UI トグル | ☑ | y | react | [→ plan/process-04.md](plan/process-04.md) |
| 05 | scheduler 抑止 | ☑ | y | 変換 | [→ plan/process-05.md](plan/process-05.md) |
| 10 | ループ制御テスト | ☑ | y | - | [→ plan/process-10.md](plan/process-10.md) |
| 11 | キャッシュ短絡テスト | ☑ | y | - | [→ plan/process-11.md](plan/process-11.md) |
| 200 | ドキュメント整備 | ☑ | n.a. | - | [→ plan/process-200.md](plan/process-200.md) |
| 300 | OODA レトロ | ☑ | n.a. | - | [→ plan/process-300.md](plan/process-300.md) |
**凡例**: Type=変換(transformation)/react(reactive)/-(scope:false)。Disjoint=y(symbol非重複・wave並列可)/n(tabManager.ts を P01・P02 共有→serial化)/n.a.(doc-only)。
**DAG**: `P01→{P02,P05,P11}; P02→{P03,P10}; P03→P04; {P04,P05,P10,P11}→P200→P300`（`{}`=並列, `→`=順序）
**Overall**: ☑ 9/9 completed
# Conflict Matrix
| Process | Symbols (file:symbol) | Disjoint | Conf | Evidence |
|---|---|---|---|---|
| 01 | tab.ts:TabInfo,cloneTabInfo / helpers.ts:SerializedTabInfo / tabManager.ts:processNext,ensureTabReady,selectPlaybackContent | true | high | LSP（symbol非重複） |
| 02 | queue.ts:ReadingQueue / storage.ts:loadQueue,DEFAULT_QUEUE / tabManager.ts:handlePlaybackEnd,initialize,createStatusPayload,setLoopEnabled | true | high | LSP（P01とファイル共有・symbol非重複） |
| 03 | messages.ts:QueueCommandMessage,QueueStatusPayload,isQueueCommandMessage / runtimeCommandRouter.ts:createRuntimeCommandRouter | true | high | LSP |
| 04 | useQueueCommands.ts:useQueueCommands / ControlButtons.tsx:ControlButtons | true | high | LSP（popup配下） |
| 05 | scheduler.ts:collectTargets | true | high | LSP |
| 10 | tabManager.ts:handlePlaybackEnd（参照のみ・新規テスト） | n/a | high | test-only |
| 11 | tabManager.ts:ensureTabReady（参照のみ・新規テスト） | n/a | high | test-only |
| 200 | docs/requirements/queue-repeat-loop.md / CLAUDE.md | n/a | high | doc-only |
| 300 | .serena/memories / stigmergy | n/a | high | doc-only |
> P01・P02 は tabManager.ts 共有だが symbol 非重複（symbol単位 disjoint=true）。同一ファイル故 Progress Map は安全側 `n`。
# Acceptance Criteria（要約）
**機能**: loop=true で末尾後に先頭読可タブへ周回・splice せず継続／2周目 resolveContent 未呼出（抽出・API ゼロ）即再生／1周目に playbackText 書込・永続化／loop=false で従来 splice・停止／速度・声は2周目変更可（テキスト不変）。
**品質**: 既存 tabManagerPlaybackEnd テストが loop 未設定で全 pass（後方互換）／typecheck・test・lint 通過。docs: queue-repeat-loop.md 作成・CLAUDE.md 追記。
# Docs to Update
| パス | 更新内容 | 必須条件 |
|---|---|---|
| docs/requirements/queue-repeat-loop.md | 要件・状態遷移表・データモデル・OUT_OF_SCOPE | P01-02 着手前 |
| CLAUDE.md | 「6. リピート＋キャッシュ」節（書込点・短絡・loop分岐・loopEnabled所属理由） | P01-05 完了後 |
# Don'ts
- 2周目に resolveContent を呼ぶ（抽出・OpenRouter 起動）= API実行ゼロ違反
- loop=true で splice 実行（周回不能）／loopEnabled を TTSSettings・QUEUE_UPDATE_SETTINGS で運ぶ（validateSettings で消える）
- playbackText を storage.sync 保存（8KB制限）／updateSettings のクリア対象に playbackText を含める（2周目破壊）
- TTL/リフレッシュ/容量上限の実装／loopEnabled 省略時に従来挙動を変える（後方互換破壊）
# Risks
| リスク | 対策 |
|---|---|
| 2周目に resolveContent が走り API 起動 | ensureTabReady 短絡を最優先＋P11 spy で未呼出 assert |
| 後方互換破壊（loop省略で挙動変化） | 全 loop 分岐を if(queue.loopEnabled) でガード・既存全テスト回帰ゲート |
| 速度変更で playbackText クリア→2周目破綻 | updateSettings のクリア対象に playbackText を含めない |

# Critical Review Addendum（実装前に反映必須）
> 2026-05-31 の批判的レビューで検出した計画上の未解決点。P01-05/P10/P11 着手前に各 process へ反映し、ここを空振り確認してから実装すること。→ 2026-05-31 反映完了（PLAN/process-01〜11 へ反映済み）。

## Blockers
| 指摘 | 影響 | 反映先 |
|---|---|---|
| `PLAYBACK_TEXT_CACHE_KEY` と `MAX_LOOP_GUARD_COUNT` が PLAN Constants に存在せず現コードにも未定義 | process の指示通りに実装・テストを書くと未定義参照になる | Constants / P01 / P10 / P11 ✅反映済み |
| `playbackText` の URL 変更・タブ reload 時の破棄条件が未定義 | 新 URL で旧ページの確定テキストを読み上げる stale playback が発生する | P01 / tabManager `onTabLoading`・`onTabUpdated` ✅反映済み |
| loop=true かつ中間タブ読了時の次 index 規則が曖昧 | splice 抑止後に同じタブを再生する、または次タブを飛ばす可能性がある | P02 / P10 ✅反映済み |
| `setLoopEnabled` 擬似コードが存在しない `broadcast` API を呼んでいる | 実装者が現 `emitStatus()` パターンと異なるコードを書く | P02 / P03 ✅反映済み |
| frontend scope に `App.tsx` / `useTabQueue.ts` が不足 | `setLoop` を作っても popup から呼べない、型が返らない | frontmatter scope / P04 ✅反映済み |
| scheduler の `current` タブ除外が未記載 | `playbackText` 済みの現在タブが prefetch 対象に残り API 実行ゼロを破る | P05 ✅反映済み |
| P11 のサンプルが存在しない `addToQueue` / `getQueue` を使っている | テストがコンパイル不能になる | P11 ✅反映済み |
| P10 の「全 Case RED」期待が P02 の loop=false GREEN 記述と矛盾 | TDD 判定を誤る | P10 ✅反映済み |

## Required Plan Fixes
- Constants は以下のどちらかに統一する:
  - 新規定数を作る場合: `src/shared/constants.ts` 等に `DEFAULT_LOOP_ENABLED` と必要なテスト用定数を追加し、PLAN Constants に明記する。
  - 作らない場合: `PLAYBACK_TEXT_CACHE_KEY` / `MAX_LOOP_GUARD_COUNT` の参照を process から削除する。`playbackText` は `ReadingQueue.tabs[].playbackText` として保存されるため、独立 storage key は不要。
- `playbackText` は「write-once」だが、同一タブの URL 変更・reload・明示的 content 更新で stale になる。`onTabLoading` と `onTabUpdated(url changed)` では `content/summary/translation` と同じ扱いで `playbackText` も破棄する方針を P01 に追記する。
- `handlePlaybackEnd` の loop=true 分岐は `completedIndex = currentIndex` の後、splice せず、次候補を `findNextReadableIndex(completedIndex + 1)` で探す。なければ `findNextReadableIndex(0)` へ wrap し、なおなければ `stopInternal(false)` で idle。唯一タブは `0` に戻る。
- `setLoopEnabled(enabled)` は `this.queue.loopEnabled = enabled; this.persistQueue().catch(...); this.emitStatus();` の既存非同期更新パターンに合わせる。`broadcast` は使用しない。
- P04 の対象に `src/popup/hooks/useTabQueue.ts` と `src/popup/components/App.tsx` を追加し、`UseTabQueueResult` に `setLoop` を公開して `ControlButtons` へ `loopEnabled` と `setLoop` を渡す。
- P05 は `current` push 条件にも `!current.playbackText` を入れる。候補ループだけの除外では不十分。
- P11 は現 API に合わせて `addTab()` と `getSnapshot()`、または `saveQueue` mock の保存引数で assert する。`chrome.storage.local.get` を JSON parse する設計は避ける。
- P10 は loop=false 回帰ケースを RED ではなく既存 GREEN ベースラインとして扱う。RED 期待は loop=true 新規挙動と `setLoopEnabled` 未実装ケースに限定する。
- 既存 `tabManagerPlaybackEnd.test.ts` の件数は「4テスト」固定で書かず、「既存全テスト」と表現する。

# Verification
**Manual**: 各 process の Manual Verification 参照（2周目 Network に OpenRouter 不出現／周回でタブ消えず／loop OFF 従来動作）。
**Automated**: `npm run typecheck && npm run test && npm run lint`
