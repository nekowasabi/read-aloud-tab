# Requirements Document

## Introduction
連続読み上げを行う際に次のタブへ切り替えるたび翻訳・要約を待たされる課題を解消するため、読み上げ中に先行して処理を行う仕組みを導入し、切り替え時のレスポンスを安定させる。

## Requirements

### Requirement 1: 先行処理キューのスケジューリング
**Objective:** 背景オーケストレーターとして、読み上げ中に次の候補タブを自動的に先行処理して切り替え時の待機をなくしたい。

#### Acceptance Criteria
1. WHEN キュー状態が `reading` になった AND 次に読み上げ可能なタブが存在するとき THEN Prefetch Service SHALL 500ms 以内にそのタブの翻訳・要約ジョブをスケジュールする。
2. WHEN 現在の読み上げタブが入れ替わった THEN Prefetch Service SHALL 直近の順序に基づいてジョブの優先度を再計算する。
3. WHILE Prefetch Service がジョブを実行している間 THE Prefetch Service SHALL 同時実行数を 1 に制限しシステム負荷を抑制する。
4. WHERE キューからタブが削除された場合 THEN Prefetch Service SHALL 当該タブに紐づく未処理ジョブを即時にキャンセルする。

### Requirement 2: 翻訳・要約結果の提供
**Objective:** Queue Prefetcher として、翻訳・要約した結果を切り替え時に即座に利用できる状態で提供したい。

#### Acceptance Criteria
1. WHEN 先行処理ジョブが完了した場合 THEN Queue Prefetcher SHALL 翻訳テキストと要約テキストをタイムスタンプ付きで永続化する。
2. IF 永続化済みの結果が 10 分以上前に生成された場合 THEN Queue Prefetcher SHALL 次回読み上げ前に再処理を要求する。
3. WHILE 永続ストレージ使用量が上限に近い間 THE Queue Prefetcher SHALL 最も古い結果から順に自動削除して空き容量を確保する。
4. WHERE 翻訳機能がユーザー設定で無効化されている場合 THEN Queue Prefetcher SHALL 要約のみを生成し翻訳リソースを消費しない。

### Requirement 3: ユーザー体験とエラーハンドリング
**Objective:** ポップアップ利用者として、先行処理の進捗と失敗時の挙動がわかりやすく、読み上げの流れが途切れないようにしてほしい。

#### Acceptance Criteria
1. WHEN 利用者がポップアップを開いた場合 THEN Popup Client SHALL 各タブの先行処理状態（未処理/処理中/完了/失敗）を再接続後 300ms 以内に取得して表示する。
2. WHEN 先行処理が失敗した場合 THEN Popup Client SHALL 失敗理由を通知し、ユーザーが必要に応じて手動で再試行できる操作を提供する。
3. IF 読み上げ中に先行処理結果がまだ利用可能でない場合 THEN Queue Prefetcher SHALL 状態を `prefetch-pending` として読み上げ開始後も処理継続する。
4. WHERE エラーが連続して発生した場合 (3 回連続) THEN Prefetch Service SHALL エラー内容とタイムスタンプを開発者モード向け診断ストレージに記録する。
