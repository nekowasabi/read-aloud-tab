/**
 * offscreenBridge.ts
 * Extracted from service.ts (Process 50)
 *
 * Encapsulates all communication with the Chrome Offscreen Document API.
 * Provides setup, ensure, and sendCommand operations.
 */
import { BrowserAdapter } from '../shared/utils/browser';
import { OffscreenCommandMessage } from '../shared/messages';
import { TabInfo } from '../shared/types';
import { LoggerLike } from './tabManager';

export interface OffscreenBridgeRuntime {
  sendMessage: (message: OffscreenCommandMessage) => Promise<unknown> | void;
}

export interface OffscreenBridgeDeps {
  runtime: OffscreenBridgeRuntime;
  logger: LoggerLike;
}

export type OffscreenAction = 'start' | 'pause' | 'resume' | 'stop';

export interface StartPayload {
  tab: TabInfo;
  settings: unknown;
}

/**
 * OffscreenBridge manages the Chrome Offscreen Document lifecycle and
 * forwards TTS commands to it.
 */
export class OffscreenBridge {
  private readonly runtime: OffscreenBridgeRuntime;
  private readonly logger: LoggerLike;

  constructor(deps: OffscreenBridgeDeps) {
    this.runtime = deps.runtime;
    this.logger = deps.logger;
  }

  /**
   * Returns true if the current browser supports offscreen documents.
   */
  isAvailable(): boolean {
    return (
      BrowserAdapter.getBrowserType() === 'chrome' &&
      BrowserAdapter.isFeatureSupported('offscreen')
    );
  }

  /**
   * Initial setup: creates the offscreen document if it does not exist.
   * Does not throw on failure so initialization can continue.
   */
  async setup(): Promise<void> {
    if (!this.isAvailable()) {
      this.logger.info('[OffscreenBridge] Offscreen API not available, skipping setup');
      return;
    }

    try {
      const hasOffscreen = await BrowserAdapter.hasOffscreenDocument();
      if (hasOffscreen) {
        this.logger.info('[OffscreenBridge] Offscreen document already exists');
        return;
      }

      await BrowserAdapter.createOffscreenDocument(
        'offscreen.html',
        ['AUDIO_PLAYBACK' as any],
        'Text-to-speech audio playback',
      );
      this.logger.info('[OffscreenBridge] Offscreen document created successfully');
    } catch (error) {
      this.logger.error('[OffscreenBridge] Failed to setup offscreen document', error);
      this.logger.warn('[OffscreenBridge] Continuing without offscreen document support');
    }
  }

  /**
   * Ensures the offscreen document exists, recreating it if necessary.
   * Critical after Service Worker restarts.
   * @returns true if the document is available, false otherwise
   */
  async ensure(): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const hasOffscreen = await BrowserAdapter.hasOffscreenDocument();
      if (hasOffscreen) {
        return true;
      }

      this.logger.warn('[OffscreenBridge] Offscreen document missing, recreating...');
      await BrowserAdapter.createOffscreenDocument(
        'offscreen.html',
        ['AUDIO_PLAYBACK' as any],
        'Text-to-speech audio playback',
      );
      this.logger.info('[OffscreenBridge] Offscreen document recreated successfully');
      return true;
    } catch (error) {
      this.logger.error('[OffscreenBridge] Failed to ensure offscreen document', error);
      return false;
    }
  }

  /**
   * Sends a TTS command to the offscreen document.
   * Ensures the document exists before sending, and retries once on failure.
   */
  async sendCommand(action: OffscreenAction, payload?: StartPayload): Promise<void> {
    const hasOffscreen = await this.ensure();
    if (!hasOffscreen) {
      this.logger.error(`[OffscreenBridge] Cannot forward ${action}: offscreen document unavailable`);
      throw new Error('Offscreen document unavailable');
    }

    const message = this.buildMessage(action, payload);

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = this.runtime.sendMessage(message);
        if (result instanceof Promise) {
          await result;
        }
        this.logger.info(`[OffscreenBridge] Forwarded ${action} command to offscreen (attempt ${attempt})`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`[OffscreenBridge] Failed to forward ${action} (attempt ${attempt}/2)`, error);

        if (attempt < 2) {
          this.logger.warn('[OffscreenBridge] Attempting to recreate offscreen document...');
          const recreated = await this.ensure();
          if (!recreated) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }

    this.logger.error(`[OffscreenBridge] Failed to forward ${action} after 2 attempts`, lastError);
    throw lastError || new Error(`Failed to forward ${action} to offscreen`);
  }

  private buildMessage(action: OffscreenAction, payload?: StartPayload): OffscreenCommandMessage {
    switch (action) {
      case 'start': {
        if (!payload) {
          throw new Error('start command requires payload');
        }
        return {
          type: 'OFFSCREEN_TTS_START',
          payload: {
            tab: payload.tab as any,
            settings: payload.settings as any,
          },
        };
      }
      case 'pause':
        return { type: 'OFFSCREEN_TTS_PAUSE' };
      case 'resume':
        return { type: 'OFFSCREEN_TTS_RESUME' };
      case 'stop':
        return { type: 'OFFSCREEN_TTS_STOP' };
      default:
        throw new Error(`Unsupported offscreen action: ${action}`);
    }
  }
}
