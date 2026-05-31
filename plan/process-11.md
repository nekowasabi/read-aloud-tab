# Process 11: キャッシュ短絡ユニットテスト（transformation）

## Implementation Brief（コピペ用）

- **背景**: Process 01 の playbackText 短絡実装（2周目に resolveContent を呼ばないこと）を検証するユニットテスト群が存在しない。テストB=「2周目の読み上げで summarizer/translator（OpenRouter）が呼ばれない（spy 0回）」を担保するため、専用テストファイルを新規作成する。
- **目的**: playbackText 有→resolveContent 未呼出・API 0回、無→呼出という短絡動作を TDD で検証する。1周目に playbackText が書込・永続化されること、write-once で上書きされないことも検証する。
- **変更範囲**:
  - `src/background/__tests__/tabManagerPlaybackCache.test.ts`（新規作成のみ）
- **playbackText の保存場所**: `TabInfo.playbackText`（`ReadingQueue.tabs[]` に保存）。独立 storage key（`PLAYBACK_TEXT_CACHE_KEY`）は作らないため assert では参照しない
- **禁止事項**:
  - spy が呼ばれないことの assert を緩める（API実行ゼロが要件の核）
  - 既存テストファイルへの変更
  - テスト以外のプロダクションコードへの変更
  - 数値リテラルの直書き（定数名参照）
- **出力順序**: 1) テスト作成 2) RED 確認 3) Process 01 実装後に GREEN 確認 4) 既存テスト回帰確認 5) Refactor 6) 品質ゲート

---

## Overview

Process 01 が実装する `playbackText` キャッシュ短絡を検証する専用テストファイルを TDD で作成する。

既存の `src/background/__tests__/tabManagerAiIntegration.test.ts` の spy 注入流儀（`setContentResolver` で `jest.fn()` を注入）を踏襲し、以下の4テストケース群を実装する：

1. **短絡ガード**: `tab.playbackText` 有の場合、`resolveContent` spy が 0 回呼ばれること。`selectPlaybackContent` が `playbackText` を返すこと。
2. **非短絡パス**: `tab.playbackText` 無の場合、`resolveContent` spy が呼ばれること（従来動作継続）。
3. **write-once 書込**: 1周目 `processNext` 後に `tab.playbackText` が確定テキストで設定され、`flushPersistence` 後の `storage.local` に保存されること。
4. **上書き禁止**: 既に `playbackText` 設定済みのタブで再生しても値が上書きされないこと。

---

## Affected Files

| ファイル | 変更種別 |
|---|---|
| `src/background/__tests__/tabManagerPlaybackCache.test.ts` | 新規作成（テストのみ） |

---

## Symbol Targets

```yaml
- file: src/background/__tests__/tabManagerPlaybackCache.test.ts
  symbols:
    - （新規テストファイルのため既存シンボルなし）
  patch_only: false
  disjoint_guarantee: n/a（test-only）
  pre_flight_checks:
    - 既存 tabManagerAiIntegration.test.ts の mockResolveContent spy 流儀踏襲を確認
    - setContentResolver メソッドが TabManager に存在することを確認
    - flushPersistence メソッドが TabManager に存在することを確認
    - getSnapshot メソッドが TabManager に存在し、戻り値が ReadingQueue 構造（.tabs[]）であることを確認
    - saveQueue（src/shared/utils/storage.ts）のモック形式を既存テストから確認
```

---

## Implementation Notes

### 1. 既存テストの流儀踏襲

`src/background/__tests__/tabManagerAiIntegration.test.ts` で使われている以下のパターンを踏襲する：

- `resolveContent` を `jest.fn()` として定義し、`tabManager.setContentResolver(mockResolveContent)` で注入する。
- `summarizer`・`translator`（OpenRouter API）は `jest.mock` でモック化し、spy として呼び出し回数を assert する。
- 永続化の検証は `saveQueue`（`src/shared/utils/storage.ts`）を mock し、その保存引数 `queue.tabs[].playbackText` を assert する。`playbackText` は独立 storage key ではなく `ReadingQueue.tabs[]` に含まれて `storage.local` に保存されるため、`chrome.storage.local.get` を JSON parse して storage key を assert する方式は採らない。

### 2. テストケース設計

#### テストケース 1: 短絡ガード（playbackText 有）

```typescript
it('tab.playbackText が設定済みの場合、resolveContent spy が呼ばれない', async () => {
  // Arrange: playbackText を事前設定
  const tab = createTabWithPlaybackText('cached text');
  tabManager.addTab(tab);

  // Act
  await tabManager.processNext();

  // Assert
  expect(mockResolveContent).toHaveBeenCalledTimes(0);
  // summarizer / translator も呼ばれない
  expect(mockSummarizer).toHaveBeenCalledTimes(0);
  expect(mockTranslator).toHaveBeenCalledTimes(0);
});

it('tab.playbackText が設定済みの場合、selectPlaybackContent が playbackText を返す', async () => {
  const cached = 'cached playback text';
  const tab = createTabWithPlaybackText(cached);
  tabManager.addTab(tab);

  await tabManager.processNext();

  // TTS エンジンに渡されたテキストが playbackText と一致する
  expect(mockTtsPlay).toHaveBeenCalledWith(
    expect.objectContaining({ text: cached }),
    expect.anything()
  );
});
```

#### テストケース 2: 非短絡パス（playbackText 無）

```typescript
it('tab.playbackText が未設定の場合、resolveContent spy が呼ばれる', async () => {
  const tab = createTabWithoutPlaybackText();
  tabManager.addTab(tab);

  await tabManager.processNext();

  expect(mockResolveContent).toHaveBeenCalledTimes(1);
});
```

#### テストケース 3: write-once 書込と永続化

```typescript
it('1周目の processNext 後に tab.playbackText が書き込まれ、storage.local に永続化される', async () => {
  const tab = createTabWithoutPlaybackText();
  tabManager.addTab(tab);
  mockResolveContent.mockResolvedValueOnce({ summary: 'resolved summary' });

  await tabManager.processNext();
  await tabManager.flushPersistence();

  // tab.playbackText が設定されている
  const snapshot = tabManager.getSnapshot();
  expect(snapshot.tabs[0].playbackText).toBeTruthy();

  // saveQueue の保存引数（queue.tabs[].playbackText）で永続化を assert する。
  // playbackText は独立 storage key ではなく ReadingQueue.tabs[] に含まれて保存される
  const savedQueue = mockSaveQueue.mock.calls.at(-1)?.[0];
  expect(savedQueue?.tabs[0].playbackText).toBeTruthy();
});
```

#### テストケース 4: write-once（上書き禁止）

```typescript
it('playbackText が既に設定済みのタブで processNext しても上書きされない', async () => {
  const original = 'original cached text';
  const tab = createTabWithPlaybackText(original);
  tabManager.addTab(tab);

  await tabManager.processNext();

  const snapshot = tabManager.getSnapshot();
  expect(snapshot.tabs[0].playbackText).toBe(original);
});
```

### 3. flushPersistence で永続化フラッシュ後に assert

`saveQueue` の呼び出しは `persistQueue` 内で非同期に行われる。`flushPersistence()` でフラッシュを待ってから `mockSaveQueue` の保存引数（`queue.tabs[].playbackText`）を assert すること。

### 4. ヘルパー関数のまとめ

spy セットアップとタブ生成は以下のヘルパーに集約する（Refactor Phase で整理）：

```typescript
// テスト共通ヘルパー
function createTabWithPlaybackText(text: string): TabInfo;
function createTabWithoutPlaybackText(): TabInfo;
function setupSpies(): {
  mockResolveContent: jest.Mock;
  mockSummarizer: jest.Mock;
  mockTranslator: jest.Mock;
  mockSaveQueue: jest.Mock;
};
```

---

## Behavior Specification

> **behavior_scope: false**。このテスト Process は Process 01 で仕様化済みの動作を検証するものであり、新たな仕様を追加しない。

Process 01 の入出力表（再掲・対応関係のみ）:

| tab.playbackText | resolveContent 呼出 | API 呼出 | テストケース |
|---|---|---|---|
| 有（非空） | 0 回 | 0 回 | テスト 1・2 |
| 無/空 | ≥ 1 回 | 条件付 | テスト 3 |

| 周目 | tab.playbackText 状態 | 書込 | テストケース |
|---|---|---|---|
| 1周目・未設定 | 未設定 → 確定テキスト | あり | テスト 4 |
| 1周目・設定済 | 変化なし | なし（write-once） | テスト 5 |

---

## Red Phase: テスト作成と失敗確認

- [ ] `src/background/__tests__/tabManagerAiIntegration.test.ts` の spy 注入流儀（`setContentResolver`・`jest.fn()` パターン）を読んで確認
- [ ] `TabManager` に `setContentResolver`・`flushPersistence` が存在することを確認
- [ ] `chrome.storage.local` モックの形式を既存テストから確認
- [ ] `src/background/__tests__/tabManagerPlaybackCache.test.ts` を新規作成
- [ ] テストケース 1: `playbackText` 有 → `resolveContent` spy 0 回を実装
- [ ] テストケース 2: `playbackText` 有 → `selectPlaybackContent` が `playbackText` を返すことを実装
- [ ] テストケース 3: `playbackText` 無 → `resolveContent` spy ≥ 1 回を実装
- [ ] テストケース 4: 1周目 → `playbackText` 書込・`storage.local` 永続化を実装
- [ ] テストケース 5: write-once → 上書きされないことを実装
- [ ] `npm run test -- tabManagerPlaybackCache` で **RED** であること（テスト失敗）を確認
- [ ] RED の原因が「Process 01 未実装による動作欠如」であることをエラーメッセージで確認

---

## Green Phase: 最小実装と成功確認

> Green Phase は Process 01 の実装完了が前提。Process 01 実装後に以下を確認する。

- [ ] Process 01 の実装（`playbackText` 型追加・`ensureTabReady` 短絡ガード・`selectPlaybackContent` ガード・`processNext` write-once 書込）が完了していることを確認
- [ ] `npm run test -- tabManagerPlaybackCache` で本 Process の全テストが **GREEN** であることを確認
- [ ] `npm run test -- tabManagerAiIntegration` で既存 AI 統合テストが回帰していないことを確認
- [ ] `npm run test` で全テストスイートが GREEN であることを確認
- [ ] `npm run typecheck` でエラーがないことを確認

---

## Refactor Phase: 品質改善

- [ ] `createTabWithPlaybackText`・`createTabWithoutPlaybackText` ヘルパー関数を `describe` 外のトップレベルに抽出して重複除去
- [ ] `setupSpies` ヘルパー関数でモック・spy のセットアップを一元化
- [ ] `beforeEach` で各テスト前に spy をリセット（`jest.clearAllMocks()`）
- [ ] `expect(mockResolveContent).toHaveBeenCalledTimes(0)` の代わりに `expect(mockResolveContent).not.toHaveBeenCalled()` を使用（可読性向上）
- [ ] テストケース説明文が「条件 → 期待動作」形式になっていることを確認
- [ ] `npm run lint` でエラーがないことを確認
- [ ] `npm run test` で全件 GREEN のままであることを確認

---

## Manual Verification

> **対象外**: 本 Process はテスト専用であり、自動テストで動作を完全に担保できるため手動確認は不要。

---

## Dependencies

- **Requires**: Process 01（`playbackText` 型追加・短絡実装・write-once 書込が存在しないとテストが GREEN にならない）
- **Blocks**: Process 200（結合テスト・E2E 検証フェーズ）
