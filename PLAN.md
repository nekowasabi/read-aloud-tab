# title: ブラウザ非アクティブ時のキュー切断調査

## 概要
- ポップアップのフォーカス喪失時に発生するキュー切断および TTS 停止の要因を特定し、再発防止のための改善ポイントを整理する。

### goal
- 利用者が複数タブを連続読み上げ中にブラウザへフォーカスしなくても再生が継続する課題を明確化し、対応方針の土台を構築する。

## 必須のルール
- 必ず `CLAUDE.md` を参照し、ルールを守ること

## 開発のゴール
- 切断の直接原因（ポートおよびサービスワーカーのアイドル化）と副次的影響（再生再開時の postMessage 失敗）をドキュメント化し、改善タスクへ繋ぐ。

## 実装仕様
- `useTabQueue` がポート切断時にエラー表示のみで再接続・ `portRef` クリアを行わない点を記録。
- Manifest V3 サービスワーカーがポップアップ消失後にアイドルとなり、ポート切断とキュー停止を引き起こすフローを明示。
- `TabManager.initialize` がサービスワーカー再起動後に状態を `idle` へ強制するため連続読み上げが継続しないことを整理。
- 再生ボタンクリック時に発生する `Attempt to postMessage on disconnected port` の再現手順と原因を明記。

## 生成AIの学習用コンテキスト
### TypeScript
- src/popup/hooks/useTabQueue.ts
  - ポート接続と切断ハンドリングの現状実装を参照。
- src/background/service.ts
  - BackgroundOrchestrator によるポート管理とサービスワーカーのライフサイクルを確認。
- src/background/tabManager.ts
  - 再起動時に `status` を `idle` 化している初期化処理を参照。
- src/background/offscreen/offscreen.ts
  - Chrome offscreen ドキュメントが TTS を継続する仕組みを把握。

### Documentation
- src/manifest/manifest.chrome.json
  - Manifest V3 サービスワーカー構成と offscreen 権限を確認。

## Process
### process1 切断挙動の実測と原因整理
#### sub1 ポップアップ側のポート管理調査
@target: src/popup/hooks/useTabQueue.ts
@ref: src/popup/hooks/__tests__/useTabQueue.test.tsx
- [x] 切断時に `portRef` が null へ戻されず、再接続処理が無い点を確認した。

#### sub2 バックグラウンドサービスワーカーの停止条件調査
@target: src/background/service.ts
@ref: src/manifest/manifest.chrome.json
- [x] Manifest V3 サービスワーカーがアイドルで終了し、ポートが切断されるシナリオを整理した。

#### sub3 キュー状態遷移の副作用確認
@target: src/background/tabManager.ts
@ref: src/background/ttsEngine.ts
- [x] サービスワーカー再起動時に `reading` 状態が `idle` へ強制されるため、読み上げが継続しないことを確認した。

#### sub4 再生コマンド送信時の例外調査
@target: src/popup/components/App.tsx
@ref: src/shared/messages.ts
- [x] 切断後に `Attempt to postMessage on disconnected port` が発生する再現と原因を特定した。

### process10 ユニットテスト
- [ ] 改善実装後に追加するテストケースを検討（現時点では調査のみ）。

### process50 フォローアップ
- [x] keep-alive 戦略（alarms/ハートビート）の設計とタスク化。
  - Chrome Manifest V3 では service worker をイベント駆動で起こす必要があるため、読み上げが続く間だけ `chrome.alarms` を利用したハートビートを維持する。`BackgroundOrchestrator` のステータスリスナーで `reading` → heartbeat start、`idle`/`paused` → heartbeat stop をトリガし、`chrome.alarms.onAlarm` では no-op メッセージを `tabManager` に送ってイベントループをキープする。
  - Offscreen Document が存在する場合は補助的に `chrome.runtime.connect` を用いた長寿命ポートを確立し、heartbeat が途切れた際に `chrome.runtime.Port` 経由で `PING` を送る fallback を設計する（Firefox では alarm のみ動作）。
  - 実装タスク: 1) `src/background/keepAlive.ts` に heartbeat 管理モジュールを新設、2) `BackgroundOrchestrator.initialize` でキュー状態イベントに紐づけ、3) `src/background/index.ts` で `chrome.alarms.onAlarm` を購読し `BrowserAdapter` 経由の no-op メッセージを発火、4) e2e 的に queue resume/stop で alarm が正しく作成・破棄されることを Jest モックで検証。
- [x] `useTabQueue` 再接続および `portRef` リセットロジックの実装検討。
  - `port.onDisconnect` で `portRef.current` を null へ戻し、即時 UI 状態更新と再接続バックオフ（例: 500ms, 1s, 2s）を走らせる。バックオフは unmount 時にクリアできるように `retryTimerRef` を追加。
  - `isConnected`/`error` ステートを `CONNECTING` フラグで拡張し、UI 側でスピナー表示と「再接続中」を出す余地を確保。`REQUEST_QUEUE_STATE` の初期送信は接続確立後に `port.postMessage` できるよう effect を分離。
  - 実装タスク: 1) `useTabQueue` に再接続 effect を導入、2) `chrome.runtime.lastError` の内容を `error` に反映、3) 切断後に `QUEUE_STATUS_UPDATE` を受けた際の冪等性テストを `useTabQueue.test.tsx` に追加。
- [x] `TabManager` 再起動後の状態復元機構の設計評価。
  - 現状 `initialize` で `reading` を `idle` に戻しているため、`queue.statusPersisted` のようなフラグを `StorageManager` に保存し、service worker 再起動時に「前回 `reading` 中だったか」「現在のタブと progress」があれば自動 `resume` を試行する。復元が失敗した場合のみ `idle` へフォールバックしてエラーを通知。
  - `activePlaybackToken` を永続化する代わりに `PlaybackController` へ `resumeFrom(tabId, progress)` API を追加する検討。progress が無いブラウザでも `SpeechSynthesisUtterance` を先頭から読み直す fallback を設ける。
  - 実装タスク: 1) `TabManager.persistQueue` で `status`/`currentIndex`/`progressByTab` を保存、2) `initialize` 時に復元フローを追加し `BackgroundOrchestrator` から `resumePlaybackIfNeeded` を呼び出す、3) 復元テストを `src/background/__tests__/tabManager.test.ts` に追加して `reading` → restart → resume をカバー。

### process100 リファクタリング
- [ ] 改善実装時にポート管理・状態管理を共通化する余地を検討。

### process200 ドキュメンテーション
- [x] 調査結果を PLAN.md に反映した。
