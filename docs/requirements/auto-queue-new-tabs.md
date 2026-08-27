# 新規タブ自動キュー追加 要件

## 目的

設定が有効な場合、新しく開いたタブを読み上げキューへ自動追加する。空タブは通常ページへ遷移した時点で追加対象とする。

## 対象 / 対象外

対象は設定画面の切替、設定転送、タブ生成・更新・削除・起動時のpending管理、キュー末尾への一回追加である。既存タブの遡及追加、自動再生、候補判定の拡張、追加権限、TTL、prefetch変更、`dist/`更新は対象外とする。

## 設定データ契約

- sync key `autoQueueNewTabs`、boolean、既定値false。欠損/読込障害はfalse。
- local key `pendingAutoQueueTabIds`、重複除去済み`number[]`、TTLなし。欠損/読込障害は空配列。
- exportはversion 3で`autoQueueNewTabs`をboolean必須とする。version 3の欠損・非booleanは拒否する。
- 旧versionのキー欠損は現在値を維持する。API keyは従来どおりexportしない。
- 保存障害は呼び出し元へ伝え、成功扱いにしない。

## 状態遷移

`off → 無処理`。`onCreated + 通常URL → 末尾追加済み`。`onCreated + 空/内部/不正URL → pending`。`pending + onUpdated + 最初の通常URL/候補 → 末尾追加・pending消費`。`pending + 通常URL/ignored → 追加せずpending消費`。`pending + 空/内部/不正 → pending維持`。`onRemoved/off/onStartup cleanup → pendingから削除`。同一tabIdは一度だけ追加する。

候補URLは `pendingUrl ?? url`。追加は既存候補判定と`addTab({ position: 'end', autoStart: false })`を使う。

## デシジョン表

| 設定 | URL | pending | 候補 | 結果 |
|---|---|---|---|---|
| off | 任意 | 任意 | 任意 | 無処理 |
| on | 通常 | なし | yes | 末尾へ1回追加 |
| on | 空/内部/不正 | なし | - | pending保存 |
| on | 通常 | あり | yes | 末尾へ1回追加、消費 |
| on | 通常 | あり | no | 追加なし、消費 |
| on | 空/内部/不正 | あり | - | pending維持 |

## エラー時挙動

イベントは単一Promise列で直列化する。各処理のrejectは記録して列を継続する。追加または保存に失敗した場合、pendingは消費しない。読み込み障害は設定false/pending空へ安全側に倒す。設定offは新規自動処理を停止するが、既存キューを変更しない。

## Chrome MV3・Firefox MV2互換

`tabs.onCreated`ではURLが未確定の場合があるため、pendingだけを`tabs.onUpdated`で補完する。[Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)。サービスワーカー停止でメモリ状態を失わないようlocalへ保存する。[Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)。`storage.session`は比較対象だが採用せず、両環境で既存利用実績のある`storage.local`を使い、ブラウザ起動時はpendingを全消去する。[MDN storage.session](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session)。マニフェスト権限は追加しない。

## 受け入れ条件

- 設定欠損時はoff、UIの切替と再表示が一致する。
- version 3 export/import、旧欠損保持、API key除外が成立する。
- 通常URLの新規タブ、空タブから通常URLへの遷移が各1回だけ追加される。
- ignoredは消費のみ、空/内部/不正は保留される。
- 削除、off、起動時cleanupで孤児pendingが残らない。
- 既登録tabの再追加、既存タブ更新による誤追加、自動再生がない。
- Chrome/Firefoxで権限追加なく動作する。

## 検証

P01〜P03のRed→Green→Refactor後、P100の対象Jest、typecheck、lint、両ビルド、全テスト、Chrome/Firefox実機確認を実施する。各ゲートは終了コードと出力1行を記録し、手動確認はブラウザー名・版・操作・観測結果を残す。
