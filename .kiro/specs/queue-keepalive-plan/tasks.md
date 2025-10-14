# Implementation Plan

- [x] 1. keep-alive 制御基盤を導入する  
  - サービスワーカーで heartbeat を統括するコントローラを実装し、`reading` 状態の開始・終了に応じてアラームを生成または解除する。  
  - ブラウザフォーカス喪失後も keep-alive が継続することを確認するためのロギングと診断フックを組み込む。  
  - Fallback として runtime ポート経由の ping を送信し、アラームが欠落した際に service worker を再活性化する挙動を実装する。  
  - _Requirements: R1_
  - npm run test
  - npm run build:firefox

- [x] 1.1 アラームと fallback の詳細動作を仕上げる  
  - heartbeat アラームの周期・名称・ミスカウント制御を設定し、Chrome/Firefox 双方で互換性があるか検証する。  
  - Fallback ping の間隔と最大試行回数を定義し、アラームが複数回欠落した場合のみ発火する制御を実装する。  
  - keep-alive イベントをトリガとして TabManager へ no-op コマンドを送る処理を加える。  
  - _Requirements: R1_
  - npm run test
  - npm run build:firefox

- [x] 1.2 BackgroundOrchestrator を keep-alive と連携させる  
  - 状態リスナーで `reading` ↔ `idle/paused` の遷移を検知し、`KeepAliveController` と連携する。  
  - `runtime.onConnect` と `chrome.alarms.onAlarm` のハンドラを増強し、keep-alive の開始・停止・fallback を呼び出す。  
  - ポート切断時にも keep-alive 維持を優先するログとエラーハンドリングを追加する。  
  - _Requirements: R1, R2_
  - npm run test
  - npm run build:firefox

- [x] 2. Popup のポート再接続体験を整える  
  - `useTabQueue` に指数バックオフの再接続ロジックを導入し、初回 500ms から上限まで増加させる。  
  - `connectionState` と `lastError` を追加し、UI が再接続中や切断中の状態を表示できるようにする。  
  - ブラウザフォーカス喪失時に最初のポート切断を検知し、即座に再接続バックオフを起動する。  
  - _Requirements: R2_
  - npm run test
  - npm run build:firefox

- [x] 2.1 ポート管理のクリーンアップと UI 連携を行う  
  - `onDisconnect` でポート参照を null に戻し、リスナー登録の解除とタイマー停止を確実にする。  
  - 再接続成功時に初期状態要求を送信し、UI の進捗とキュー状態を再同期する。  
  - 再接続試行中のユーザー通知（バナーやトースト）の表示を実装し、開発者モードでは詳細ログを見られるようにする。  
  - _Requirements: R2, R4_
  - npm run test
  - npm run build:firefox

- [x] 3. 読み上げ状態のスナップショット復元を実装する  
  - TabManager がキュー・インデックス・進捗を含むスナップショットを永続化し、必要に応じて即時保存できるようにする。  
  - `initialize` 後にスナップショットを読み込み、`reading` 状態であれば再生再開を試行するフローを実装する。  
  - 再開が失敗した場合に `idle` へ戻し、購読者へエラー通知を送るロジックを加える。  
  - _Requirements: R3_
  - npm run test
  - npm run build:firefox

- [x] 3.1 TTSEngine との再開統合を整える  
  - 再開対象タブと進捗値をもとに `PlaybackController` を呼び出し、既存の start/resume API と整合を取る。  
  - データ不足や対象タブ不在のケースでフォールバック動作（idle 化）するための分岐とログを追加する。  
  - 保存頻度増加に備え、既存の persist デバウンス設定を調整し、必要時に強制保存できる仕組みを提供する。  
  - _Requirements: R3_
  - npm run test
  - npm run build:firefox

- [x] 4. 監視と開発者向け診断を拡充する  
  - keep-alive 開始・停止・ミス連続数、再接続試行回数などを `info` 以上のログで記録する。  
  - 開発者モードで heartbeat 状態と再接続指標を表示する UI コンポーネントを追加し、設定で有効化できるようにする。  
  - テストハーネスで heartbeat と再接続の分岐をモックできるユーティリティを整備する。  
  - _Requirements: R4_
  - npm run test
  - npm run build:firefox

- [x] 5. テストと検証を実施する  
  - KeepAliveController、useTabQueue、TabManager の単体テストを追加し、主要分岐を網羅する。  
  - BackgroundOrchestrator と keep-alive の統合、サービスワーカー再起動時の復元を扱う統合テストを実装する。  
  - Chrome 環境での手動検証手順を更新し、フォーカス喪失やポップアップクローズ時の再生継続を確認する。  
  - _Requirements: R1, R2, R3, R4_
