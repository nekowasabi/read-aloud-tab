import { TabInfo, TTSSettings } from "../shared/types";
import { LoggerLike, PlaybackController, PlaybackHooks } from "./tabManager";
import { chunkText, TextChunk, ChunkConfig } from "../shared/utils/textChunker";
import { Subject, Subscription, of, EMPTY } from 'rxjs';
import { tap, filter, switchMap, catchError } from 'rxjs/operators';

interface TTSEngineOptions {
  speech?: SpeechSynthesis;
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
  logger?: LoggerLike;
  defaultLang?: string;
}

export class TTSEngine implements PlaybackController {
  private utterance: SpeechSynthesisUtterance | null = null;
  private isPaused = false;
  private currentText = "";
  private currentPosition = 0;
  private totalLength = 0;

  // Firefox pause/resume support
  private pausedPosition: number = 0;
  private originalText: string = "";
  private currentSettings: TTSSettings | null = null;
  private currentHooks: PlaybackHooks | null = null;
  private isResuming: boolean = false;

  // Chunking support for long text (Web Speech API limitations)
  private chunks: TextChunk[] = [];
  private currentChunkIndex: number = 0;
  private chunkRetryCount: number = 0;
  private readonly maxChunkRetries: number = 2;

  // Observable-based chunk transition (process1-7)
  private chunkTransition$ = new Subject<'next' | 'complete'>();
  private subscription: Subscription | null = null;

  // Performance measurement (process7)
  private lastChunkEndTime: number = 0;

  private readonly speech: SpeechSynthesis;
  private readonly createUtteranceFn: (
    text: string,
  ) => SpeechSynthesisUtterance;
  private readonly logger: LoggerLike;
  private readonly defaultLang: string;

  constructor(options: TTSEngineOptions = {}) {
    this.speech = options.speech ||
      (globalThis.speechSynthesis as SpeechSynthesis);
    this.createUtteranceFn = options.createUtterance ||
      ((text: string) => new SpeechSynthesisUtterance(text));
    this.logger = options.logger || console;
    this.defaultLang = options.defaultLang || "ja-JP";

    if (!this.speech) {
      throw new Error("Web Speech API is not supported in this environment");
    }
  }

  async start(
    tab: TabInfo,
    settings: TTSSettings,
    hooks: PlaybackHooks,
  ): Promise<void> {
    // AI処理済みコンテンツがあればそれを優先、なければ元のコンテンツを使用
    const textToSpeak = tab.processedContent || tab.content;

    if (!textToSpeak || textToSpeak.trim().length === 0) {
      throw new Error("No readable content available for the selected tab");
    }

    // Debug logging: content lengths
    this.logger.info("[TTSEngine] Content analysis", {
      hasProcessedContent: !!tab.processedContent,
      processedContentLength: tab.processedContent?.length || 0,
      originalContentLength: tab.content?.length || 0,
      selectedLength: textToSpeak.length,
      textPreview: textToSpeak.substring(0, 50) + "...",
      textSuffix: "..." + textToSpeak.substring(textToSpeak.length - 50),
    });

    this.stop();

    // Store for pause/resume support
    this.originalText = textToSpeak;
    this.currentSettings = settings;
    this.currentHooks = hooks;
    this.pausedPosition = 0;
    this.totalLength = textToSpeak.length;
    this.currentPosition = 0;
    this.isPaused = false;

    // Split text into chunks to avoid Web Speech API limitations
    // Web Speech API has a ~15 second timeout
    // Japanese reading speed: ~5 chars/second at rate 1.0
    // Dynamic chunk size based on rate to stay within safe timeout window
    const safeReadingTime = 12; // Safe margin (seconds) before 15s timeout
    const charsPerSecond = 5; // Base reading speed at rate 1.0
    const maxChunkSize = Math.floor(safeReadingTime * charsPerSecond * settings.rate);
    // Examples:
    // rate 1.0 → 60 chars (12s reading time)
    // rate 1.5 → 90 chars (12s reading time)
    // rate 2.0 → 120 chars (12s reading time)

    const chunkConfig: ChunkConfig = {
      maxChunkSize: Math.max(40, maxChunkSize),  // Minimum 40 chars even at low rates
      minChunkSize: 20,  // Avoid too small fragments
    };

    const chunkResult = chunkText(textToSpeak, chunkConfig);
    this.chunks = chunkResult.chunks;
    this.currentChunkIndex = 0;
    this.chunkRetryCount = 0;

    this.logger.info(
      `[TTSEngine] Starting TTS with ${chunkResult.totalChunks} chunks`,
      {
        originalLength: chunkResult.originalLength,
        chunks: chunkResult.totalChunks,
        totalLength: this.totalLength,
      },
    );

    // Debug logging: chunk details
    this.chunks.forEach((chunk, index) => {
      this.logger.info(`[TTSEngine] Chunk ${index}`, {
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        length: chunk.text.length,
        textPreview: chunk.text.substring(0, 30) + "...",
      });
    });

    // Setup Observable pipeline for chunk transitions (process3)
    this.setupChunkTransitionPipeline(hooks);

    // Start playing first chunk
    await this.playChunkAt(0);
  }

  /**
   * Setup Observable pipeline for gapless chunk transitions
   *
   * Read-aloud pattern implementation:
   * - Minimal onend handler (just emits to Subject)
   * - Observable chain handles heavy operations
   * - switchMap prevents race conditions between chunks
   */
  private setupChunkTransitionPipeline(hooks: PlaybackHooks): void {
    this.subscription = this.chunkTransition$.pipe(
      tap((event) => {
        if (event === 'next') {
          this.currentChunkIndex++;
          this.logger.info(`[TTSEngine] Transitioning to chunk ${this.currentChunkIndex + 1}/${this.chunks.length}`);
        } else if (event === 'complete') {
          this.logger.info('[TTSEngine] All chunks completed');
          this.cleanup();
          hooks.onEnd();
        }
      }),
      filter((event) => event === 'next'),
      filter(() => this.currentChunkIndex < this.chunks.length),
      switchMap(async () => {
        const chunk = this.chunks[this.currentChunkIndex];
        const utterance = this.createUtteranceFn(chunk.text);
        utterance.text = chunk.text;

        // Apply settings and voice
        this.applySettings(utterance, this.currentSettings!);
        await this.applyVoice(utterance, this.currentSettings!.voice);

        // Bind events
        this.bindUtteranceEvents(utterance, hooks, chunk);

        // Update state
        this.utterance = utterance;
        this.currentText = chunk.text;
        this.chunkRetryCount = 0;

        // Immediately speak
        this.speech.speak(utterance);

        return utterance;
      }),
      catchError((error) => {
        this.logger.error('[TTSEngine] Chunk transition failed', error);
        hooks.onError(error instanceof Error ? error : new Error(String(error)));
        return EMPTY;
      })
    ).subscribe();
  }

  pause(): void {
    if (!this.speech || !this.speech.speaking || this.isPaused) {
      return;
    }

    // Save current position for pause/resume
    // Store both global position and chunk index
    this.pausedPosition = this.currentPosition;

    this.logger.info("[TTSEngine] Pausing playback", {
      position: this.pausedPosition,
      chunkIndex: this.currentChunkIndex,
      totalChunks: this.chunks.length,
    });

    try {
      // IMPORTANT: Set isPaused BEFORE calling cancel()
      // Firefox fires utterance.onend when cancel() is called, and we need
      // to prevent that onend handler from calling hooks.onEnd()
      this.isPaused = true;

      // Use cancel() instead of pause() for Firefox compatibility
      this.speech.cancel();
    } catch (error) {
      this.logger.warn("[TTSEngine] pause failed during cancel()", error);
      this.isPaused = false; // Reset on error
    }
  }

  resume(): void {
    if (!this.speech) {
      this.logger.warn("TTSEngine: resume called but speech is not available");
      return;
    }

    if (!this.isPaused || !this.currentHooks || !this.currentSettings) {
      this.logger.warn(
        "TTSEngine: resume called but not paused or missing context",
        {
          isPaused: this.isPaused,
          hasHooks: !!this.currentHooks,
          hasSettings: !!this.currentSettings,
        },
      );
      return;
    }

    this.logger.info("[TTSEngine] Resuming playback", {
      position: this.pausedPosition,
      chunkIndex: this.currentChunkIndex,
      hasChunks: this.chunks.length > 0,
    });

    // If we have chunks, resume from current chunk
    if (this.chunks.length > 0) {
      this.isPaused = false;
      this.isResuming = true;

      // Resume from current chunk
      this.playChunkAt(this.currentChunkIndex).catch((error) => {
        this.logger.error("[TTSEngine] Failed to resume from chunk", error);
        this.isResuming = false;
      });
      return;
    }

    // Fallback: Legacy resume behavior (for compatibility)
    // Get remaining text from paused position
    const remainingText = this.originalText.substring(this.pausedPosition);

    if (!remainingText || remainingText.length === 0) {
      this.logger.warn("TTSEngine: no remaining text to resume");
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
        this.bindUtteranceEventsWithOffset(
          utterance,
          this.currentHooks!,
          this.pausedPosition,
        );

        this.isPaused = false;
        this.speech.speak(utterance);
      } catch (error) {
        this.logger.warn("TTSEngine: resume failed", error);
        this.isResuming = false;
      }
    })();
  }

  stop(): void {
    if (this.speech && (this.speech.speaking || this.speech.pending)) {
      try {
        this.speech.cancel();
      } catch (error) {
        this.logger.warn("TTSEngine: cancel failed", error);
      }
    }
    this.cleanup();
  }

  updateSettings(settings: TTSSettings): void {
    if (!this.currentSettings) {
      return;
    }

    this.currentSettings = settings;

    // If currently speaking, pause to let user manually resume with new settings
    if (this.speech && this.speech.speaking && !this.isPaused) {
      this.logger.info(
        "[TTSEngine] Settings changed during playback, pausing for user to resume",
      );
      this.pause();
    }
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

  private applySettings(
    utterance: SpeechSynthesisUtterance,
    settings: TTSSettings,
  ): void {
    utterance.rate = Math.max(0.1, Math.min(10, settings.rate));
    utterance.pitch = Math.max(0, Math.min(2, settings.pitch));
    utterance.volume = Math.max(0, Math.min(1, settings.volume));
    utterance.lang = this.defaultLang;
  }

  private async applyVoice(
    utterance: SpeechSynthesisUtterance,
    voiceName: string | null | undefined,
  ): Promise<void> {
    if (!voiceName) {
      return;
    }

    try {
      const voices = await this.getVoices();
      const selectedVoice = voices.find((voice) => voice.name === voiceName);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      } else {
        this.logger.warn(
          `TTSEngine: voice "${voiceName}" not found. Using default voice.`,
        );
      }
    } catch (error) {
      this.logger.warn("TTSEngine: failed to fetch voices", error);
    }
  }

  /**
   * Play a specific chunk by index
   * @param chunkIndex - Index of chunk to play
   */
  private async playChunkAt(chunkIndex: number): Promise<void> {
    if (!this.currentHooks || !this.currentSettings) {
      throw new Error("TTSEngine: missing hooks or settings for chunk playback");
    }

    if (chunkIndex < 0 || chunkIndex >= this.chunks.length) {
      this.logger.error(`[TTSEngine] Invalid chunk index: ${chunkIndex}/${this.chunks.length}`);
      return;
    }

    const chunk = this.chunks[chunkIndex];
    this.currentChunkIndex = chunkIndex;
    this.currentText = chunk.text;

    this.logger.info(
      `[TTSEngine] Playing chunk ${chunkIndex + 1}/${this.chunks.length}`,
      {
        chunkLength: chunk.text.length,
        startOffset: chunk.startOffset,
      },
    );

    const utterance = this.createUtteranceFn(chunk.text);
    utterance.text = chunk.text;
    this.utterance = utterance;

    this.applySettings(utterance, this.currentSettings);
    await this.applyVoice(utterance, this.currentSettings.voice);
    // Bind events with Observable-based chunk transition (process2)
    this.bindUtteranceEvents(utterance, this.currentHooks, chunk);

    this.speech.speak(utterance);
  }

  /**
   * Retry current chunk on error
   */
  private async retryCurrentChunk(): Promise<void> {
    if (this.chunkRetryCount >= this.maxChunkRetries) {
      this.logger.error(
        `[TTSEngine] Max retries (${this.maxChunkRetries}) reached for chunk ${this.currentChunkIndex}`,
      );
      // Throw error to trigger error handling in onerror handler
      throw new Error(`Max retries (${this.maxChunkRetries}) reached for chunk ${this.currentChunkIndex}`);
    }

    this.chunkRetryCount++;
    this.logger.warn(
      `[TTSEngine] Retrying chunk ${this.currentChunkIndex} (attempt ${this.chunkRetryCount}/${this.maxChunkRetries})`,
    );

    // Small delay before retry
    await new Promise((resolve) => setTimeout(resolve, 100));
    await this.playChunkAt(this.currentChunkIndex);
  }

  /**
   * Bind events for chunk-based playback with Observable transition
   */
  private bindUtteranceEvents(
    utterance: SpeechSynthesisUtterance,
    hooks: PlaybackHooks,
    chunk: TextChunk
  ): void {
    utterance.onstart = () => {
      // Measure gap time between chunks for performance monitoring
      if (this.lastChunkEndTime > 0) {
        const gap = Date.now() - this.lastChunkEndTime;
        this.logger.info(`[TTSEngine] Chunk transition gap: ${gap}ms`);
      }

      // Reset pause state
      if (!this.isResuming) {
        this.isPaused = false;
      } else {
        this.isResuming = false;
      }
    };

    utterance.onend = () => {
      // Minimal onend handler (read-aloud pattern)
      // Just record time and emit to Observable - no heavy operations
      this.lastChunkEndTime = Date.now();
      if (hooks.onProgress) hooks.onProgress(100);

      if (!this.isPaused) {
        // Emit to Observable Subject (synchronous)
        if (this.currentChunkIndex + 1 < this.chunks.length) {
          this.chunkTransition$.next('next');
        } else {
          this.chunkTransition$.next('complete');
        }
      }
    };

    utterance.onerror = (event: any) => {
      const errorType = typeof event?.error === "string" ? event.error : "unknown";
      this.logger.error(`[TTSEngine] Chunk ${this.currentChunkIndex} error: ${errorType}`, event);

      this.retryCurrentChunk().catch((error) => {
        this.logger.error("[TTSEngine] Retry failed", error);
        const finalError = new Error(
          `Speech synthesis error after ${this.chunkRetryCount} retries: ${errorType}`,
        );
        try {
          this.speech.cancel();
        } catch (cancelError) {
          this.logger.warn("TTSEngine: cancel after error failed", cancelError);
        }
        this.cleanup();
        hooks.onError(finalError);
      });
    };

    utterance.onpause = () => {
      this.isPaused = true;
    };

    utterance.onresume = () => {
      this.isPaused = false;
    };

    utterance.onboundary = (event: any) => {
      if (typeof event?.charIndex === "number") {
        const oldPosition = this.currentPosition;
        this.currentPosition = chunk.startOffset + event.charIndex;
        const progress = this.calculateProgress();

        this.logger.info("[TTSEngine] onboundary", {
          charIndex: event.charIndex,
          chunkStartOffset: chunk.startOffset,
          oldPosition,
          newPosition: this.currentPosition,
          totalLength: this.totalLength,
          progress: progress.toFixed(2) + "%",
        });

        this.emitProgress(hooks);
      }
    };
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
        // Notify 100% progress before completing
        if (hooks.onProgress) {
          hooks.onProgress(100);
        }
        this.cleanup();
        hooks.onEnd();
      }
    };

    utterance.onerror = (event: any) => {
      const error = new Error(
        typeof event?.error === "string"
          ? `Speech synthesis error: ${event.error}`
          : "Unknown speech synthesis error",
      );
      try {
        this.speech.cancel();
      } catch (cancelError) {
        this.logger.warn("TTSEngine: cancel after error failed", cancelError);
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
      if (typeof event?.charIndex === "number") {
        // Add offset for position tracking when resuming
        this.currentPosition = offset + event.charIndex;
        this.emitProgress(hooks);
      }
    };
  }

  private emitProgress(hooks: PlaybackHooks): void {
    if (typeof hooks.onProgress !== "function") {
      return;
    }
    hooks.onProgress(this.calculateProgress());
  }

  private calculateProgress(): number {
    if (this.totalLength === 0) {
      return 0;
    }
    const ratio = this.currentPosition / this.totalLength;
    const uncapped = ratio * 100;
    const capped = Math.max(0, Math.min(99, uncapped));

    // Debug logging: show calculation details
    if (uncapped !== capped) {
      this.logger.info("[TTSEngine] Progress capped", {
        currentPosition: this.currentPosition,
        totalLength: this.totalLength,
        ratio: ratio.toFixed(4),
        uncapped: uncapped.toFixed(2) + "%",
        capped: capped + "%",
      });
    }

    // Cap at 99% (onend will send 100%)
    return capped;
  }

  private cleanup(): void {
    // Unsubscribe from Observable to prevent memory leaks
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    this.utterance = null;
    this.isPaused = false;
    this.currentText = "";
    this.currentPosition = 0;
    this.totalLength = 0;
    this.isResuming = false;
    this.chunks = [];
    this.currentChunkIndex = 0;
    this.chunkRetryCount = 0;
    this.lastChunkEndTime = 0;
  }

  private async getVoices(): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
      const existing = this.speech.getVoices();
      if (existing.length > 0) {
        resolve(existing);
        return;
      }

      const listener = () => {
        this.speech.removeEventListener?.("voiceschanged", listener as any);
        resolve(this.speech.getVoices());
      };

      this.speech.addEventListener?.("voiceschanged", listener as any);

      setTimeout(() => {
        this.speech.removeEventListener?.("voiceschanged", listener as any);
        resolve(this.speech.getVoices());
      }, 3000);
    });
  }
}
