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
    if (this.speech.speaking && !this.isPaused) {
      this.speech.pause();
      this.isPaused = true;
    }
  }

  resume(): void {
    if (this.isPaused) {
      this.speech.resume();
      this.isPaused = false;
    }
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
    utterance.onstart = () => {
      this.isPaused = false;
    };

    utterance.onend = () => {
      this.cleanup();
      hooks.onEnd();
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
        this.currentPosition = event.charIndex;
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
