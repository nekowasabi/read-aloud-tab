import { TTSSettings, TTSState, ExtensionError } from '../shared/types';

export class TTSEngine {
  private utterance: SpeechSynthesisUtterance | null = null;
  private isPaused: boolean = false;
  private currentText: string = '';
  private currentPosition: number = 0;
  private totalLength: number = 0;

  constructor(private onStateChange: (state: TTSState) => void) {
    this.bindEvents();
  }

  private bindEvents(): void {
    // SpeechSynthesis のグローバルイベントをリッスン
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.addEventListener('voiceschanged', () => {
        console.log('Voices updated:', speechSynthesis.getVoices().length);
      });
    }
  }

  async speak(text: string, settings: TTSSettings): Promise<void> {
    try {
      // 既存の読み上げを停止
      this.stop();

      // Web Speech API の利用可能性をチェック
      if (!this.isWebSpeechSupported()) {
        throw new Error('Web Speech API is not supported in this browser');
      }

      this.currentText = text;
      this.totalLength = text.length;
      this.currentPosition = 0;

      this.utterance = new SpeechSynthesisUtterance(text);

      // 設定を適用
      this.applySettings(this.utterance, settings);

      // 音声を設定
      await this.setVoice(this.utterance, settings.voice);

      // イベントリスナーを設定
      this.setupUtteranceEvents();

      // 読み上げ開始
      speechSynthesis.speak(this.utterance);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown TTS error';
      console.error('TTS Error:', error);
      this.notifyError(errorMessage);
      throw error;
    }
  }

  private applySettings(utterance: SpeechSynthesisUtterance, settings: TTSSettings): void {
    utterance.rate = Math.max(0.1, Math.min(10, settings.rate));
    utterance.pitch = Math.max(0, Math.min(2, settings.pitch));
    utterance.volume = Math.max(0, Math.min(1, settings.volume));
    utterance.lang = 'ja-JP'; // デフォルトは日本語
  }

  private async setVoice(utterance: SpeechSynthesisUtterance, voiceName: string): Promise<void> {
    if (!voiceName) return;

    const voices = await this.getVoices();
    const selectedVoice = voices.find(v => v.name === voiceName);

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    } else {
      console.warn(`Voice "${voiceName}" not found. Using default voice.`);
    }
  }

  private setupUtteranceEvents(): void {
    if (!this.utterance) return;

    this.utterance.onstart = () => {
      console.log('TTS: Speech started');
      this.onStateChange({
        isReading: true,
        isPaused: false,
        currentTabId: null,
        progress: 0,
      });
    };

    this.utterance.onend = () => {
      console.log('TTS: Speech ended');
      this.onStateChange({
        isReading: false,
        isPaused: false,
        currentTabId: null,
        progress: 100,
      });
      this.cleanup();
    };

    this.utterance.onerror = (event) => {
      console.error('TTS: Speech error:', event.error);
      this.notifyError(`Speech synthesis error: ${event.error}`);
      this.cleanup();
    };

    this.utterance.onpause = () => {
      console.log('TTS: Speech paused');
      this.isPaused = true;
      this.onStateChange({
        isReading: true,
        isPaused: true,
        currentTabId: null,
        progress: this.calculateProgress(),
      });
    };

    this.utterance.onresume = () => {
      console.log('TTS: Speech resumed');
      this.isPaused = false;
      this.onStateChange({
        isReading: true,
        isPaused: false,
        currentTabId: null,
        progress: this.calculateProgress(),
      });
    };

    this.utterance.onboundary = (event) => {
      if (event.name === 'word' || event.name === 'sentence') {
        this.currentPosition = event.charIndex;
        const progress = this.calculateProgress();

        this.onStateChange({
          isReading: true,
          isPaused: this.isPaused,
          currentTabId: null,
          progress: progress,
        });
      }
    };
  }

  private calculateProgress(): number {
    if (this.totalLength === 0) return 0;
    return Math.min(100, (this.currentPosition / this.totalLength) * 100);
  }

  pause(): void {
    if (speechSynthesis.speaking && !this.isPaused) {
      speechSynthesis.pause();
      // pause イベントで状態は更新される
    }
  }

  resume(): void {
    if (this.isPaused) {
      speechSynthesis.resume();
      // resume イベントで状態は更新される
    }
  }

  stop(): void {
    if (speechSynthesis.speaking || speechSynthesis.pending) {
      speechSynthesis.cancel();
    }
    this.cleanup();
  }

  private cleanup(): void {
    this.utterance = null;
    this.isPaused = false;
    this.currentText = '';
    this.currentPosition = 0;
    this.totalLength = 0;
  }

  async getVoices(): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
      const voices = speechSynthesis.getVoices();
      if (voices.length > 0) {
        resolve(voices);
      } else {
        const listener = () => {
          speechSynthesis.removeEventListener('voiceschanged', listener);
          resolve(speechSynthesis.getVoices());
        };
        speechSynthesis.addEventListener('voiceschanged', listener);

        // 最大3秒で諦める
        setTimeout(() => {
          speechSynthesis.removeEventListener('voiceschanged', listener);
          resolve(speechSynthesis.getVoices());
        }, 3000);
      }
    });
  }

  async getJapaneseVoices(): Promise<SpeechSynthesisVoice[]> {
    const allVoices = await this.getVoices();
    return allVoices.filter(voice =>
      voice.lang.startsWith('ja') ||
      voice.lang.includes('JP') ||
      voice.name.includes('Japanese')
    );
  }

  getCurrentState(): TTSState {
    return {
      isReading: speechSynthesis.speaking,
      isPaused: this.isPaused,
      currentTabId: null,
      progress: this.calculateProgress(),
    };
  }

  private isWebSpeechSupported(): boolean {
    return typeof speechSynthesis !== 'undefined' &&
           typeof SpeechSynthesisUtterance !== 'undefined';
  }

  private notifyError(message: string): void {
    this.onStateChange({
      isReading: false,
      isPaused: false,
      currentTabId: null,
      progress: 0,
    });
  }

  // 読み上げ速度の動的変更
  changeRate(newRate: number): void {
    if (this.utterance && speechSynthesis.speaking) {
      // 現在の読み上げを一時停止
      const wasPlaying = !this.isPaused;
      this.pause();

      // 新しい設定で再開 (実装は複雑になるため、現在は停止して再開始を推奨)
      console.log('Rate change requires restart. Current rate:', newRate);
    }
  }

  // デバッグ情報を取得
  getDebugInfo(): object {
    return {
      isSupported: this.isWebSpeechSupported(),
      isSpeaking: speechSynthesis.speaking,
      isPending: speechSynthesis.pending,
      isPaused: this.isPaused,
      currentPosition: this.currentPosition,
      totalLength: this.totalLength,
      progress: this.calculateProgress(),
      availableVoices: speechSynthesis.getVoices().length,
    };
  }
}