# Requirements Document

## Introduction
ブラウザが非アクティブでも読み上げが途切れないように、サービスワーカーの keep-alive 制御、ポート再接続、状態復元を統合的に設計し、ユーザーが連続読み上げを継続できる信頼性を高めることを目的とする。

## Requirements

### Requirement 1: サービスワーカーの継続稼働維持
**Objective:** 読み上げ中のユーザーとして、ブラウザにフォーカスしなくてもサービスワーカーが終了せず、読み上げが中断しないようにしたい。

#### Acceptance Criteria
1. WHEN キュー状態が `reading` に遷移した場合 THEN Background Orchestrator SHALL keep-alive アラームをプラットフォームが許容する最小周期で登録する。
2. WHILE キュー状態が `reading` の間 THE Background Orchestrator SHALL 次周期の前に既存の keep-alive アラームを再設定し続ける。
3. WHEN キュー状態が `idle` または `paused` に遷移した場合 THEN Background Orchestrator SHALL 既存の keep-alive アラームを解除する。
4. IF アラームによる keep-alive イベントが 3 連続で欠落した場合 THEN Background Orchestrator SHALL fallback として Offscreen Document もしくは no-op メッセージ送信による再活性化処理を発火する。
5. WHEN ブラウザフォーカスが喪失された場合 AND キュー状態が `reading` のとき THEN Background Orchestrator SHALL keep-alive アラームを維持し service worker の idle 遷移を防ぐ。

### Requirement 2: ポート接続の自動復旧
**Objective:** ポップアップ利用者として、バックグラウンドとのポートが切断されても UI が自動的に再接続して操作を継続できるようにしたい。

#### Acceptance Criteria
1. WHEN Runtime Port が `onDisconnect` を受け取った場合 THEN Popup Queue Client SHALL 現在のポート参照を null にリセットする。
2. WHEN ポート切断を検知した場合 THEN Popup Queue Client SHALL 指数バックオフを用いた再接続試行を 500ms 以内に開始する。
3. IF 再接続試行が成功した場合 THEN Popup Queue Client SHALL 初期状態要求メッセージを送信して UI ステートを同期する。
4. WHILE 再接続試行が継続中 THE Popup Queue Client SHALL UI に「再接続中」状態と最新エラーメッセージを表示する。
5. WHEN ブラウザフォーカスが喪失された場合 AND 最初のポート切断イベントが発生したとき THEN Popup Queue Client SHALL 同一タイミングで再接続バックオフを開始する。

### Requirement 3: 読み上げ状態の復元
**Objective:** 連続読み上げを行う利用者として、サービスワーカーが再起動しても進行中のタスクが適切に復元されてほしい。

#### Acceptance Criteria
1. WHEN Tab Manager が状態を永続化するトリガーを受けた場合 THEN Tab Manager SHALL 現在のキュー、インデックス、状態、進捗を永続ストレージへ保存する。
2. IF Tab Manager が初期化され AND 永続ストレージに `reading` 状態が保存されている場合 THEN Tab Manager SHALL 同一タブの再開を試行する。
3. WHEN 再開試行が失敗した場合 THEN Tab Manager SHALL キュー状態を `idle` に戻しエラーをキュー購読者へ通知する。
4. WHILE 復元に必要なデータが不足している間 THE Tab Manager SHALL 読み上げの自動再開を行わずユーザー操作を待機する。

### Requirement 4: 監視と開発者設定
**Objective:** 開発者として、keep-alive や再接続の挙動を検証しやすくし、問題発生時に迅速に原因を追跡できるようにしたい。

#### Acceptance Criteria
1. WHEN keep-alive アラームの生成・解除・失敗が発生した場合 THEN Background Orchestrator SHALL ログレベル `info` 以上で履歴を記録する。
2. IF 再接続試行が最大リトライ回数に達した場合 THEN Popup Queue Client SHALL ユーザー通知とともに開発者向け詳細ログを出力する。
3. WHEN 開発者モード設定が有効な場合 THEN Background Orchestrator SHALL heartbeat 間隔と fallback の発火回数をブラウザストレージに可視化する。
4. WHERE 自動化テスト環境が構成されている場合 THEN Test Harness SHALL heartbeat と再接続の分岐パスをモックし検証可能にする。
