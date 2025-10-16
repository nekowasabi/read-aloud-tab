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
});
