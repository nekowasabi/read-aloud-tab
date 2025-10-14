# Implementation Plan

- [ ] 1. Prefetch スケジューラーを実装してキューと連携する  
  - 背景オーケストレーターのステータスリスナーを拡張し、読み上げ中またはタブ切り替え時に先行処理対象を PrefetchScheduler へ通知する。  
  - PrefetchScheduler が最優先タブを選択し、同時実行が 1 件になるようにジョブキューを管理する。  
  - Prefetch ジョブキャンセルの条件（タブ削除・設定変更）を定義し、未処理タスクを即時破棄できるようにする。  
  - _Requirements: R1_
  - npm run test
  - npm run build:firefox

- [ ] 1.1 Prefetch Worker を構築して翻訳・要約パイプラインを走らせる  
  - PrefetchWorker がタブコンテンツを取得できるように TabManager へ `requestContentForPrefetch` を追加する。  
  - 要約生成→翻訳実行の順で OpenRouter API を呼び出し、ユーザー設定に応じた処理フローを分岐させる。  
  - 処理失敗時に指数バックオフで最大 3 回リトライし、それでも失敗した場合は失敗状態とエラーメッセージを記録する。  
  - _Requirements: R1, R2_
  - npm run test
  - npm run build:firefox

- [ ] 2. Prefetch 結果を永続化し鮮度を維持する  
  - ResultStore を実装し、翻訳・要約結果を `chrome.storage.local` にタイムスタンプ付きで保存する。  
  - TTL（10 分）と最大件数（10 件）の制御を行い、容量超過時は古いエントリから削除する。  
  - Prefetch 結果取得 API を TabManager/Popup から利用できるようにし、読み上げ前に再処理が必要か判定できる状態を返す。  
  - _Requirements: R2_
  - npm run test
  - npm run build:firefox

- [ ] 2.1 Prefetch 状態の通知と UI 連携を整備する  
  - PrefetchWorker 完了/失敗時に `PREFETCH_STATUS_SYNC` メッセージを送信し、ポップアップで状態を更新できるようにする。  
  - Popup 用に `usePrefetchStatus` hook を新設し、`chrome.storage.onChanged` と runtime メッセージの両方で状態を追跡する。  
  - 再試行ボタン操作を PrefetchScheduler に伝える `PREFETCH_RETRY` メッセージを設計し、失敗タスクのみ再投入できるようにする。  
  - _Requirements: R3_
  - npm run test
  - npm run build:firefox

- [ ] 3. 開発者モード診断とロギングを追加する  
  - keep-alive/Prefetch ログに加え、失敗連続回数や最終フォールバック発生時刻を診断ストレージへ記録する。  
  - Popup 開発者モードで診断バナーを表示し、接続状態・エラー・フォールバック履歴を確認できる UI を追加する。  
  - Prefetch 処理に関する info/warn/error ログを整理し、調査しやすいログメッセージ形式に統一する。  
  - _Requirements: R3_
  - npm run test
  - npm run build:firefox

- [ ] 4. テストと検証を実施して品質を担保する  
  - PrefetchScheduler の対象選定・キャンセル・バックオフロジックを単体テストでカバーする。  
  - PrefetchWorker と ResultStore の統合テストを追加し、要約・翻訳・保存・再取得のフローを検証する。  
  - Popup の先行処理表示・再試行 UI を React Testing Library で確認し、失敗ケースのユーザー通知を検証する。  
  - _Requirements: R1, R2, R3_
*** End Patch
