import { TabInfo, TTSSettings } from '../shared/types';
import { PlaybackController, PlaybackHooks, LoggerLike } from './tabManager';

interface TTSEngineOptions {
  speech?: SpeechSynthesis;
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
  logger?: LoggerLike;
  defaultLang?: string;
}

export class TTSEngine implements PlaybackController {
  private utterance: SpeechSynthesisUtterance | null = null;
  private isPaused = false;
  private currentText = '';
  private currentPosition = 0;
  private totalLength = 0;

  // Firefox pause/resume support
  private pausedPosition: number = 0;
  private originalText: string = '';
  private currentSettings: TTSSettings | null = null;
  private currentHooks: PlaybackHooks | null = null;
  private isResuming: boolean = false;

  private readonly speech: SpeechSynthesis;
  private readonly createUtteranceFn: (text: string) => SpeechSynthesisUtterance;
  private readonly logger: LoggerLike;
  private readonly defaultLang: string;

  constructor(options: TTSEngineOptions = {}) {
    this.speech = options.speech || (globalThis.speechSynthesis as SpeechSynthesis);
    this.createUtteranceFn = options.createUtterance || ((text: string) => new SpeechSynthesisUtterance(text));
    this.logger = options.logger || console;
    this.defaultLang = options.defaultLang || 'ja-JP';

    if (!this.speech) {
      throw new Error('Web Speech API is not supported in this environment');
    }
  }

  async start(tab: TabInfo, settings: TTSSettings, hooks: PlaybackHooks): Promise<void> {
    if (!tab.content || tab.content.trim().length === 0) {
      throw new Error('No readable content available for the selected tab');
    }

    this.stop();

    // Store for Firefox pause/resume support
    this.originalText = tab.content;
    this.currentSettings = settings;
    this.currentHooks = hooks;
    this.pausedPosition = 0;

    this.currentText = tab.content;
    this.totalLength = tab.content.length;
    this.currentPosition = 0;
    this.isPaused = false;

    const utterance = this.createUtteranceFn(tab.content);
    utterance.text = tab.content;
    this.utterance = utterance;

    this.applySettings(utterance, settings);
    await this.applyVoice(utterance, settings.voice);
    this.bindUtteranceEvents(utterance, hooks);

    this.speech.speak(utterance);
  }

  pause(): void {
    if (!this.speech || !this.speech.speaking || this.isPaused) {
      return;
    }

    // Save current position for Firefox compatibility
    // Firefox doesn't support pause() properly, so we use cancel() + position tracking
    this.pausedPosition = this.currentPosition;

    try {
      // IMPORTANT: Set isPaused BEFORE calling cancel()
      // Firefox fires utterance.onend when cancel() is called, and we need
      // to prevent that onend handler from calling hooks.onEnd()
      this.isPaused = true;

      // Use cancel() instead of pause() for Firefox compatibility
      this.speech.cancel();
    } catch (error) {
      this.logger.warn('[TTSEngine] pause failed during cancel()', error);
      this.isPaused = false; // Reset on error
    }
  }

  resume(): void {
    if (!this.speech) {
      this.logger.warn('TTSEngine: resume called but speech is not available');
      return;
    }

    if (!this.isPaused || !this.currentHooks || !this.currentSettings) {
      this.logger.warn('TTSEngine: resume called but not paused or missing context', {
        isPaused: this.isPaused,
        hasHooks: !!this.currentHooks,
        hasSettings: !!this.currentSettings,
      });
      return;
    }

    // Get remaining text from paused position
    const remainingText = this.originalText.substring(this.pausedPosition);

    if (!remainingText || remainingText.length === 0) {
      this.logger.warn('TTSEngine: no remaining text to resume');
      return;
    }

    // Use async IIFE to handle voice application
    (async () => {
      try {
        // Set resuming flag to prevent onstart from resetting isPaused
        this.isResuming = true;

        // Create new utterance for remaining text
        const utterance = this.createUtteranceFn(remainingText);
        utterance.text = remainingText;
        this.utterance = utterance;

        // Apply settings
        this.applySettings(utterance, this.currentSettings!);
        await this.applyVoice(utterance, this.currentSettings!.voice);

        // Bind events with offset for correct position tracking
        this.bindUtteranceEventsWithOffset(utterance, this.currentHooks!, this.pausedPosition);

        this.isPaused = false;
        this.speech.speak(utterance);
      } catch (error) {
        this.logger.warn('TTSEngine: resume failed', error);
        this.isResuming = false;
      }
    })();
  }

  stop(): void {
    if (this.speech && (this.speech.speaking || this.speech.pending)) {
      try {
        this.speech.cancel();
      } catch (error) {
        this.logger.warn('TTSEngine: cancel failed', error);
      }
    }
    this.cleanup();
  }

  getDebugInfo(): object {
    return {
      isSupported: Boolean(this.speech),
      isSpeaking: this.speech?.speaking ?? false,
      isPending: this.speech?.pending ?? false,
      isPaused: this.isPaused,
      currentPosition: this.currentPosition,
      totalLength: this.totalLength,
      progress: this.calculateProgress(),
    };
  }

  private applySettings(utterance: SpeechSynthesisUtterance, settings: TTSSettings): void {
    utterance.rate = Math.max(0.1, Math.min(10, settings.rate));
    utterance.pitch = Math.max(0, Math.min(2, settings.pitch));
    utterance.volume = Math.max(0, Math.min(1, settings.volume));
    utterance.lang = this.defaultLang;
  }

  private async applyVoice(utterance: SpeechSynthesisUtterance, voiceName: string | null | undefined): Promise<void> {
    if (!voiceName) {
      return;
    }

    try {
      const voices = await this.getVoices();
      const selectedVoice = voices.find((voice) => voice.name === voiceName);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      } else {
        this.logger.warn(`TTSEngine: voice "${voiceName}" not found. Using default voice.`);
      }
    } catch (error) {
      this.logger.warn('TTSEngine: failed to fetch voices', error);
    }
  }

  private bindUtteranceEvents(utterance: SpeechSynthesisUtterance, hooks: PlaybackHooks): void {
    this.bindUtteranceEventsWithOffset(utterance, hooks, 0);
  }

  private bindUtteranceEventsWithOffset(
    utterance: SpeechSynthesisUtterance,
    hooks: PlaybackHooks,
    offset: number,
  ): void {
    utterance.onstart = () => {
      // Only reset isPaused if not resuming (to prevent state reset on resume)
      if (!this.isResuming) {
        this.isPaused = false;
      } else {
        // Clear resuming flag after onstart fires
        this.isResuming = false;
      }
    };

    utterance.onend = () => {
      // Don't call hooks.onEnd() if we're paused (Firefox fires onend when cancel() is called)
      if (!this.isPaused) {
        this.cleanup();
        hooks.onEnd();
      }
    };

    utterance.onerror = (event: any) => {
      const error = new Error(
        typeof event?.error === 'string' ? `Speech synthesis error: ${event.error}` : 'Unknown speech synthesis error',
      );
      try {
        this.speech.cancel();
      } catch (cancelError) {
        this.logger.warn('TTSEngine: cancel after error failed', cancelError);
      }
      this.cleanup();
      hooks.onError(error);
    };

    utterance.onpause = () => {
      this.isPaused = true;
    };

    utterance.onresume = () => {
      this.isPaused = false;
    };

    utterance.onboundary = (event: any) => {
      if (typeof event?.charIndex === 'number') {
        // Add offset for position tracking when resuming
        this.currentPosition = offset + event.charIndex;
        this.emitProgress(hooks);
      }
    };
  }

  private emitProgress(hooks: PlaybackHooks): void {
    if (typeof hooks.onProgress !== 'function') {
      return;
    }
    hooks.onProgress(this.calculateProgress());
  }

  private calculateProgress(): number {
    if (this.totalLength === 0) {
      return 0;
    }
    const ratio = this.currentPosition / this.totalLength;
    return Math.max(0, Math.min(100, ratio * 100));
  }

  private cleanup(): void {
    this.utterance = null;
    this.isPaused = false;
    this.currentText = '';
    this.currentPosition = 0;
    this.totalLength = 0;
    this.isResuming = false;
  }

  private async getVoices(): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
      const existing = this.speech.getVoices();
      if (existing.length > 0) {
        resolve(existing);
        return;
      }

      const listener = () => {
        this.speech.removeEventListener?.('voiceschanged', listener as any);
        resolve(this.speech.getVoices());
      };

      this.speech.addEventListener?.('voiceschanged', listener as any);

      setTimeout(() => {
        this.speech.removeEventListener?.('voiceschanged', listener as any);
        resolve(this.speech.getVoices());
      }, 3000);
    });
  }
}
