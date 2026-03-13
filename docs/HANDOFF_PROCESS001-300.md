# 引き継ぎドキュメント: Process 001-300 実装記録

> 作成: 2026-03 / ブランチ: `codex-process-001-300-tdd`

---

## 1. 最初に読む 5 ファイル

次回セッションでこのコードベースに入る場合、以下の順で読むと全体像をつかめる。

| 優先度 | ファイル | 理由 |
|--------|---------|------|
| 1 | `PLAN.md` | Process 1-300 の設計意図・完了状況 |
| 2 | `src/background/service.ts` | BackgroundOrchestrator（全コマンドのエントリポイント）|
| 3 | `src/popup/hooks/useTabQueue.ts` | Popup↔Background ポート通信の中心 |
| 4 | `src/background/prefetch/scheduler.ts` | AI プリフェッチのスケジューリング |
| 5 | `src/shared/messages.ts` | 全メッセージ型・ペイロード定義 |

---

## 2. ファイル分割マップ（Process 50/100 で抽出したファイル）

### Process 50: Background Split

| 抽出元 | 抽出先（新規） | 責務 |
|--------|-------------|------|
| `service.ts` | `src/background/service/portRouter.ts` | runtime port のルーティング |
| `tabManager.ts` | `src/background/prefetch/scheduler.ts` | プリフェッチのスケジューリング |
| `service.ts` 内の inline | `src/background/prefetch/cancelledWaitStore.ts` | キャンセル済み wait のトラッキング |

### Process 100: Popup/Options Split

| 抽出元 | 抽出先（新規） | 責務 |
|--------|-------------|------|
| `App.tsx` | `src/popup/hooks/usePopupBootstrap.ts` | マウント時の初期データロード |
| `App.tsx` | `src/popup/hooks/useAddTabsActions.ts` | 1タブ追加・全タブ追加ロジック |
| `App.tsx` | `src/popup/hooks/usePopupSettingsSync.ts` | `chrome.storage.onChanged` リスナー管理 |
| `useTabQueue.ts` | `src/popup/hooks/tabQueue/useQueuePort.ts` | `chrome.runtime.Port` ライフサイクル |
| `useTabQueue.ts` | `src/popup/hooks/tabQueue/useQueueCommands.ts` | キューコマンド送信 |
| `useTabQueue.ts` | `src/popup/hooks/tabQueue/queueMessageReducer.ts` | 受信メッセージのパース・変換 |
| `OptionsApp.tsx` | `src/options/hooks/useOptionsData.ts` | 設定データの初期ロード |
| `OptionsApp.tsx` | `src/options/services/settingsTransfer.ts` | エクスポート/インポート純粋関数 |
| `OptionsApp.tsx` | `src/options/hooks/useConnectionTest.ts` | OpenRouter 接続テスト |

---

## 3. テストコマンドマップ

```bash
# 影響範囲を絞ったテスト
npm run test -- --testPathPattern="popup"           # Popup 系のみ (15スイート)
npm run test -- --testPathPattern="options"         # Options 系のみ
npm run test -- --testPathPattern="background"      # Background 系のみ
npm run test -- --testPathPattern="prefetch"        # プリフェッチ系のみ
npm run test -- --testPathPattern="useTabQueue"     # useTabQueue 単体
npm run test -- --testPathPattern="useQueuePort"    # ポート接続単体

# 全テスト（556件）
npm run test

# TypeScript 型チェック（エラーゼロ必須）
npm run typecheck

# Lint
npm run lint
```

### ホットスポット（変更時に必ず再実行）

| ファイルを変更した場合 | 追加で実行するテスト |
|----------------------|-------------------|
| `src/popup/hooks/tabQueue/useQueuePort.ts` | `useQueuePort.test.ts`, `useTabQueue.test.tsx` |
| `src/popup/components/App.tsx` | `App.test.tsx` |
| `src/options/OptionsApp.tsx` | `OptionsApp.test.tsx` |
| `src/background/prefetch/scheduler.ts` | `prefetchScheduler.test.ts` |
| `src/shared/messages.ts` | `offscreenMessages.test.ts`, `types.test.ts` |

---

## 4. アーキテクチャマップ（Process 001-300 完了後の構造）

```
popup/
├── components/
│   ├── App.tsx              ← 表示中心（340行、hooks に責務委譲済み）
│   └── ...
└── hooks/
    ├── useTabQueue.ts        ← エントリポイント（86行に短縮）
    ├── usePopupBootstrap.ts  ← [NEW] 初期ロード
    ├── useAddTabsActions.ts  ← [NEW] タブ追加アクション
    ├── usePopupSettingsSync.ts ← [NEW] storage 変更監視
    └── tabQueue/
        ├── useQueuePort.ts     ← [NEW] Port ライフサイクル
        ├── useQueueCommands.ts ← [NEW] コマンド送信
        └── queueMessageReducer.ts ← [NEW] メッセージ変換

options/
├── OptionsApp.tsx           ← 表示中心（280行に短縮）
├── hooks/
│   ├── useOptionsData.ts    ← [NEW] 設定データロード
│   └── useConnectionTest.ts ← [NEW] 接続テスト
└── services/
    └── settingsTransfer.ts  ← [NEW] export/import 純粋関数

background/
├── service.ts               ← BackgroundOrchestrator（972行）
├── tabManager.ts            ← キュー・TTS制御（1111行）
├── aiPrefetcher.ts          ← AI プリフェッチ統括（404行）
├── prefetch/
│   ├── scheduler.ts         ← [EXTRACTED] スケジューリング
│   ├── worker.ts            ← 処理パイプライン
│   ├── resultStore.ts       ← キャッシュ管理
│   └── cancelledWaitStore.ts ← [NEW] キャンセル追跡
└── service/
    └── portRouter.ts        ← [EXTRACTED] ポートルーティング
```

---

## 5. Chrome / Firefox 手動確認ポイント

### Chrome (Manifest V3)
1. **読み上げ継続**: Service Worker が 30秒でスリープしないことを確認（OffscreenDocument heartbeat が動作中）
2. **ポップアップ再接続**: ポップアップを閉じて再度開いたとき `connected` 状態に戻ること
3. **プリフェッチ**: 2タブ以上をキューに入れ、読み上げ開始後に次タブのステータスが変わること
4. **エクスポート/インポート**: 設定エクスポート JSON に `openRouterApiKey` が含まれないこと

### Firefox (Manifest V2 / persistent script)
1. **音声リスト取得**: 拡張機能インストール直後に音声が正しく選択されること（最大 10秒待機）
2. **読み上げ継続**: `persistent: true` により Service Worker タイムアウト問題なし（確認不要）
3. **ポップアップ**: Chrome と同様に port 再接続が動作すること

---

## 6. ロールバック手順

```bash
# 現在のブランチを確認
git log --oneline -5

# Process 100 以前（Process 50 完了時点）に戻す場合
git checkout 3899278  # "test: summaryWaitMode・cancelWait..." コミット

# Process 50 以前（main ブランチ）に戻す場合
git checkout main

# 変更を捨てて main に戻す（破壊的）
git checkout main
git branch -D codex-process-001-300-tdd
```

### 注意事項
- `PLAN.md` は `main` には存在しないため、ブランチ間でのマージ時に競合しない
- テスト設定（`jest.config.js`, `setupTests.ts`）は変更していない

---

## 7. 既知リスク・要注意箇所

| リスク | 場所 | 詳細 |
|--------|------|------|
| prefetch diagnostics 二重購読 | `App.tsx` + `service.ts` | `usePrefetchStatus` が port 経由で購読、service が direct send の二経路。次フェーズで一本化予定 |
| `handleResetQueue` dead code | `App.tsx:129` | 定義はあるが JSX で未使用。次フェーズで削除可 |
| `usePopupBootstrap` の `initError` 伝播 | `App.tsx:50-55` | `useEffect` で local `error` state にコピー。close ボタン後も `initError` が残る可能性あり |
| `tabManager.ts` が 1111行 | `background/tabManager.ts` | 依然として大きい。Process 200+ で分割検討 |
