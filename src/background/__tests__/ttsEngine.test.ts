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

    utterance.onend?.();

    expect(hooks.onEnd).toHaveBeenCalled();
    expect(hooks.onError).not.toHaveBeenCalled();
  });

  test('エラー発生時はonErrorが呼ばれ、再生は停止する', async () => {
    const hooks = {
      onEnd: jest.fn(),
      onError: jest.fn(),
    };

    const engine = new TTSEngine();
    await engine.start(createTab(), defaultSettings, hooks);

    const utterance = (SpeechSynthesisUtterance as jest.Mock).mock.results[0].value;
    utterance.onerror?.({ error: 'network' });

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
});
