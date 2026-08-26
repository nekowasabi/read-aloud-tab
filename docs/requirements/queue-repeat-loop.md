# queue-repeat-loop 要件定義

キュー全体ループ＋確定テキストキャッシュ機能の要件・設計・状態遷移・データモデルを記録する。

---

## 1-1. 機能概要

- **キュー全体ループ**: `loopEnabled` トグルで最後のタブ再生終了後に先頭へ戻る
- **確定テキストキャッシュ**: 1 周目の再生コンテンツを `playbackText` として TabInfo に永続化
- **2 周目以降 API 実行ゼロ**: `ensureTabReady` と `selectPlaybackContent` の両ガードで保証
- **動的追従**: ループ中に新タブが追加されると次周でプリフェッチ対象になる

---

## 1-2. 確定設計

- `playbackText` を `TabInfo` に追加し、`storage.local` で永続化
- `loopEnabled` を `ReadingQueue` に追加（`TTSSettings` 不可の理由は §1-7 参照）
- 専用コマンド `QUEUE_SET_LOOP` で `loopEnabled` をトグル
- `ensureTabReady`: `playbackText` が存在すれば即 return（API・プリフェッチ経路へ進まない）
- `selectPlaybackContent`: `playbackText` を最優先で返す短絡
- `handlePlaybackEnd`: `loopEnabled === true` かつ末尾到達時、`splice` を実行せずインデックスを先頭に巻き戻す

---

## 1-3. 状態遷移表（handlePlaybackEnd）

| 末尾到達 | loopEnabled | キュー状態 | 動作 |
|---|---|---|---|
| true | true | タブあり | splice しない・currentIndex = 0 に巻き戻し・次タブ再生 |
| true | true | 全タブ無視 | 無限ループ防止のため停止（status = idle） |
| true | false | タブあり | 従来どおり splice して末尾タブを除去・idle へ |
| true | false | タブなし | idle へ |
| false | - | - | 通常の次タブ再生 |

---

## 1-4. データモデル変更

| 変更先 | フィールド | 型 | 説明 |
|---|---|---|---|
| `TabInfo` | `playbackText` | `string \| undefined` | 再生確定テキスト（1 周目書込、以後読取専用） |
| `ReadingQueue` | `loopEnabled` | `boolean` | キューループ有効フラグ |
| `SerializedTabInfo` | `playbackText` | `string \| undefined` | storage.local 永続化用 |
| `QueueStatusPayload` | `loopEnabled` | `boolean` | Popup への状態通知用 |

---

## 1-5. 設計穴と採択理由（splice 抑止）

**問題**: `handlePlaybackEnd` は再生済みタブを `splice` でキューから除去するロジックを持つ。ループ時にこれを実行すると「末尾タブが消えて先頭に戻っても要素数が減り続ける」問題が発生する。

**Option A（採択）**: `loopEnabled === true` のとき `splice` を実行しない。
- 理由: キュー構成を保持したままインデックス巻き戻しで単純実装可能。playbackText キャッシュにより 2 周目以降の API コストはゼロ。

**Option B（却下）**: ループ末尾到達時にキューを再構築（再コピー）する。
- 却下理由: タブ追加・削除との競合処理が複雑化し、動的追従要件との相性が悪い。

---

## 1-6. playbackText 書込点と永続化

- **書込点**: `processNext`（1 周目の `selectPlaybackContent` 呼び出し直後）で `tab.playbackText = selectedText` を代入
- **永続化**: `persistQueue` 経由で `storage.local` に保存（`SerializedTabInfo.playbackText` として直列化）
- **読取**: `ensureTabReady` で `tab.playbackText` の存在を確認し、存在すれば即 return

---

## 1-7. loopEnabled を ReadingQueue に配置する理由

`TTSSettings` に配置した場合、`validateSettings` がスキーマ外フィールドを除去するため `loopEnabled` が永続化されない。キュー状態として `ReadingQueue` に配置し、キューの serialize/deserialize で管理する。

---

## 1-8. scheduler プリフェッチ抑止との連携

Process 05 で `collectTargets` に `candidate.playbackText` 除外条件を追加済み。2 周目以降は `ensureTabReady`（再生経路）と `collectTargets`（プリフェッチ経路）の両方で API 呼び出しがゼロになる。

---

## 1-9. OUT_OF_SCOPE

以下は本機能の対象外（将来 Process で別途検討）:

- playbackText のキャッシュ無効化・TTL・容量上限
- リピート回数指定（N 回ループ）
- 単一タブリピート（キュー全体ではなく 1 タブのみ繰り返す）
- スナップショット固定（ループ開始時点のタブリストを固定し動的追従しない）

---

## 1-10. テスト定義

**テスト A**: loopEnabled=true でキュー末尾到達時、currentIndex が 0 に巻き戻り、splice が実行されないこと

**テスト B**: 全タブが isIgnored=true の状態で loopEnabled=true の場合、無限ループを起こさず status が idle になること
