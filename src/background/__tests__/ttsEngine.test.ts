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
});
