/**
 * Offscreen Document Script for Chrome Manifest V3
 *
 * This script runs in an Offscreen Document context, which provides
 * access to Web Speech API even when the Service Worker is inactive.
 * It receives commands from the Service Worker and controls TTS playback.
 */

import { TTSEngine } from '../ttsEngine';
import { TabInfo, TTSSettings } from '../../shared/types';
import {
  OffscreenCommandMessage,
  OffscreenBroadcastMessage,
  isOffscreenCommandMessage,
} from '../../shared/messages';

class OffscreenTTSController {
  private ttsEngine: TTSEngine;
  private currentTab: TabInfo | null = null;
  private currentSettings: TTSSettings | null = null;
  private logger = console;

  constructor() {
    this.ttsEngine = new TTSEngine({
      logger: this.logger,
    });
  }

  initialize(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message)
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
          this.logger.error('[OffscreenTTS] Message handling error', error);
          this.broadcastError('MESSAGE_HANDLING_ERROR', error.message, error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep channel open for async response
    });

    this.logger.info('[OffscreenTTS] Initialized');
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isOffscreenCommandMessage(message)) {
      this.logger.warn('[OffscreenTTS] Invalid message format', message);
      return;
    }

    switch (message.type) {
      case 'OFFSCREEN_TTS_START':
        await this.handleStart(message.payload.tab, message.payload.settings);
        break;
      case 'OFFSCREEN_TTS_PAUSE':
        await this.handlePause();
        break;
      case 'OFFSCREEN_TTS_RESUME':
        await this.handleResume();
        break;
      case 'OFFSCREEN_TTS_STOP':
        await this.handleStop();
        break;
      case 'OFFSCREEN_TTS_UPDATE_SETTINGS':
        await this.handleUpdateSettings(message.payload.settings);
        break;
      default:
        this.logger.warn('[OffscreenTTS] Unknown command type', message);
    }
  }

  private async handleStart(tab: TabInfo, settings: TTSSettings): Promise<void> {
    this.logger.info('[OffscreenTTS] Starting TTS', { tabId: tab.tabId, title: tab.title });

    this.currentTab = tab;
    this.currentSettings = settings;

    try {
      await this.ttsEngine.start(tab, settings, {
        onEnd: () => {
          this.broadcastEnd();
          this.broadcastStatus('idle');
        },
        onError: (error) => {
          this.broadcastError('TTS_PLAYBACK_ERROR', error.message, error);
        },
        onProgress: (progress) => {
          this.broadcastProgress(progress);
        },
      });

      // Broadcast speaking status after successful start
      this.broadcastStatus('speaking');
    } catch (error: any) {
      this.logger.error('[OffscreenTTS] Failed to start TTS', error);
      this.broadcastError('TTS_START_ERROR', error.message, error);
      throw error;
    }
  }

  private async handlePause(): Promise<void> {
    this.logger.info('[OffscreenTTS] Pausing TTS');

    try {
      this.ttsEngine.pause();
      this.broadcastStatus('paused');
    } catch (error: any) {
      this.logger.error('[OffscreenTTS] Failed to pause TTS', error);
      this.broadcastError('TTS_PAUSE_ERROR', error.message, error);
      throw error;
    }
  }

  private async handleResume(): Promise<void> {
    this.logger.info('[OffscreenTTS] Resuming TTS');

    try {
      this.ttsEngine.resume();
      this.broadcastStatus('speaking');
    } catch (error: any) {
      this.logger.error('[OffscreenTTS] Failed to resume TTS', error);
      this.broadcastError('TTS_RESUME_ERROR', error.message, error);
      throw error;
    }
  }

  private async handleStop(): Promise<void> {
    this.logger.info('[OffscreenTTS] Stopping TTS');

    try {
      this.ttsEngine.stop();
      this.currentTab = null;
      this.currentSettings = null;
      this.broadcastStatus('idle');
    } catch (error: any) {
      this.logger.error('[OffscreenTTS] Failed to stop TTS', error);
      this.broadcastError('TTS_STOP_ERROR', error.message, error);
      throw error;
    }
  }

  private async handleUpdateSettings(settings: TTSSettings): Promise<void> {
    this.logger.info('[OffscreenTTS] Updating settings', settings);

    try {
      this.currentSettings = settings;
      this.ttsEngine.updateSettings(settings);
    } catch (error: any) {
      this.logger.error('[OffscreenTTS] Failed to update settings', error);
      this.broadcastError('TTS_SETTINGS_ERROR', error.message, error);
      throw error;
    }
  }

  private broadcastStatus(status: 'idle' | 'speaking' | 'paused'): void {
    const message: OffscreenBroadcastMessage = {
      type: 'OFFSCREEN_TTS_STATUS',
      payload: { status },
    };
    this.sendToServiceWorker(message);
  }

  private broadcastProgress(progress: number): void {
    const message: OffscreenBroadcastMessage = {
      type: 'OFFSCREEN_TTS_PROGRESS',
      payload: {
        progress,
        timestamp: Date.now(),
      },
    };
    this.sendToServiceWorker(message);
  }

  private broadcastEnd(): void {
    const message: OffscreenBroadcastMessage = {
      type: 'OFFSCREEN_TTS_END',
    };
    this.sendToServiceWorker(message);
  }

  private broadcastError(code: string, errorMessage: string, detail?: unknown): void {
    const message: OffscreenBroadcastMessage = {
      type: 'OFFSCREEN_TTS_ERROR',
      payload: {
        code,
        message: errorMessage,
        detail,
      },
    };
    this.sendToServiceWorker(message);
  }

  private sendToServiceWorker(message: OffscreenBroadcastMessage): void {
    chrome.runtime.sendMessage(message).catch((error) => {
      this.logger.warn('[OffscreenTTS] Failed to send message to service worker', error);
    });
  }
}

// Export for testing
export function initializeOffscreenDocument(): OffscreenTTSController {
  const controller = new OffscreenTTSController();
  controller.initialize();
  return controller;
}

// Auto-initialize when loaded in browser (not in test environment)
if (typeof window !== 'undefined' && !('jest' in (globalThis as any))) {
  initializeOffscreenDocument();
}
