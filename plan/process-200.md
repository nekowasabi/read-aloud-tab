# Process 200: ドキュメント整備

## Implementation Brief（コピペ用）

- **背景**: Process 01-05 でキューリピート＋確定テキストキャッシュ機能の実装が確定した。設計判断・状態遷移・データモデル変更を docs に固定し、CLAUDE.md のアーキテクチャ記述を最新状態に更新する。
- **目的**: 機能の要件と設計を docs に固定し、CLAUDE.md の「主要機能の実装アーキテクチャ」に新節を追加する。
- **変更範囲**:
  - `docs/requirements/queue-repeat-loop.md`（新規作成。`docs/requirements/` ディレクトリも新規）
  - `CLAUDE.md`（「主要機能の実装アーキテクチャ」に「6. キューリピート＋確定テキストキャッシュ」節追加）
- **参照する定数**: なし（ドキュメントのみ）
- **禁止事項**:
  - 実装と乖離した記述を残すこと（Why コメントと HOW の不整合）
  - 実装ファイルへの変更（ドキュメント Process のため不可）
  - OUT_OF_SCOPE 機能（キャッシュ無効化/TTL/容量上限/リピート回数/単一タブリピート/スナップショット固定）を仕様として記述すること
- **出力順序**: 1) docs/requirements/ 作成 → 2) queue-repeat-loop.md 作成 → 3) CLAUDE.md 新節追加 → 4) リンク・用語整合確認 → 5) レビュー観点セルフチェック

---

## Overview

Process 01-05 で実装確定したキューリピート＋確定テキストキャッシュ機能について、以下の記録が欠落している:

1. 設計判断（splice 抑止・両ガード・loopEnabled 配置先）の根拠
2. データモデル変更の全容（TabInfo.playbackText, ReadingQueue.loopEnabled 等）
3. 状態遷移表（handlePlaybackEnd の分岐条件）
4. OUT_OF_SCOPE 境界（将来の混入防止）

本 Process では `docs/requirements/queue-repeat-loop.md` を新規作成して上記を固定し、CLAUDE.md にアーキテクチャ概要節を追加することで、第三者が設計を再現理解できる状態にする。

---

## Affected Files

| # | ファイルパス | 変更内容 |
|---|---|---|
| 1 | `docs/requirements/queue-repeat-loop.md` | 新規作成（機能概要・設計・状態遷移・データモデル・設計穴と採択理由・OUT_OF_SCOPE） |
| 2 | `CLAUDE.md` | 「主要機能の実装アーキテクチャ」に「6. キューリピート＋確定テキストキャッシュ」節追加 |

---

## Symbol Targets

| フィールド | 値 |
|---|---|
| file | `docs/requirements/queue-repeat-loop.md` / `CLAUDE.md` |
| symbol | -（ドキュメントのみ） |
| patch_only | false |
| disjoint_guarantee | n/a |
| pre_flight_checks | 1) `docs/requirements/` ディレクトリが未存在であることを確認してから新規作成 / 2) CLAUDE.md の「主要機能の実装アーキテクチャ」セクション末尾を特定してから追記 |

---

## Implementation Notes

### 1. docs/requirements/queue-repeat-loop.md に記述する内容

#### 1-1. 機能概要

- キュー全体ループ: `loopEnabled` トグルで最後のタブ再生終了後に先頭へ戻る
- 確定テキストキャッシュ: 1周目の再生コンテンツを `playbackText` として TabInfo に永続化
- 2周目以降 API 実行ゼロ: `ensureTabReady` と `selectPlaybackContent` の両ガードで保証
- 動的追従: ループ中に新タブが追加されると次周でプリフェッチ対象になる

#### 1-2. 確定設計

- `playbackText` を `TabInfo` に追加し、`storage.local` で永続化
- `loopEnabled` を `ReadingQueue` に追加（`TTSSettings` 不可の理由は後述）
- 専用コマンド `QUEUE_SET_LOOP` で `loopEnabled` をトグル
- `ensureTabReady`: `playbackText` が存在すれば即 return（API・プリフェッチ経路へ進まない）
- `selectPlaybackContent`: `playbackText` を最優先で返す短絡
- `handlePlaybackEnd`: `loopEnabled === true` かつ末尾到達時、`splice` を実行せずインデックスを先頭に巻き戻す

#### 1-3. 状態遷移表（handlePlaybackEnd）

| 末尾到達 | loopEnabled | キュー状態 | 動作 |
|---|---|---|---|
| true | true | タブあり | splice しない・currentIndex = 0 に巻き戻し・次タブ再生 |
| true | true | 全タブ無視 | 無限ループ防止のため停止（status = idle） |
| true | false | タブあり | 従来どおり splice して末尾タブを除去・idle へ |
| true | false | タブなし | idle へ |
| false | - | - | 通常の次タブ再生 |

#### 1-4. データモデル変更

| 変更先 | フィールド | 型 | 説明 |
|---|---|---|---|
| `TabInfo` | `playbackText` | `string \| undefined` | 再生確定テキスト（1周目書込、以後読取専用） |
| `ReadingQueue` | `loopEnabled` | `boolean` | キューループ有効フラグ |
| `SerializedTabInfo` | `playbackText` | `string \| undefined` | storage.local 永続化用 |
| `QueueStatusPayload` | `loopEnabled` | `boolean` | Popup への状態通知用 |

#### 1-5. 調査で判明した設計穴と採択理由

**問題**: `handlePlaybackEnd` は再生済みタブを `splice` でキューから除去するロジックを持つ。ループ時にこれを実行すると「末尾タブが消えて先頭に戻っても要素数が減り続ける」問題が発生する。

**Option A（採択）**: `loopEnabled === true` のとき `splice` を実行しない。
- 理由: キュー構成を保持したままインデックス巻き戻しで単純実装可能。playbackText キャッシュにより 2 周目以降の API コストはゼロ。

**Option B（却下）**: ループ末尾到達時にキューを再構築（再コピー）する。
- 却下理由: タブ追加・削除との競合処理が複雑化し、動的追従要件との相性が悪い。

#### 1-6. playbackText 書込点と永続化

- **書込点**: `processNext`（1 周目の `selectPlaybackContent` 呼び出し直後）で `tab.playbackText = selectedText` を代入
- **永続化**: `persistQueue` 経由で `storage.local` に保存（`SerializedTabInfo.playbackText` として直列化）
- **読取**: `ensureTabReady` で `tab.playbackText` の存在を確認し、存在すれば即 return

#### 1-7. loopEnabled を ReadingQueue に配置する理由

`TTSSettings` に配置した場合、`validateSettings` がスキーマ外フィールドを除去するため `loopEnabled` が永続化されない。キュー状態として `ReadingQueue` に配置し、キューの serialize/deserialize で管理する。

#### 1-8. scheduler プリフェッチ抑止との連携

Process 05 で `collectTargets` に `candidate.playbackText` 除外条件を追加済み。2 周目以降は `ensureTabReady`（再生経路）と `collectTargets`（プリフェッチ経路）の両方で API 呼び出しがゼロになる。

#### 1-9. OUT_OF_SCOPE

以下は本機能の対象外（将来 Process で別途検討）:

- playbackText のキャッシュ無効化・TTL・容量上限
- リピート回数指定（N 回ループ）
- 単一タブリピート（キュー全体ではなく 1 タブのみ繰り返す）
- スナップショット固定（ループ開始時点のタブリストを固定し動的追従しない）

#### 1-10. テスト定義

**テスト A**: loopEnabled=true でキュー末尾到達時、currentIndex が 0 に巻き戻り、splice が実行されないこと
**テスト B**: 全タブが isIgnored=true の状態で loopEnabled=true の場合、無限ループを起こさず status が idle になること

---

### 2. CLAUDE.md に追加する節

「主要機能の実装アーキテクチャ」セクションの「5. プリフェッチ機能」の後に以下を追加:

```
### 6. キューリピート＋確定テキストキャッシュ

**概要**: loopEnabled トグルでキュー全体を繰り返し再生し、1 周目の再生コンテンツを playbackText
としてキャッシュすることで 2 周目以降の API 呼び出しをゼロにする機能。

**主要コンポーネント**:
- TabInfo.playbackText: 確定テキストキャッシュ（storage.local 永続化）
- ReadingQueue.loopEnabled: ループ有効フラグ（TTSSettings 不可: validateSettings が除去するため）
- QUEUE_SET_LOOP コマンド: loopEnabled のトグル

**playbackText 書込点（processNext write-once）**:
1 周目の selectPlaybackContent 直後に tab.playbackText へ代入し、persistQueue で永続化。

**ensureTabReady / selectPlaybackContent 短絡**:
- ensureTabReady: playbackText が存在すれば即 return（API・プリフェッチ経路へ進まない）
- selectPlaybackContent: playbackText を最優先で返す

**handlePlaybackEnd loop 分岐**:
loopEnabled === true かつ末尾到達時、splice を実行せず currentIndex = 0 に巻き戻す。
全タブが isIgnored=true の場合は無限ループ防止のため idle 停止。

**scheduler プリフェッチ抑止（Process 05 連携）**:
collectTargets にて candidate.playbackText が存在するタブを除外。
再生経路とプリフェッチ経路の両方で「API実行ゼロ」を完全保証。

**詳細設計**: docs/requirements/queue-repeat-loop.md 参照
```

---

## Behavior Specification

対象外: ドキュメント Process。`behavior_scope: false`

---

## Red Phase: 記述レビュー観点の用意

以下の観点を事前に用意し、Green Phase 完了後にセルフチェックする:

- [ ] `docs/requirements/` ディレクトリが存在しない状態から作成しているか確認
- [ ] queue-repeat-loop.md に「1-1 機能概要」から「1-10 テスト定義」まで全項目が揃っているか
- [ ] handlePlaybackEnd の状態遷移表（4 行）が全ケース網羅しているか
- [ ] データモデル変更表に `TabInfo`, `ReadingQueue`, `SerializedTabInfo`, `QueueStatusPayload` の 4 エントリがあるか
- [ ] splice 抑止の採択理由（Option A vs B）が記述されているか
- [ ] loopEnabled を TTSSettings でなく ReadingQueue に配置する理由（validateSettings によるフィールド除去）が明記されているか
- [ ] OUT_OF_SCOPE 項目（TTL/容量上限/リピート回数/単一タブリピート/スナップショット固定）が明示されているか
- [ ] CLAUDE.md 新節が「5. プリフェッチ機能」の後に追加されているか
- [ ] CLAUDE.md の新節に docs/requirements/queue-repeat-loop.md へのリンクが含まれるか
- [ ] 実装ファイルへの言及が「参照先」として正確か（存在しないファイルパスを記述していないか）

---

## Green Phase: 最小実装と成功確認

- [ ] `docs/requirements/` ディレクトリ新規作成
- [ ] `docs/requirements/queue-repeat-loop.md` 作成（Implementation Notes 1-1〜1-10 の全項目を網羅）
- [ ] `CLAUDE.md` の「主要機能の実装アーキテクチャ」末尾に「6. キューリピート＋確定テキストキャッシュ」節を追加
- [ ] 用語統一確認: `playbackText` / `loopEnabled` / `handlePlaybackEnd` / `ensureTabReady` / `selectPlaybackContent` のスペルが全文書で一致
- [ ] リンク確認: CLAUDE.md 新節の `docs/requirements/queue-repeat-loop.md` リンクが正しいパスか確認

---

## Refactor Phase: 品質改善

- [ ] queue-repeat-loop.md の節見出し順序がテンプレート（概要→設計→状態遷移→データモデル→設計穴→書込点→配置理由→連携→OUT_OF_SCOPE→テスト定義）に沿っているか
- [ ] CLAUDE.md 新節の記述量が他節（プリフェッチ機能等）と釣り合っているか（過剰・過少でないか）
- [ ] 重複記述がないか（CLAUDE.md と queue-repeat-loop.md で同じ情報を過度に繰り返していないか）
- [ ] 日本語の表記ゆれがないか（ループ/繰り返し、先頭/最初 等）

---

## Manual Verification

- [ ] docs/requirements/queue-repeat-loop.md を初見の開発者（実装コードなし）が読んで、「splice 抑止」と「両ガード（ensureTabReady + selectPlaybackContent）」の意図を説明できるか
- [ ] CLAUDE.md の新節だけを読んで、loopEnabled を TTSSettings に置けない理由が分かるか
- [ ] handlePlaybackEnd の状態遷移表を見て、全タブ無視時の無限ループ防止ケースが読み取れるか
- [ ] OUT_OF_SCOPE 節を見て、将来の機能追加時に「本 Process の対象外」と判断できるか

---

## Dependencies

- **Requires**: Process 01, 02, 03, 04, 05（実装確定後に記述）
- **Blocks**: Process 300
