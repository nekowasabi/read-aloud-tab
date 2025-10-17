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

/**
 * Performance metrics for keep-alive monitoring
 */
interface KeepAliveMetrics {
  totalHeartbeatsSent: number;
  failedHeartbeats: number;
  reconnectionAttempts: number;
  lastHeartbeatGap: number;
  connectionStartedAt: number;
  totalDisconnects: number;
}

/**
 * Configuration for heartbeat interval
 */
interface KeepAliveConfig {
  heartbeatIntervalMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  adaptiveInterval: boolean;
}

class OffscreenTTSController {
  private ttsEngine: TTSEngine;
  private currentTab: TabInfo | null = null;
  private currentSettings: TTSSettings | null = null;
  private logger = console;

  // Keep-alive port connection to Service Worker
  private keepAlivePort: chrome.runtime.Port | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private heartbeatIntervalMs = 20000; // 20 seconds (configurable)

  // Performance metrics
  private metrics: KeepAliveMetrics = {
    totalHeartbeatsSent: 0,
    failedHeartbeats: 0,
    reconnectionAttempts: 0,
    lastHeartbeatGap: 0,
    connectionStartedAt: 0,
    totalDisconnects: 0,
  };

  // Configuration
  private config: KeepAliveConfig = {
    heartbeatIntervalMs: 20000,
    minIntervalMs: 15000,
    maxIntervalMs: 25000,
    adaptiveInterval: false, // Disabled by default for stability
  };

  private lastHeartbeatAt: number | null = null;

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

    // Setup keep-alive port connection to Service Worker
    this.setupKeepAlivePort();

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

  /**
   * Setup keep-alive port connection to Service Worker
   * This port connection keeps the Service Worker alive in Chrome Manifest V3
   */
  private setupKeepAlivePort(): void {
    try {
      this.keepAlivePort = chrome.runtime.connect({ name: 'offscreen-keepalive' });
      this.reconnectAttempts = 0;

      // Track connection start time
      this.metrics.connectionStartedAt = Date.now();

      this.keepAlivePort.onDisconnect.addListener(() => {
        this.handlePortDisconnect();
      });

      this.startHeartbeat();
      this.logger.info('[OffscreenTTS] Keep-alive port connected');
    } catch (error) {
      this.logger.error('[OffscreenTTS] Failed to setup keep-alive port', error);
      this.reconnectWithBackoff();
    }
  }

  /**
   * Start heartbeat timer to send periodic messages
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.keepAlivePort) {
        try {
          this.keepAlivePort.postMessage({
            type: 'OFFSCREEN_HEARTBEAT',
            timestamp: Date.now(),
          });
          this.updateMetrics(true); // Track success
          this.logger.debug?.('[OffscreenTTS] Heartbeat sent');

          // Adaptive interval adjustment (if enabled)
          if (this.config.adaptiveInterval) {
            const optimalInterval = this.calculateOptimalInterval();
            if (optimalInterval !== this.heartbeatIntervalMs) {
              this.logger.info(
                `[OffscreenTTS] Adjusting heartbeat interval: ${this.heartbeatIntervalMs}ms -> ${optimalInterval}ms`
              );
              this.heartbeatIntervalMs = optimalInterval;
              this.stopHeartbeat();
              this.startHeartbeat();
            }
          }
        } catch (error) {
          this.updateMetrics(false); // Track failure
          this.logger.warn('[OffscreenTTS] Failed to send heartbeat', error);
          this.handlePortDisconnect();
        }
      }
    }, this.heartbeatIntervalMs);

    this.logger.info(`[OffscreenTTS] Heartbeat started (${this.heartbeatIntervalMs}ms interval)`);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.logger.debug?.('[OffscreenTTS] Heartbeat stopped');
    }
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(success: boolean): void {
    if (success) {
      this.metrics.totalHeartbeatsSent++;
      
      // Track heartbeat gap
      if (this.lastHeartbeatAt !== null) {
        this.metrics.lastHeartbeatGap = Date.now() - this.lastHeartbeatAt;
      }
      this.lastHeartbeatAt = Date.now();
    } else {
      this.metrics.failedHeartbeats++;
    }
  }

  /**
   * Calculate optimal heartbeat interval based on metrics
   */
  private calculateOptimalInterval(): number {
    if (!this.config.adaptiveInterval) {
      return this.config.heartbeatIntervalMs;
    }

    const successRate =
      this.metrics.totalHeartbeatsSent > 0
        ? (this.metrics.totalHeartbeatsSent - this.metrics.failedHeartbeats) /
          this.metrics.totalHeartbeatsSent
        : 1;

    let newInterval = this.heartbeatIntervalMs;

    // High success rate (>95%): can increase interval slightly
    if (successRate >= 0.95) {
      newInterval = Math.min(
        this.heartbeatIntervalMs + 2000,
        this.config.maxIntervalMs
      );
    }
    // Low success rate (<80%): decrease interval for reliability
    else if (successRate < 0.8) {
      newInterval = Math.max(
        this.heartbeatIntervalMs - 2000,
        this.config.minIntervalMs
      );
    }

    // If gap is dangerously close to 30s timeout, decrease interval
    if (this.metrics.lastHeartbeatGap > 28000) {
      newInterval = Math.max(newInterval - 3000, this.config.minIntervalMs);
    }

    return newInterval;
  }

  /**
   * Get current performance metrics (for debugging)
   */
  getMetrics(): KeepAliveMetrics {
    return { ...this.metrics };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<KeepAliveConfig>): void {
    this.config = { ...this.config, ...config };
    
    // If heartbeat interval changed, restart heartbeat
    if (config.heartbeatIntervalMs !== undefined) {
      this.heartbeatIntervalMs = config.heartbeatIntervalMs;
      if (this.heartbeatTimer) {
        this.stopHeartbeat();
        this.startHeartbeat();
      }
    }
  }

  /**
   * Handle port disconnection
   */
  private handlePortDisconnect(): void {
    this.logger.warn('[OffscreenTTS] Keep-alive port disconnected');
    this.stopHeartbeat();
    this.keepAlivePort = null;

    // Update disconnect metrics
    this.metrics.totalDisconnects++;

    // Attempt to reconnect
    this.reconnectWithBackoff();
  }

  /**
   * Reconnect with exponential backoff
   */
  private reconnectWithBackoff(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('[OffscreenTTS] Max reconnect attempts reached, giving up');
      return;
    }

    // Clear existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Update reconnection metrics
    this.metrics.reconnectionAttempts++;

    // Exponential backoff: 500ms, 1s, 2s, 4s, 5s (max)
    const delay = Math.min(500 * Math.pow(2, this.reconnectAttempts), 5000);
    this.reconnectAttempts++;

    this.logger.info(`[OffscreenTTS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.setupKeepAlivePort();
    }, delay);
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.keepAlivePort) {
      try {
        this.keepAlivePort.disconnect();
      } catch (error) {
        this.logger.warn('[OffscreenTTS] Error disconnecting port during cleanup', error);
      }
      this.keepAlivePort = null;
    }

    this.logger.debug?.('[OffscreenTTS] Cleanup completed');
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
