import { OffscreenCommandMessage } from '../../shared/messages';
import { BrowserAdapter } from '../../shared/utils/browser';
import { LoggerLike } from '../tabManager';

interface OffscreenBridgeTabManager {
  getSnapshot: () => { tabs: any[]; currentIndex: number; settings: any };
  pause: () => void;
}

export interface OffscreenBridgeDeps {
  logger: LoggerLike;
  tabManager: OffscreenBridgeTabManager;
  sendMessage: (message: OffscreenCommandMessage) => Promise<unknown>;
}

export interface OffscreenBridge {
  setupOffscreenDocument: () => Promise<void>;
  ensureOffscreenDocument: () => Promise<boolean>;
  forwardToOffscreen: (action: 'start' | 'pause' | 'resume' | 'stop') => Promise<void>;
}

/**
 * Factory function that creates an OffscreenBridge.
 * Manages Offscreen Document lifecycle and TTS command forwarding
 * for Chrome Manifest V3.
 */
export function createOffscreenBridge(deps: OffscreenBridgeDeps): OffscreenBridge {
  const { logger, tabManager, sendMessage } = deps;

  async function setupOffscreenDocument(): Promise<void> {
    if (
      BrowserAdapter.getBrowserType() !== 'chrome' ||
      !BrowserAdapter.isFeatureSupported('offscreen')
    ) {
      logger.info('[OffscreenBridge] Offscreen API not available, skipping setup');
      return;
    }

    try {
      const hasOffscreen = await BrowserAdapter.hasOffscreenDocument();
      if (hasOffscreen) {
        logger.info('[OffscreenBridge] Offscreen document already exists');
        return;
      }

      await BrowserAdapter.createOffscreenDocument(
        'offscreen.html',
        ['AUDIO_PLAYBACK' as any],
        'Text-to-speech audio playback'
      );
      logger.info('[OffscreenBridge] Offscreen document created successfully');
    } catch (error) {
      logger.error('[OffscreenBridge] Failed to setup offscreen document', error);
      logger.warn('[OffscreenBridge] Continuing without offscreen document support');
    }
  }

  async function ensureOffscreenDocument(): Promise<boolean> {
    if (
      BrowserAdapter.getBrowserType() !== 'chrome' ||
      !BrowserAdapter.isFeatureSupported('offscreen')
    ) {
      return false;
    }

    try {
      const hasOffscreen = await BrowserAdapter.hasOffscreenDocument();
      if (hasOffscreen) {
        return true;
      }

      logger.warn('[OffscreenBridge] Offscreen document missing, recreating...');
      await BrowserAdapter.createOffscreenDocument(
        'offscreen.html',
        ['AUDIO_PLAYBACK' as any],
        'Text-to-speech audio playback'
      );
      logger.info('[OffscreenBridge] Offscreen document recreated successfully');
      return true;
    } catch (error) {
      logger.error('[OffscreenBridge] Failed to ensure offscreen document', error);
      return false;
    }
  }

  async function forwardToOffscreen(
    action: 'start' | 'pause' | 'resume' | 'stop'
  ): Promise<void> {
    const hasOffscreen = await ensureOffscreenDocument();
    if (!hasOffscreen) {
      logger.error(
        `[OffscreenBridge] Cannot forward ${action}: offscreen document unavailable`
      );
      if (action === 'start' || action === 'resume') {
        tabManager.pause();
      }
      throw new Error('Offscreen document unavailable');
    }

    let message: OffscreenCommandMessage;

    switch (action) {
      case 'start': {
        const snapshot = tabManager.getSnapshot();
        const currentTab = snapshot.tabs[snapshot.currentIndex];
        if (!currentTab) {
          throw new Error('No tab available to start playback');
        }
        message = {
          type: 'OFFSCREEN_TTS_START',
          payload: {
            tab: currentTab as any,
            settings: snapshot.settings,
          },
        };
        break;
      }
      case 'pause':
        message = { type: 'OFFSCREEN_TTS_PAUSE' };
        break;
      case 'resume':
        message = { type: 'OFFSCREEN_TTS_RESUME' };
        break;
      case 'stop':
        message = { type: 'OFFSCREEN_TTS_STOP' };
        break;
      default:
        throw new Error(`Unsupported offscreen action: ${action}`);
    }

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await sendMessage(message);
        logger.info(
          `[OffscreenBridge] Forwarded ${action} command to offscreen (attempt ${attempt})`
        );
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(
          `[OffscreenBridge] Failed to forward ${action} (attempt ${attempt}/2)`,
          error
        );

        if (attempt < 2) {
          logger.warn('[OffscreenBridge] Attempting to recreate offscreen document...');
          const recreated = await ensureOffscreenDocument();
          if (!recreated) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }

    logger.error(
      `[OffscreenBridge] Failed to forward ${action} after 2 attempts`,
      lastError
    );
    if (action === 'start' || action === 'resume') {
      tabManager.pause();
    }
    throw lastError || new Error(`Failed to forward ${action} to offscreen`);
  }

  return { setupOffscreenDocument, ensureOffscreenDocument, forwardToOffscreen };
}
