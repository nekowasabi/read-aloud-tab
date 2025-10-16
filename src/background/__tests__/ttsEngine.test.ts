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

  // Observable化によるギャップレス再生（process1-7）
  describe('Observable化によるチャンク切り替え（process1-7）', () => {
    test('chunkTransition$ Subjectが初期化される', async () => {
      const engine = new TTSEngine();

      // chunkTransition$ フィールドが存在することを確認
      expect((engine as any).chunkTransition$).toBeDefined();
      expect((engine as any).subscription).toBeDefined();
    });

    test('onendでchunkTransition$.next("next")が呼ばれる（複数チャンク時）', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const longContent = 'A'.repeat(100) + '。' + 'B'.repeat(100);
      const tab = createTab({ content: longContent });
      await engine.start(tab, defaultSettings, hooks);

      // Verify multiple chunks
      const chunks = (engine as any).chunks;
      expect(chunks.length).toBeGreaterThan(1);

      // Spy on chunkTransition$
      const nextSpy = jest.spyOn((engine as any).chunkTransition$, 'next');

      // Get first chunk utterance
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;

      // Trigger onstart to set isPaused = false
      firstUtterance.onstart?.();

      // Trigger onend
      firstUtterance.onend?.();

      // Wait for Observable to process
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have called chunkTransition$.next('next')
      expect(nextSpy).toHaveBeenCalledWith('next');
    });

    test('onendでchunkTransition$.next("complete")が呼ばれる（最後のチャンク時）', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const shortContent = 'Short text'; // Single chunk
      const tab = createTab({ content: shortContent });
      await engine.start(tab, defaultSettings, hooks);

      // Spy on chunkTransition$
      const nextSpy = jest.spyOn((engine as any).chunkTransition$, 'next');

      // Get first (and only) chunk utterance
      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;

      // Trigger onstart to set isPaused = false
      firstUtterance.onstart?.();

      // Trigger onend
      firstUtterance.onend?.();

      // Wait for Observable to process
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have called chunkTransition$.next('complete')
      expect(nextSpy).toHaveBeenCalledWith('complete');
    });

    test('Observable連鎖により次チャンクが自動再生される', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const longContent = 'A'.repeat(100) + '。' + 'B'.repeat(100);
      const tab = createTab({ content: longContent });
      await engine.start(tab, defaultSettings, hooks);

      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;

      // Clear speak mock
      (speechSynthesis.speak as jest.Mock).mockClear();

      // Trigger onstart and onend
      firstUtterance.onstart?.();
      firstUtterance.onend?.();

      // Wait for Observable to process
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have called speak() for next chunk via Observable
      expect(speechSynthesis.speak).toHaveBeenCalledTimes(1);
    });

    test('cleanup()でObservableの購読が解除される', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const tab = createTab({ content: 'Test content' });
      await engine.start(tab, defaultSettings, hooks);

      // Verify subscription is created
      expect((engine as any).subscription).not.toBeNull();

      // Call stop() which calls cleanup()
      engine.stop();

      // Verify subscription is unsubscribed
      expect((engine as any).subscription).toBeNull();
    });

    test('onendが最小化されており、重い処理がない', async () => {
      const hooks = {
        onEnd: jest.fn(),
        onError: jest.fn(),
        onProgress: jest.fn(),
      };

      const engine = new TTSEngine();
      const longContent = 'A'.repeat(100) + '。' + 'B'.repeat(100);
      const tab = createTab({ content: longContent });
      await engine.start(tab, defaultSettings, hooks);

      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;

      firstUtterance.onstart?.();

      // Measure onend execution time
      const startTime = Date.now();
      firstUtterance.onend?.();
      const endTime = Date.now();

      // onend should complete very quickly (< 5ms for minimal logic)
      const elapsedTime = endTime - startTime;
      expect(elapsedTime).toBeLessThan(5);
    });

    test('パフォーマンス計測が維持される', async () => {
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
      const longContent = 'A'.repeat(100) + '。' + 'B'.repeat(100);
      const tab = createTab({ content: longContent });
      await engine.start(tab, defaultSettings, hooks);

      const firstUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;

      // Trigger first chunk
      firstUtterance.onstart?.();
      firstUtterance.onend?.();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Get second chunk utterance
      const secondUtterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[1].value;

      mockLogger.info.mockClear();

      // Trigger second chunk onstart
      secondUtterance.onstart?.();

      // Should have logged gap time
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Chunk transition gap: \d+ms/)
      );
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


});
