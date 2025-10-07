import { isOffscreenCommandMessage, isOffscreenBroadcastMessage, OffscreenCommandMessage, OffscreenBroadcastMessage } from '../messages';
import { TabInfo, TTSSettings } from '../types';

describe('Offscreen Messages', () => {
  describe('isOffscreenCommandMessage', () => {
    it('should return true for OFFSCREEN_TTS_START', () => {
      const message: OffscreenCommandMessage = {
        type: 'OFFSCREEN_TTS_START',
        payload: {
          tab: { tabId: 1, url: 'https://example.com', title: 'Test', content: 'Hello' } as TabInfo,
          settings: { rate: 1, pitch: 1, volume: 1 } as TTSSettings,
        },
      };
      expect(isOffscreenCommandMessage(message)).toBe(true);
    });

    it('should return true for OFFSCREEN_TTS_PAUSE', () => {
      const message: OffscreenCommandMessage = { type: 'OFFSCREEN_TTS_PAUSE' };
      expect(isOffscreenCommandMessage(message)).toBe(true);
    });

    it('should return true for OFFSCREEN_TTS_RESUME', () => {
      const message: OffscreenCommandMessage = { type: 'OFFSCREEN_TTS_RESUME' };
      expect(isOffscreenCommandMessage(message)).toBe(true);
    });

    it('should return true for OFFSCREEN_TTS_STOP', () => {
      const message: OffscreenCommandMessage = { type: 'OFFSCREEN_TTS_STOP' };
      expect(isOffscreenCommandMessage(message)).toBe(true);
    });

    it('should return true for OFFSCREEN_TTS_UPDATE_SETTINGS', () => {
      const message: OffscreenCommandMessage = {
        type: 'OFFSCREEN_TTS_UPDATE_SETTINGS',
        payload: { settings: { rate: 1.5 } as TTSSettings },
      };
      expect(isOffscreenCommandMessage(message)).toBe(true);
    });

    it('should return false for invalid messages', () => {
      expect(isOffscreenCommandMessage(null)).toBe(false);
      expect(isOffscreenCommandMessage(undefined)).toBe(false);
      expect(isOffscreenCommandMessage('string')).toBe(false);
      expect(isOffscreenCommandMessage(123)).toBe(false);
      expect(isOffscreenCommandMessage({})).toBe(false);
      expect(isOffscreenCommandMessage({ type: 'INVALID_TYPE' })).toBe(false);
    });
  });

  describe('isOffscreenBroadcastMessage', () => {
    it('should return true for OFFSCREEN_TTS_STATUS', () => {
      const message: OffscreenBroadcastMessage = {
        type: 'OFFSCREEN_TTS_STATUS',
        payload: { status: 'speaking' },
      };
      expect(isOffscreenBroadcastMessage(message)).toBe(true);
    });

    it('should return true for OFFSCREEN_TTS_PROGRESS', () => {
      const message: OffscreenBroadcastMessage = {
        type: 'OFFSCREEN_TTS_PROGRESS',
        payload: { progress: 0.5, timestamp: Date.now() },
      };
      expect(isOffscreenBroadcastMessage(message)).toBe(true);
    });

    it('should return true for OFFSCREEN_TTS_ERROR', () => {
      const message: OffscreenBroadcastMessage = {
        type: 'OFFSCREEN_TTS_ERROR',
        payload: { code: 'TTS_ERROR', message: 'Test error' },
      };
      expect(isOffscreenBroadcastMessage(message)).toBe(true);
    });

    it('should return true for OFFSCREEN_TTS_END', () => {
      const message: OffscreenBroadcastMessage = { type: 'OFFSCREEN_TTS_END' };
      expect(isOffscreenBroadcastMessage(message)).toBe(true);
    });

    it('should return false for invalid messages', () => {
      expect(isOffscreenBroadcastMessage(null)).toBe(false);
      expect(isOffscreenBroadcastMessage(undefined)).toBe(false);
      expect(isOffscreenBroadcastMessage('string')).toBe(false);
      expect(isOffscreenBroadcastMessage(123)).toBe(false);
      expect(isOffscreenBroadcastMessage({})).toBe(false);
      expect(isOffscreenBroadcastMessage({ type: 'INVALID_TYPE' })).toBe(false);
    });
  });
});
