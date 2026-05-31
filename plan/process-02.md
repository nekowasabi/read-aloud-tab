# Process 2: キュー全体ループ（loopEnabled + handlePlaybackEnd 分岐）

## Implementation Brief（コピペ用）

- **背景**: Chrome Manifest V3 のキュー読み上げにおいて、複数タブを連続再生する場合、現在の handlePlaybackEnd は読了タブを splice 除去するため1周でキューが空になる。loopEnabled トグルで無限周回再生を実現するためには splice 抑止と先頭周回処理が必要。
- **目的**: loopEnabled=true のとき、キュー末尾到達後に先頭へ周回して再生を継続する。splice 除去をしないことでキューを維持し、現在の動的なキューに追従する（スナップショット固定しない）。
- **変更範囲**:
  - `src/shared/types/queue.ts`: ReadingQueue インターフェースに `loopEnabled?: boolean` 追加
  - `src/shared/utils/storage.ts`: DEFAULT_QUEUE に loopEnabled:DEFAULT_LOOP_ENABLED 追加、loadQueue で既存データへの既定補完
  - `src/background/tabManager.ts`: handlePlaybackEnd に loop 分岐追加、initialize で loopEnabled 正規化、createStatusPayload に loopEnabled 追加、setLoopEnabled 新設
- **参照する定数**（PLAN.md ★Constants の定数名のみ・数値リテラル禁止）:
  - `DEFAULT_LOOP_ENABLED`
  - `STORAGE_KEYS.READING_QUEUE`
  - `QUEUE_SCHEMA_VERSION`（据置・bump 不要）
- **禁止事項**（PLAN.md Don'ts 該当抜粋）:
  - loopEnabled=true で handlePlaybackEnd の splice を実行（周回不能になる）
  - loopEnabled を TTSSettings に入れる／QUEUE_UPDATE_SETTINGS で運ぶ（validateSettings で消える）
  - loopEnabled 省略時に従来挙動を変える（後方互換破壊）
- **出力順序**: 1) 実装 2) セルフレビュー 3) 修正 4) 再レビュー 5) ドキュメント更新確認 6) 品質ゲート

---

## Overview

loopEnabled トグルによるキュー全体無限リピート機能を実装する。

現状の handlePlaybackEnd は読了タブを splice 除去するため、放置すると1周でキューが空になる。本 Process では:

1. `loopEnabled=true` 時に splice を抑止してキューを保持する
2. 末尾到達時（findNextReadableIndex(completedIndex+1)==-1）に findNextReadableIndex(0) で先頭へ wrap して再走査する
3. 全タブが無視状態の場合は stopInternal（無限空ループ防止）

`loopEnabled=false/undefined` 時は既存挙動を一切変更しない（全 loop 分岐を `if (this.queue.loopEnabled)` でガード）。

---

## Affected Files

| # | ファイル | 変更種別 |
|---|---------|---------|
| 1 | `src/shared/types/queue.ts` | 型追加（ReadingQueue に loopEnabled フィールド） |
| 2 | `src/shared/utils/storage.ts` | DEFAULT_QUEUE 更新・loadQueue に既定補完追加 |
| 3 | `src/background/tabManager.ts` | handlePlaybackEnd loop 分岐・initialize 正規化・createStatusPayload 更新・setLoopEnabled 新設 |

---

## Symbol Targets

| ファイル | シンボル | 種別 | 行 | patch_only | disjoint_guarantee | pre_flight_checks |
|---------|---------|------|---|------------|-------------------|------------------|
| src/shared/types/queue.ts | ReadingQueue | interface | L5-13 | true | true | - |
| src/shared/utils/storage.ts | DEFAULT_QUEUE | property | L13-25 | true | true | saveQueue/loadQueue が storage.local であることを確認 |
| src/shared/utils/storage.ts | loadQueue | function | L197-232 | true | true | 同上 |
| src/background/tabManager.ts | handlePlaybackEnd | method | L861-902 | true | false（Process 01 とファイル共有） | loop/repeat 既存実装ゼロ確認、handlePlaybackEnd の splice 位置 L867-870 確認 |
| src/background/tabManager.ts | initialize | method | L136-188 | true | false | 同上 |
| src/background/tabManager.ts | createStatusPayload | method | L813-824 | true | false | 同上 |
| src/background/tabManager.ts | setLoopEnabled | method | 新規 | true | false | 同上 |

---

## Implementation Notes

### handlePlaybackEnd の現在の制御フロー

```
L867-870: 読了タブを splice 除去
L886-888: currentIndex >= len なら 0 折返し
L891-898: findNextReadableIndex == -1 なら stopInternal
```

### loopEnabled=true 時の変更点

(a) 読了タブを splice しない（キュー維持・確定テキスト playbackText を周回再生のため保持）
(b) `findNextReadableIndex` は前方走査のみで wrap しない（-1 で末尾）ため、wrap は handlePlaybackEnd 側で明示的に行う

index 規則を曖昧さなく確定するため、loop=true 分岐は以下の式に統一する:

```typescript
const completedIndex = this.queue.currentIndex;
if (this.queue.loopEnabled) {
  // splice しない（周回再生のため確定テキスト playbackText を保持）
  let nextIndex = this.findNextReadableIndex(completedIndex + 1);
  if (nextIndex === -1) nextIndex = this.findNextReadableIndex(0); // 先頭へ wrap
  if (nextIndex === -1) { this.stopInternal(false); return; }      // 読めるタブ皆無→idle
  this.processNext(nextIndex); // 唯一タブは nextIndex===completedIndex で同タブ再生
  return;
}
// loop=false: 既存挙動（splice）を維持
```

- 中間タブ: `nextIndex = completedIndex + 1`
- 末尾タブ: `findNextReadableIndex(completedIndex + 1)` が -1 → `findNextReadableIndex(0)` で先頭へ wrap
- 唯一タブ: wrap 後 `nextIndex === completedIndex` となり同一タブを playbackText で再生（API ゼロ）
- 全無視: 両方 -1 → `stopInternal(false)` で idle（無限空ループ防止）

### loopEnabled=false/undefined 時

現 handlePlaybackEnd を一切変えない（全 loop 分岐を `if (this.queue.loopEnabled)` でガード）。

### 無限空ループ防止

loopEnabled=true でも全タブが isIgnored 等で `findNextReadableIndex(completedIndex + 1)` と `findNextReadableIndex(0)` の両方が -1 なら `stopInternal(false)`（idle 化）。

### setLoopEnabled メソッド

```typescript
// Why: ReadingQueue 所属。TTSSettings 不可（validateSettings が rate/pitch/volume/voice 以外を除去するため）
// Why: broadcast 直呼びではなく emitStatus() を使う。broadcast は BackgroundOrchestrator（service.ts）所属で
//      TabManager には存在しない。状態通知の正経路は emitStatus()→createStatusPayload()→status listener。
//      永続化は pause()/resume() と同じく persistQueue().catch(...) で fire-and-forget する。
setLoopEnabled(enabled: boolean): void {
  this.queue.loopEnabled = enabled;
  this.persistQueue().catch((error) => {
    this.logError('QUEUE_PERSIST_FAILED', error);
  });
  this.emitStatus();
}
```

### findNextReadableIndex の周回設計

findNextReadableIndex(L985-992)は from から前方走査のみで周回しない（-1 で末尾）。wrap は handlePlaybackEnd 側で `findNextReadableIndex(0)` を再走査して明示的に行う設計。

### persistQueue の注意点

persistQueue は遅延バッチ（persistTimer）。テストでは flushPersistence() 必須。

---

## Behavior Specification

**behavior_scope**: true
**system_type**: reactive

### 状態遷移表

| 現状態 | イベント | ガード | 次状態 | 事後条件 |
|--------|---------|--------|--------|---------|
| reading(tab i, 中間) | onEnd | loopEnabled=false | reading(i+1) | tab i splice 除去・次再生 |
| reading(tab i, 中間) | onEnd | loopEnabled=true | reading(i+1) | splice せず nextIndex=findNextReadableIndex(completedIndex+1)=i+1 |
| reading(末尾) | onEnd | loopEnabled=false | idle | splice→キュー空→stopInternal |
| reading(末尾) | onEnd | loopEnabled=true | reading(先頭読可) | splice せず findNextReadableIndex(completedIndex+1)=-1→findNextReadableIndex(0) で先頭へ wrap |
| reading(唯一タブ) | onEnd | loopEnabled=true | reading(同タブ) | wrap 後 nextIndex===completedIndex で同一タブを playbackText で再生（API ゼロ） |
| reading(全タブ無視) | onEnd | loopEnabled=true | idle | findNextReadableIndex(completedIndex+1) と findNextReadableIndex(0) が両方 -1→stopInternal(false)（無限空ループ防止） |
| reading | onEnd | キュー空（loop 無関係） | idle | 既存挙動維持 |

### Correctness Criteria

- loopEnabled=false 時 handlePlaybackEnd は現コードと完全等価
- loop 時タブ数不変（splice しない）
- 全無視時に無限ループしない

### Left to Implementation

- wrap を handlePlaybackEnd 内で行うか processNext(0) 再入かは自由

---

## Migration & Compat

- `loopEnabled` は optional フィールド
- `loadQueue`/`initialize` で `loopEnabled ?? DEFAULT_LOOP_ENABLED` 補完
- 既存 storage.local データは loopEnabled なしでも壊れない
- `QUEUE_SCHEMA_VERSION` 据置（bump 不要）—— オプショナル追加のため

---

## Backwards Compat Guard

- 全 loop 分岐を `if (this.queue.loopEnabled)` でガード
- false/undefined 時は現 handlePlaybackEnd を変更しない
- loopEnabled=false 時は handlePlaybackEnd が現コードと**完全等価**であり、既存全テスト（`tabManagerPlaybackEnd.test.ts`）が GREEN ベースラインとして pass する
- 既存全テスト（`tabManagerPlaybackEnd.test.ts`）を回帰ゲートとし、loopEnabled 未設定で全 pass を維持

---

## Red Phase: テスト作成と失敗確認

> **注**: 詳細テストは Process 10 で実装。本 Process では最小限の失敗確認のみ行う。

- [ ] `src/background/__tests__/tabManagerLoop.test.ts` を新規作成
- [ ] **テスト: loopEnabled=true で末尾到達後に先頭へ周回**
  - キュー2タブ設定 / loopEnabled=true / 末尾タブの onEnd をトリガー
  - タブ数が変わらないこと（splice されていない）を assert
  - 先頭タブの playback が開始されることを assert
  - 実行 → RED 確認（loopEnabled 未実装のため失敗）
- [ ] **テスト: loopEnabled=false で末尾到達後に idle**
  - キュー2タブ設定 / loopEnabled=false（または未設定）/ 末尾タブの onEnd をトリガー
  - stopInternal が呼ばれることを assert
  - 実行 → GREEN 確認（既存挙動と等価）
- [ ] **テスト: loopEnabled=true で全タブ無視時に idle**
  - キュー2タブ（全 isIgnored=true）/ loopEnabled=true / onEnd をトリガー
  - stopInternal が呼ばれることを assert（無限空ループ防止）
  - 実行 → RED 確認
- [ ] **テスト: setLoopEnabled でキューに反映・status 配信**
  - setLoopEnabled(true) 呼び出し
  - queue.loopEnabled=true を assert
  - emitStatus 経由で createStatusPayload の loopEnabled=true が status listener に届くことを assert
  - 実行 → RED 確認（setLoopEnabled 未実装）
- [ ] **回帰ゲート: 既存全テスト（tabManagerPlaybackEnd.test.ts）が全 pass することを確認**
  - `npx jest src/background/__tests__/tabManagerPlaybackEnd.test.ts`
  - 実装前に全 pass を確認しておく（GREEN ベースライン / 回帰ベースライン）

---

## Green Phase: 最小実装と成功確認

- [ ] `src/shared/types/queue.ts`: ReadingQueue に `loopEnabled?: boolean` フィールドを追加
- [ ] `src/shared/utils/storage.ts`: DEFAULT_QUEUE に `loopEnabled: DEFAULT_LOOP_ENABLED` を追加
- [ ] `src/shared/utils/storage.ts`: loadQueue の戻り値で `loopEnabled: queue.loopEnabled ?? DEFAULT_LOOP_ENABLED` 補完を追加
- [ ] `src/background/tabManager.ts`: handlePlaybackEnd に loop 分岐を追加
  - `if (this.queue.loopEnabled)` ブロックで splice を抑止
  - `nextIndex = findNextReadableIndex(completedIndex+1)`、-1 なら `findNextReadableIndex(0)` で先頭へ wrap、再走査
  - 両方 -1 なら stopInternal(false)（無限空ループ防止）
  - false/undefined 時は既存コードを完全に維持（GREEN ベースライン）
- [ ] `src/background/tabManager.ts`: initialize で `this.queue.loopEnabled ?? DEFAULT_LOOP_ENABLED` 正規化
- [ ] `src/background/tabManager.ts`: createStatusPayload に `loopEnabled: this.queue.loopEnabled ?? DEFAULT_LOOP_ENABLED` を追加
- [ ] `src/background/tabManager.ts`: setLoopEnabled メソッド新設（Why コメント必須）
- [ ] `npx jest src/background/__tests__/tabManagerLoop.test.ts` → 全 GREEN 確認
- [ ] `npx jest src/background/__tests__/tabManagerPlaybackEnd.test.ts` → 回帰ゲート 全 pass 確認
- [ ] `npm run typecheck` → エラー 0 確認

---

## Refactor Phase: 品質改善

- [ ] handlePlaybackEnd の loop 分岐が `if (this.queue.loopEnabled)` で完全にガードされていることを確認
- [ ] setLoopEnabled の Why コメントが記載されていることを確認
  - `// Why: ReadingQueue 所属。TTSSettings 不可（validateSettings が rate/pitch/volume/voice 以外を除去するため）`
- [ ] loop 分岐内のコードが不必要な複雑性を持っていないことを確認（senior engineer チェック）
- [ ] DEFAULT_LOOP_ENABLED の定数参照が正しく行われており、数値/boolean リテラルが直接使用されていないことを確認
- [ ] 既存テストの全 pass 維持確認
  - `npm run test`
- [ ] lint 通過確認
  - `npm run lint`
- [ ] 品質ゲート完全通過確認
  - `npm run typecheck && npm run test && npm run lint`

---

## Manual Verification

- [ ] **ループ ON: 全タブ読了後に先頭に戻る**
  - 複数タブをキューに追加
  - ループ ON に設定
  - 全タブ読み上げ完了まで待機
  - タブが消えずに先頭から再生が継続されることを確認
- [ ] **ループ OFF: 全タブ読了後に idle（従来動作）**
  - 複数タブをキューに追加
  - ループ OFF（デフォルト）に設定
  - 全タブ読み上げ完了後にキューが空になり停止することを確認
  - タブが順次消去されていることを確認
- [ ] **ループ ON: 周回中に無視ドメイン混在**
  - 無視ドメインのタブと通常タブを混在させてキューに追加
  - ループ ON で再生
  - 毎周で無視タブがスキップされ、通常タブのみが読み上げられることを確認

---

## Dependencies

- **Requires**: Process 01（弱依存 — playbackText が2周目に必要だが、ループ制御単体はテスト可）
- **Blocks**: Process 03（QUEUE_SET_LOOP メッセージ経路）、Process 10（ループ制御ユニットテスト）
