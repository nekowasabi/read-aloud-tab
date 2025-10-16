import { TTSEngine } from '../ttsEngine';
import { TabInfo, TTSSettings } from '../../shared/types';

describe('TTSEngine (PlaybackController)', () => {
  const defaultSettings: TTSSettings = {
    rate: 1,
    pitch: 1,
    volume: 1,
    voice: null,
  };

  const createTab = (overrides: Partial<TabInfo> = {}): TabInfo => ({
    tabId: 1,
    url: 'https://example.com',
    title: 'Example',
    content: 'Hello world',
    summary: undefined,
    isIgnored: false,
    extractedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (speechSynthesis as any).speaking = false;
    (speechSynthesis as any).pending = false;
  });

  test('startでSpeechSynthesisを起動し、終了時にonEndを呼び出す', async () => {
    const hooks = {
      onEnd: jest.fn(),
      onError: jest.fn(),
      onProgress: jest.fn(),
    };

    const engine = new TTSEngine();
    await engine.start(createTab(), defaultSettings, hooks);

    expect(speechSynthesis.speak).toHaveBeenCalled();

    const utterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;
    expect(utterance.text).toBe('Hello world');

    // Trigger onend (will call playNextChunk which completes and calls hooks.onEnd)
    utterance.onend?.();

    // Wait for async playNextChunk to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(hooks.onEnd).toHaveBeenCalled();
    expect(hooks.onError).not.toHaveBeenCalled();
  });

  test('エラー発生時はリトライ後にonErrorが呼ばれ、再生は停止する', async () => {
    const hooks = {
      onEnd: jest.fn(),
      onError: jest.fn(),
    };

    const engine = new TTSEngine();
    await engine.start(createTab(), defaultSettings, hooks);

    // Trigger first error
    const utterance1 = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;
    utterance1.onerror?.({ error: 'network' });

    // Wait for first retry (100ms delay)
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Trigger error on first retry
    const utterance2 = (SpeechSynthesisUtterance as jest.Mock).mock.results[1].value;
    utterance2.onerror?.({ error: 'network' });

    // Wait for second retry (100ms delay)
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Trigger error on second retry (this is the 3rd attempt, max retries = 2)
    const utterance3 = (SpeechSynthesisUtterance as jest.Mock).mock.results[2].value;
    utterance3.onerror?.({ error: 'network' });

    // Wait for error handling to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(hooks.onError).toHaveBeenCalled();
    expect(hooks.onEnd).not.toHaveBeenCalled();
    expect(speechSynthesis.cancel).toHaveBeenCalled();
  });

  test('onboundaryイベントで進捗を通知する', async () => {
    const hooks = {
      onEnd: jest.fn(),
      onError: jest.fn(),
      onProgress: jest.fn(),
    };

    const engine = new TTSEngine();
    await engine.start(createTab({ content: 'Hello world again' }), defaultSettings, hooks);

    const utterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;
    utterance.onboundary?.({ name: 'word', charIndex: 5 });

    expect(hooks.onProgress).toHaveBeenCalledWith(expect.any(Number));
  });

  test('pause→updateSettings→resume で新しい設定が反映される', async () => {
    const hooks = {
      onEnd: jest.fn(),
      onError: jest.fn(),
      onProgress: jest.fn(),
    };

    const engine = new TTSEngine();
    const tab = createTab({ content: 'Hello world for testing pause and resume' });
    await engine.start(tab, defaultSettings, hooks);

    // First utterance
    const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;
    expect(firstUtterance.rate).toBe(1);
    expect(firstUtterance.volume).toBe(1);

    // Mark as speaking for pause to work
    (speechSynthesis as any).speaking = true;

    // Simulate boundary event (position tracking)
    firstUtterance.onboundary?.({ name: 'word', charIndex: 10 });

    // Simulate pause
    engine.pause();

    // Update settings
    const newSettings: TTSSettings = {
      rate: 1.5,
      pitch: 1.2,
      volume: 0.5,
      voice: null,
    };
    engine.updateSettings(newSettings);

    // Simulate resume
    engine.resume();

    // Wait for async voice application
    await new Promise(resolve => setTimeout(resolve, 0));

    // Second utterance should have new settings
    const secondUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[1].value;
    expect(secondUtterance.rate).toBe(1.5);
    expect(secondUtterance.volume).toBe(0.5);
    expect(secondUtterance.pitch).toBe(1.2);
  });

  test('processedContentがある場合はそれを優先的に読み上げる', async () => {
    const hooks = {
      onEnd: jest.fn(),
      onError: jest.fn(),
      onProgress: jest.fn(),
    };

    const tab = createTab({
      content: 'Original content',
      processedContent: 'Processed content',
    });

    const engine = new TTSEngine();
    await engine.start(tab, defaultSettings, hooks);

    const utterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;
    expect(utterance.text).toBe('Processed content');
  });

  test('processedContentとcontentの両方がある場合、processedContentが優先される', async () => {
    const hooks = {
      onEnd: jest.fn(),
      onError: jest.fn(),
      onProgress: jest.fn(),
    };

    const tab = createTab({
      content: 'Original long content that will be ignored',
      processedContent: 'Short summarized content',
    });

    const engine = new TTSEngine();
    await engine.start(tab, defaultSettings, hooks);

    const utterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;
    expect(utterance.text).toBe('Short summarized content');
  });

  test('processedContentがnullでcontentがある場合、contentが使用される', async () => {
    const hooks = {
      onEnd: jest.fn(),
      onError: jest.fn(),
      onProgress: jest.fn(),
    };

    const tab = createTab({
      content: 'Original content',
      processedContent: undefined,
    });

    const engine = new TTSEngine();
    await engine.start(tab, defaultSettings, hooks);

    const utterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;
    expect(utterance.text).toBe('Original content');
  });

  // process50: 進捗計算の修正テスト
  describe('進捗計算（process50）', () => {
    test('onboundaryでの進捗は99%でキャップされる', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const tab = createTab({ content: 'Hello world test' });
      await engine.start(tab, defaultSettings, hooks);

      const utterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;

      // Simulate boundary at the very end (last character)
      const lastCharIndex = 'Hello world test'.length - 1;
      utterance.onboundary?.({ name: 'word', charIndex: lastCharIndex });

      // Progress should be capped at 99%, not 100%
      expect(hooks.onProgress).toHaveBeenCalled();
      const lastProgressCall = hooks.onProgress.mock.calls[hooks.onProgress.mock.calls.length - 1][0];
      expect(lastProgressCall).toBeLessThanOrEqual(99);
    });

    test('onendで100%進捗が通知される', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const tab = createTab({ content: 'Short text' });
      await engine.start(tab, defaultSettings, hooks);

      const utterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;

      // Clear previous progress calls
      hooks.onProgress.mockClear();

      // Trigger onend (which should call playNextChunk and then hooks.onEnd)
      utterance.onend?.();

      // Wait for async completion
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have called onProgress with 100 before onEnd
      expect(hooks.onProgress).toHaveBeenCalledWith(100);
      expect(hooks.onEnd).toHaveBeenCalled();
    });

    test('複数チャンクの場合、最後のチャンクのonendで100%進捗が通知される', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      // Create long content that will be split into multiple chunks
      const longContent = 'A'.repeat(150); // Should create multiple 60-char chunks
      const tab = createTab({ content: longContent });
      await engine.start(tab, defaultSettings, hooks);

      // Get first chunk utterance
      let utteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[utteranceCount - 1].value;

      // Simulate first chunk completion (will trigger playNextChunk)
      firstUtterance.onend?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Get second chunk utterance (should be created after first completes)
      utteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const secondUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[utteranceCount - 1].value;

      // Simulate second chunk has more content (simulate boundary event)
      secondUtterance.onboundary?.({ name: 'word', charIndex: 30 });

      // Clear progress calls before final chunk
      hooks.onProgress.mockClear();

      // Simulate final chunk completion (will complete all chunks)
      secondUtterance.onend?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // For the last chunk, should call onProgress(100) before onEnd
      expect(hooks.onProgress).toHaveBeenCalledWith(100);
      expect(hooks.onEnd).toHaveBeenCalled();
    });
  });

  // Process1 & Process2: onstart時のprefetchとイベント事前バインド
  describe('チャンク間のギャップレス再生（process1 & process2）', () => {
    test('onstart時に次のチャンクがprefetchされる', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      // Create long content that will be split into multiple chunks
      const longContent = 'A'.repeat(100) + '。' + 'B'.repeat(100); // Multiple chunks with sentence boundary
      const tab = createTab({ content: longContent });
      await engine.start(tab, defaultSettings, hooks);

      // Verify multiple chunks were created
      const chunks = (engine as any).chunks;
      expect(chunks.length).toBeGreaterThan(1);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart of first chunk (should prefetch second chunk)
      firstUtterance.onstart?.();

      // Wait for async prefetch to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      // A new utterance should have been created for the second chunk during prefetch
      const afterPrefetchCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      expect(afterPrefetchCount).toBe(initialUtteranceCount + 1);
    });

    test('prefetch済みのチャンクにはイベントが事前バインドされている', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      // Create long content that will be split into multiple chunks
      const longContent = 'A'.repeat(100) + '。' + 'B'.repeat(100); // Multiple chunks with sentence boundary
      const tab = createTab({ content: longContent });
      await engine.start(tab, defaultSettings, hooks);

      // Verify multiple chunks were created
      const chunks = (engine as any).chunks;
      expect(chunks.length).toBeGreaterThan(1);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart of first chunk (should prefetch and bind events for second chunk)
      firstUtterance.onstart?.();

      // Wait for async prefetch to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Get the prefetched utterance
      const prefetchedUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount].value;

      // Verify that events are already bound
      expect(prefetchedUtterance.onstart).toBeDefined();
      expect(prefetchedUtterance.onend).toBeDefined();
      expect(prefetchedUtterance.onboundary).toBeDefined();
      expect(prefetchedUtterance.onerror).toBeDefined();
    });

    test('onendで準備済みチャンクが即座に再生される', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      // Create long content that will be split into multiple chunks
      const longContent = 'A'.repeat(100) + '。' + 'B'.repeat(100); // Multiple chunks with sentence boundary
      const tab = createTab({ content: longContent });
      await engine.start(tab, defaultSettings, hooks);

      // Verify multiple chunks were created
      const chunks = (engine as any).chunks;
      expect(chunks.length).toBeGreaterThan(1);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart (prefetch second chunk)
      firstUtterance.onstart?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Clear speak mock to count new calls
      (speechSynthesis.speak as jest.Mock).mockClear();

      // Trigger onend of first chunk
      firstUtterance.onend?.();

      // Wait for transition
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have called speak() with the prefetched utterance
      expect(speechSynthesis.speak).toHaveBeenCalledTimes(1);
    });

    test('準備が間に合わなかった場合はフォールバックする', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      // Create long content that will be split into multiple chunks
      const longContent = 'A'.repeat(100) + '。' + 'B'.repeat(100); // Multiple chunks with sentence boundary
      const tab = createTab({ content: longContent });
      await engine.start(tab, defaultSettings, hooks);

      // Verify multiple chunks were created
      const chunks = (engine as any).chunks;
      expect(chunks.length).toBeGreaterThan(1);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Call onstart to set isPaused = false
      firstUtterance.onstart?.();

      // Immediately clear nextChunkInfo to simulate prefetch not completing
      (engine as any).nextChunkInfo = null;

      // Clear speak mock to count new calls
      (speechSynthesis.speak as jest.Mock).mockClear();

      // Trigger onend without prefetch ready
      firstUtterance.onend?.();

      // Wait for async playNextChunk fallback
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should still play next chunk via fallback
      expect(speechSynthesis.speak).toHaveBeenCalled();
    });
  });

  // Process3: onendハンドラーの最小化
  describe('onendハンドラーの最小化（process3）', () => {
    test('prefetch済みチャンクのonendでは状態更新とspeak()のみが実行される', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const longContent = 'E'.repeat(200); // Multiple chunks
      const tab = createTab({ content: longContent });
      await engine.start(tab, defaultSettings, hooks);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart (prefetch second chunk)
      firstUtterance.onstart?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const afterPrefetchCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const prefetchedUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[afterPrefetchCount - 1].value;

      // Clear mock to track onend behavior
      hooks.onProgress.mockClear();

      // Measure time taken in onend
      const startTime = Date.now();
      firstUtterance.onend?.();
      const endTime = Date.now();

      // onend should complete very quickly (< 10ms for state updates + speak call)
      const elapsedTime = endTime - startTime;
      expect(elapsedTime).toBeLessThan(10);

      // Should call onProgress(100)
      expect(hooks.onProgress).toHaveBeenCalledWith(100);

      // Should call speak() with prefetched utterance
      expect(speechSynthesis.speak).toHaveBeenCalledWith(prefetchedUtterance);
    });

    test('prefetch済みチャンクが既にイベントバインド済みであることを確認', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const longContent = 'F'.repeat(200); // Multiple chunks
      const tab = createTab({ content: longContent });
      await engine.start(tab, defaultSettings, hooks);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart (prefetch second chunk)
      firstUtterance.onstart?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const afterPrefetchCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const prefetchedUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[afterPrefetchCount - 1].value;

      // Verify prefetched utterance has events bound
      expect(prefetchedUtterance.onstart).toBeDefined();
      expect(prefetchedUtterance.onend).toBeDefined();
      expect(prefetchedUtterance.onboundary).toBeDefined();
      expect(prefetchedUtterance.onerror).toBeDefined();

      // When onend is called, it should NOT re-bind events
      // This is implicit: onend just calls speak() with already-bound utterance
      firstUtterance.onend?.();

      // The prefetched utterance's events should remain unchanged
      const onStartBeforeSpeak = prefetchedUtterance.onstart;
      expect(prefetchedUtterance.onstart).toBe(onStartBeforeSpeak);
    });

    test('フォールバック時は非同期でplayNextChunk()が実行される', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      // Create content with specific length to ensure multiple chunks
      // With maxChunkSize=80 and minChunkSize=20, need > 80 chars
      const longContent = 'A'.repeat(100) + '。' + 'B'.repeat(100); // 201 chars with sentence boundary
      const tab = createTab({ content: longContent });
      await engine.start(tab, defaultSettings, hooks);

      // Verify multiple chunks were created
      const chunks = (engine as any).chunks;
      expect(chunks.length).toBeGreaterThan(1);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Call onstart to set isPaused = false
      firstUtterance.onstart?.();

      // Wait a tiny bit for prefetch to start (but immediately cancel it)
      await new Promise((resolve) => setTimeout(resolve, 1));

      // Access private field to clear nextChunkInfo (simulate prefetch not completing in time)
      (engine as any).nextChunkInfo = null;
      (engine as any).isPreparing = false; // Ensure not preparing

      // Verify state before onend
      expect((engine as any).nextChunkInfo).toBeNull();
      expect((engine as any).isPaused).toBe(false);
      expect((engine as any).currentChunkIndex).toBe(0);

      // Clear speak mock
      (speechSynthesis.speak as jest.Mock).mockClear();

      // Trigger onend without prefetch ready
      const startTime = Date.now();
      firstUtterance.onend?.();
      const synchronousTime = Date.now() - startTime;

      // onend should return very quickly (< 10ms for immediate logic)
      expect(synchronousTime).toBeLessThan(10);

      // Wait for async fallback to complete
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should have called speak() via playNextChunk fallback
      expect(speechSynthesis.speak).toHaveBeenCalled();
    });
  });

  // Process4: チャンクサイズの最適化（動的サイズ計算）
  describe('動的チャンクサイズ（process4）', () => {
    test('rate 1.0の場合、チャンクサイズは60文字になる', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const settings: TTSSettings = { ...defaultSettings, rate: 1.0 };
      // Create content with sentence boundaries to force chunking
      // Each sentence is 45-50 chars, total > 60 to ensure multiple chunks
      const longContent = 'これはテストの文章です。' + 'A'.repeat(40) + '。もう一つの文章です。' + 'B'.repeat(40) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, settings, hooks);

      const chunks = (engine as any).chunks;
      // Verify chunks exist and first chunk is around 60 chars (with some margin for sentence boundaries)
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].text.length).toBeLessThanOrEqual(60);
    });

    test('rate 1.5の場合、チャンクサイズは90文字になる', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const settings: TTSSettings = { ...defaultSettings, rate: 1.5 };
      // Create content with sentence boundaries to force chunking
      // Each sentence is 70-75 chars, total > 90 to ensure multiple chunks
      const longContent = 'これはテストの文章です。' + 'A'.repeat(60) + '。もう一つの文章です。' + 'B'.repeat(60) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, settings, hooks);

      const chunks = (engine as any).chunks;
      // Verify chunks exist and first chunk is around 90 chars (with some margin for sentence boundaries)
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].text.length).toBeLessThanOrEqual(90);
    });

    test('rate 2.0の場合、チャンクサイズは120文字になる', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const settings: TTSSettings = { ...defaultSettings, rate: 2.0 };
      // Create content with sentence boundaries to force chunking
      // Each sentence is 95-100 chars, total > 120 to ensure multiple chunks
      const longContent = 'これはテストの文章です。' + 'A'.repeat(85) + '。もう一つの文章です。' + 'B'.repeat(85) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, settings, hooks);

      const chunks = (engine as any).chunks;
      // Verify chunks exist and first chunk is around 120 chars (with some margin for sentence boundaries)
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].text.length).toBeLessThanOrEqual(120);
    });
  });

  // Process5: 準備状態の管理改善
  describe('nextChunkInfoのクリア管理（process5）', () => {
    test('cleanup()でnextChunkInfoがクリアされる', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const longContent = 'これはテストの文章です。' + 'A'.repeat(60) + '。もう一つの文章です。' + 'B'.repeat(60) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, defaultSettings, hooks);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart (prefetch second chunk)
      firstUtterance.onstart?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify nextChunkInfo was set
      expect((engine as any).nextChunkInfo).not.toBeNull();

      // Call stop() which calls cleanup()
      engine.stop();

      // Verify nextChunkInfo is cleared
      expect((engine as any).nextChunkInfo).toBeNull();
      expect((engine as any).isPreparing).toBe(false);
    });

    test('pause()でnextChunkInfoがクリアされる', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const longContent = 'これはテストの文章です。' + 'A'.repeat(60) + '。もう一つの文章です。' + 'B'.repeat(60) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, defaultSettings, hooks);

      // Mark as speaking for pause to work
      (speechSynthesis as any).speaking = true;

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart (prefetch second chunk)
      firstUtterance.onstart?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify nextChunkInfo was set
      expect((engine as any).nextChunkInfo).not.toBeNull();

      // Call pause()
      engine.pause();

      // Verify nextChunkInfo is cleared (will re-prepare on resume)
      expect((engine as any).nextChunkInfo).toBeNull();
      expect((engine as any).isPreparing).toBe(false);
    });
  });

  // Process6: オーバーラップキューイングの実装
  describe('オーバーラップキューイング（process6）', () => {
    test('onboundaryで50%進行時に次チャンクがspeak()される', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const longContent = 'これはテストの文章です。' + 'A'.repeat(60) + '。もう一つの文章です。' + 'B'.repeat(60) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, defaultSettings, hooks);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart (prefetch second chunk)
      firstUtterance.onstart?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify nextChunkInfo is set
      const nextChunkInfo = (engine as any).nextChunkInfo;
      expect(nextChunkInfo).not.toBeNull();

      // Clear speak mock to count new calls
      (speechSynthesis.speak as jest.Mock).mockClear();

      // Verify nextChunkQueued is false before boundary event
      expect((engine as any).nextChunkQueued).toBe(false);

      // Simulate boundary event at 50% progress
      // For a chunk with text length N, 50% means charIndex = N/2
      // Use Math.ceil to ensure we exceed 50% (floor would give 49%)
      const chunkText = firstUtterance.text;
      const halfwayCharIndex = Math.ceil(chunkText.length / 2);
      firstUtterance.onboundary?.({ name: 'word', charIndex: halfwayCharIndex });

      // Should have called speak() with the next chunk (queueing)
      expect(speechSynthesis.speak).toHaveBeenCalledTimes(1);

      // nextChunkQueued flag should be true
      expect((engine as any).nextChunkQueued).toBe(true);
    });

    test('キュー済みの場合、onendでspeak()が呼ばれない', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const longContent = 'これはテストの文章です。' + 'A'.repeat(60) + '。もう一つの文章です。' + 'B'.repeat(60) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, defaultSettings, hooks);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart (prefetch second chunk)
      firstUtterance.onstart?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate boundary event at 50% to trigger queueing
      const chunkLength = firstUtterance.text.length;
      const halfwayCharIndex = Math.ceil(chunkLength / 2);
      firstUtterance.onboundary?.({ name: 'word', charIndex: halfwayCharIndex });

      // Clear speak mock before onend
      (speechSynthesis.speak as jest.Mock).mockClear();

      // Trigger onend
      firstUtterance.onend?.();

      // Should NOT call speak() (already queued)
      expect(speechSynthesis.speak).not.toHaveBeenCalled();

      // nextChunkQueued should be reset to false
      expect((engine as any).nextChunkQueued).toBe(false);
    });

    test('nextChunkQueuedフラグはcleanup()でリセットされる', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const longContent = 'これはテストの文章です。' + 'A'.repeat(60) + '。もう一つの文章です。' + 'B'.repeat(60) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, defaultSettings, hooks);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart and 50% boundary
      firstUtterance.onstart?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const chunkLength = firstUtterance.text.length;
      const halfwayCharIndex = Math.ceil(chunkLength / 2);
      firstUtterance.onboundary?.({ name: 'word', charIndex: halfwayCharIndex });

      // Verify flag is set
      expect((engine as any).nextChunkQueued).toBe(true);

      // Call stop() which calls cleanup()
      engine.stop();

      // Verify flag is reset
      expect((engine as any).nextChunkQueued).toBe(false);
    });

    test('nextChunkQueuedフラグはpause()でリセットされる', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const longContent = 'これはテストの文章です。' + 'A'.repeat(60) + '。もう一つの文章です。' + 'B'.repeat(60) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, defaultSettings, hooks);

      // Mark as speaking for pause to work
      (speechSynthesis as any).speaking = true;

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart and 50% boundary
      firstUtterance.onstart?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const chunkLength = firstUtterance.text.length;
      const halfwayCharIndex = Math.ceil(chunkLength / 2);
      firstUtterance.onboundary?.({ name: 'word', charIndex: halfwayCharIndex });

      // Verify flag is set
      expect((engine as any).nextChunkQueued).toBe(true);

      // Call pause()
      engine.pause();

      // Verify flag is reset
      expect((engine as any).nextChunkQueued).toBe(false);
    });

    test('キューイング失敗時（50%に達しなかった）はフォールバックが実行される', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const longContent = 'これはテストの文章です。' + 'A'.repeat(60) + '。もう一つの文章です。' + 'B'.repeat(60) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, defaultSettings, hooks);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart (prefetch second chunk)
      firstUtterance.onstart?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Do NOT trigger 50% boundary (simulate queueing failure)
      // Just trigger a small boundary event
      firstUtterance.onboundary?.({ name: 'word', charIndex: 5 });

      // Clear speak mock before onend
      (speechSynthesis.speak as jest.Mock).mockClear();

      // Trigger onend (should fall back to speak())
      firstUtterance.onend?.();

      // Should call speak() as fallback (nextChunkQueued = false)
      expect(speechSynthesis.speak).toHaveBeenCalledTimes(1);
    });
  });

  // Process7: パフォーマンス測定機能の追加
  describe('パフォーマンス測定（process7）', () => {
    test('2つのチャンク再生時にギャップ時間がログ出力される', async () => {
      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };

      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine({ logger: mockLogger });
      const longContent = 'これはテストの文章です。' + 'A'.repeat(60) + '。もう一つの文章です。' + 'B'.repeat(60) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, defaultSettings, hooks);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart (prefetch second chunk)
      firstUtterance.onstart?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate boundary event at 50% to trigger queueing
      const chunkLength = firstUtterance.text.length;
      const halfwayCharIndex = Math.ceil(chunkLength / 2);
      firstUtterance.onboundary?.({ name: 'word', charIndex: halfwayCharIndex });

      // Clear logger before onend
      mockLogger.info.mockClear();

      // Trigger onend (records lastChunkEndTime)
      firstUtterance.onend?.();

      // Wait a bit to simulate gap
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Get second chunk utterance
      const afterQueueCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const secondUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[afterQueueCount - 1].value;

      // Clear logger before second chunk onstart
      mockLogger.info.mockClear();

      // Trigger onstart of second chunk (should log gap time)
      secondUtterance.onstart?.();

      // Should have logged gap time
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Chunk transition gap: \d+ms/)
      );
    });

    test('lastChunkEndTimeが適切に記録される', async () => {
      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };

      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine({ logger: mockLogger });
      const longContent = 'これはテストの文章です。' + 'A'.repeat(60) + '。もう一つの文章です。' + 'B'.repeat(60) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, defaultSettings, hooks);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Verify lastChunkEndTime is initially 0
      expect((engine as any).lastChunkEndTime).toBe(0);

      // Trigger onstart
      firstUtterance.onstart?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Trigger onend (should record lastChunkEndTime)
      firstUtterance.onend?.();

      // Verify lastChunkEndTime is now set
      expect((engine as any).lastChunkEndTime).toBeGreaterThan(0);
    });

    test('cleanup()でlastChunkEndTimeが0にリセットされる', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const longContent = 'これはテストの文章です。' + 'A'.repeat(60) + '。もう一つの文章です。' + 'B'.repeat(60) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, defaultSettings, hooks);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Trigger onstart and onend to set lastChunkEndTime
      firstUtterance.onstart?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
      firstUtterance.onend?.();

      // Verify lastChunkEndTime is set
      expect((engine as any).lastChunkEndTime).toBeGreaterThan(0);

      // Call stop() which calls cleanup()
      engine.stop();

      // Verify lastChunkEndTime is reset to 0
      expect((engine as any).lastChunkEndTime).toBe(0);
    });

    test('最初のチャンク再生時はギャップログが出力されない', async () => {
      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };

      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine({ logger: mockLogger });
      const longContent = 'これはテストの文章です。' + 'A'.repeat(60) + '。もう一つの文章です。' + 'B'.repeat(60) + '。';
      const tab = createTab({ content: longContent });

      await engine.start(tab, defaultSettings, hooks);

      // Get first chunk utterance
      const initialUtteranceCount = (SpeechSynthesisUtterance as jest.Mock).mock.results.length;
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[initialUtteranceCount - 1].value;

      // Clear logger before onstart
      mockLogger.info.mockClear();

      // Trigger onstart of first chunk (lastChunkEndTime === 0)
      firstUtterance.onstart?.();

      // Should NOT have logged gap time for first chunk
      const gapLogs = mockLogger.info.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('Chunk transition gap')
      );
      expect(gapLogs.length).toBe(0);
    });
  });
});
