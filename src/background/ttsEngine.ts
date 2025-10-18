import { TabInfo, TTSSettings } from "../shared/types";
import { LoggerLike, PlaybackController, PlaybackHooks } from "./tabManager";
import { chunkText, TextChunk, ChunkConfig } from "../shared/utils/textChunker";
import { Subject, Subscription, of, EMPTY, from } from 'rxjs';
import { tap, filter, switchMap, catchError, map } from 'rxjs/operators';
import { BrowserAdapter } from "../shared/utils/browser";
// === process5 sub5: デフォルト音声選択ロジックの改善 ===
import { selectBestVoice } from "../shared/utils/voiceSelector";

// === process100 sub1: ブラウザ別設定の共通化 ===
// 定数を共通化ファイルから導入
import {
  VOICES_TIMEOUT_MS,
  MAX_VOICE_RETRIES,
  VOICE_RETRY_DELAYS,
  SAFE_READING_TIME_SEC,
  CHARS_PER_SECOND_CONSERVATIVE,
  CHARS_PER_SECOND_FIREFOX,
  MIN_CHUNK_SIZE_GENERAL,
  CHUNK_COUNT_WARNING_THRESHOLD,
  MAX_CHUNK_RETRIES,
  CHUNK_RETRY_WAIT_MS,
  CHUNK_GAP_WARNING_THRESHOLD_MS,
} from "../shared/constants";

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
  // === process3 sub1: チャンク遷移リトライ回数の増加（2→5）===
  // === process100 sub1: 定数参照に変更 ===
  private readonly maxChunkRetries: number = MAX_CHUNK_RETRIES;

  // Observable-based chunk transition (process1-7)
  private chunkTransition$ = new Subject<'next' | 'complete'>();
  private subscription: Subscription | null = null;

  // Performance measurement (process7)
  private lastChunkEndTime: number = 0;

  // === process4: デバッグ機能追加 ===
  // sub1: Firefox向けログレベル設定
  private isFirefox: boolean = false;
  private debugLoggingEnabled: boolean = false;

  // sub2: チャンク処理進捗のための時刻記録
  private _chunkStartTime: number = 0;
  private chunkProcessingTimes: Map<number, number> = new Map();

  // sub3: エラー統計情報収集
  public readonly errorStats: { [key: string]: number } = {};

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

    // === process4 sub1: Firefox判定とログレベル設定 ===
    this.isFirefox = BrowserAdapter.getBrowserType() === 'firefox';
    this.debugLoggingEnabled = this.isFirefox;

    if (this.debugLoggingEnabled) {
      this.logger.debug('[TTSEngine] Detailed logging enabled (Firefox detected)');
    }

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

    // === process50 sub1: AI処理により極端に短縮された場合の警告ログ ===
    if (tab.processedContent && tab.content) {
      const ratio = tab.processedContent.length / tab.content.length;
      if (ratio < 0.1) {
        this.logger.warn(
          `[TTSEngine] AI処理により大幅に短縮されました: ${(ratio * 100).toFixed(1)}% ` +
          `(元: ${tab.content.length}文字 → ${tab.processedContent.length}文字)`
        );
      }
    }

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
    // Japanese reading speed varies significantly:
    // - Hiragana/Katakana: faster
    // - Kanji: slower
    // - Punctuation: adds pauses
    // Using conservative estimates to ensure we stay well under 15s

    // === process2: Chunk Size Optimization ===
    // Calculate chunk size based on browser type and playback rate
    const chunkConfig = this.calculateChunkConfig(settings);

    const chunkResult = chunkText(textToSpeak, chunkConfig);
    this.chunks = chunkResult.chunks;
    this.currentChunkIndex = 0;
    this.chunkRetryCount = 0;

    // === process2 sub2: Chunk count warning ===
    if (chunkResult.totalChunks > CHUNK_COUNT_WARNING_THRESHOLD) {
      this.logger.warn(
        `[TTSEngine] High chunk count detected (${chunkResult.totalChunks} chunks). ` +
        `Content is ${chunkResult.originalLength} characters. Consider using summarization.`,
      );
    }

    this.logger.info(
      `[TTSEngine] Starting TTS with ${chunkResult.totalChunks} chunks (Browser: ${BrowserAdapter.getBrowserType()}, Rate: ${settings.rate})`,
      {
        originalLength: chunkResult.originalLength,
        chunks: chunkResult.totalChunks,
        totalLength: this.totalLength,
        chunkSize: chunkConfig.maxChunkSize,
      },
    );

    // === process4 sub1: Firefox向けの詳細ログ出力 ===
    if (this.debugLoggingEnabled) {
      this.logger.debug('[TTSEngine] [Firefox] Chunk initialization details', {
        browserType: BrowserAdapter.getBrowserType(),
        isChromeOffscreen: false,
        totalChunks: chunkResult.totalChunks,
        chunkSizeConfig: {
          maxChunkSize: chunkConfig.maxChunkSize,
          minChunkSize: chunkConfig.minChunkSize,
        },
        settings: {
          rate: settings.rate,
          pitch: settings.pitch,
          volume: settings.volume,
          voice: settings.voice,
        },
      });
    }

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
          // === process4 sub2: チャンク処理進捗の可視化 ===
          const progressStr = `[TTSEngine] Chunk progress: ${this.currentChunkIndex}/${this.chunks.length} chunks completed`;
          this.logger.info(progressStr);

          // Calculate and log timing information for the previous chunk
          if (this.lastChunkEndTime > 0) {
            const timeSinceLast = Date.now() - this.lastChunkEndTime;
            if (this.debugLoggingEnabled && timeSinceLast > 100) {
              this.logger.debug(`[TTSEngine] [Progress] Chunk ${this.currentChunkIndex - 1} completed in ${timeSinceLast}ms`);
            }
          }
        } else if (event === 'complete') {
          this.logger.info('[TTSEngine] All chunks completed');
          // === process4 sub2: 最終進捗ログ ===
          if (this.debugLoggingEnabled) {
            this.logger.debug('[TTSEngine] [Progress] Playback completed with timing statistics', {
              totalChunks: this.chunks.length,
              averageChunkTime: this.calculateAverageChunkTime(),
              longestChunk: this.findLongestChunkTime(),
            });
          }
          this.cleanup();
          hooks.onEnd();
        }
      }),
      filter((event) => event === 'next'),
      filter(() => this.currentChunkIndex < this.chunks.length),
      switchMap(() => {
        const chunk = this.chunks[this.currentChunkIndex];
        const utterance = this.createUtteranceFn(chunk.text);
        utterance.text = chunk.text;

        // Apply settings
        this.applySettings(utterance, this.currentSettings!);

        // Convert async applyVoice to Observable
        return from(this.applyVoice(utterance, this.currentSettings!.voice)).pipe(
          tap(() => {
            // Bind events
            this.bindUtteranceEvents(utterance, hooks, chunk);

            // Update state
            this.utterance = utterance;
            this.currentText = chunk.text;
            this.chunkRetryCount = 0;

            // === process4 sub2: チャンク処理開始時刻の記録 ===
            this._chunkStartTime = Date.now();

            // === process4 sub1: Firefox向けログ（各チャンクの開始時点） ===
            if (this.debugLoggingEnabled) {
              this.logger.debug(`[TTSEngine] [Firefox] Starting chunk ${this.currentChunkIndex + 1}/${this.chunks.length}`, {
                chunkStartTime: this._chunkStartTime,
                chunkLength: chunk.text.length,
                textPreview: chunk.text.substring(0, 40),
              });
            }

            // Immediately speak
            this.speech.speak(utterance);
          }),
          map(() => utterance)
        );
      }),
      // === process3 sub2: catchErrorでの処理改善 ===
      // エラー発生時に処理停止ではなく、詳細なログを出力してスキップ
      catchError((error) => {
        // === process4 sub3: エラー詳細情報の収集 ===
        const errorType = this.extractErrorType(error);
        this.errorStats[errorType] = (this.errorStats[errorType] || 0) + 1;

        const errorDetails = {
          chunkIndex: this.currentChunkIndex,
          totalChunks: this.chunks.length,
          retryCount: this.chunkRetryCount,
          maxRetries: this.maxChunkRetries,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          // === process4 sub3: ブラウザ情報とチャンク内容をエラーに含める ===
          browserInfo: {
            type: BrowserAdapter.getBrowserType(),
            isFirefox: this.isFirefox,
          },
          chunkInfo: {
            text: this.currentText.substring(0, 100),
            length: this.currentText.length,
          },
          errorStats: { ...this.errorStats },
        };

        this.logger.error(
          '[TTSEngine] Chunk transition failed - detailed error report',
          errorDetails
        );

        // 最大リトライ数に達した場合のみ、ユーザーにエラーを通知して終了
        // リトライ中のエラーはスキップして次チャンクへ
        if (this.chunkRetryCount >= this.maxChunkRetries) {
          this.logger.error(
            `[TTSEngine] Max retries (${this.maxChunkRetries}) reached. Stopping playback.`,
            errorDetails
          );
          hooks.onError(error instanceof Error ? error : new Error(String(error)));
          return EMPTY;
        }

        // リトライ中のエラーは無視してスキップ
        this.logger.warn(
          `[TTSEngine] Skipping chunk due to error (retry attempt ${this.chunkRetryCount}/${this.maxChunkRetries})`,
          { chunkIndex: this.currentChunkIndex }
        );

        // 次チャンクへスキップ
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

  // sub2: 日本語音声フィルタリングロジック（共通化用）
  private isJapaneseVoice(voice: SpeechSynthesisVoice): boolean {
    return (
      voice.lang.startsWith('ja') ||
      voice.lang.includes('JP') ||
      voice.name.includes('Japanese') ||
      voice.name.includes('日本')
    );
  }

  // sub2: 日本語音声を優先的に選択
  private selectBestJapaneseVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
    return voices.find((voice) => this.isJapaneseVoice(voice));
  }

  private async applyVoice(
    utterance: SpeechSynthesisUtterance,
    voiceName: string | null | undefined,
  ): Promise<void> {
    try {
      const voices = await this.getVoices();

      // === process5 sub5: デフォルト音声選択ロジックの改善 ===
      // 指定音声がある場合、それを検索
      if (voiceName) {
        const selectedVoice = voices.find((voice) => voice.name === voiceName);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
          return;
        }
        // 指定音声が見つからない場合、ログ出力
        this.logger.warn(
          `TTSEngine: voice "${voiceName}" not found. Attempting to use best voice.`,
        );
      }

      // 指定音声がない場合、または見つからない場合は最適な音声を自動選択
      const preferredGender = this.currentSettings?.preferredGender || 'female';
      const bestVoice = selectBestVoice(voices, preferredGender, 'ja');

      if (bestVoice) {
        utterance.voice = bestVoice;
        this.logger.info(
          `TTSEngine: selected best voice "${bestVoice.name}" (lang: ${bestVoice.lang}, gender: ${preferredGender})`
        );
      } else {
        this.logger.warn(
          "TTSEngine: no suitable voice found. Using default voice."
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
   * === process3 sub1: チャンク遷移リトライ回数の増加 ===
   * - maxChunkRetries: 2 → 5に増加
   * - 待機時間: 100ms (process3 sub1で指定)
   * - リトライ失敗時にエラーをスロー
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

    // === process3 sub1: リトライ時の待機時間（100ms）===
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
      // === process3 sub3: タイムアウト検知と自動リカバリー ===
      // 各チャンクの読み上げ開始時刻を記録
      const chunkStartTime = Date.now();
      (utterance as any)._chunkStartTime = chunkStartTime;

      // Measure gap time between chunks for performance monitoring
      if (this.lastChunkEndTime > 0) {
        const gap = chunkStartTime - this.lastChunkEndTime;
        this.logger.info(`[TTSEngine] Chunk transition gap: ${gap}ms`);

        // === process3 sub3: 20秒以上のギャップを検知 ===
        if (gap > 20000) {
          this.logger.warn(
            `[TTSEngine] Large chunk transition gap detected (${gap}ms > 20s). ` +
            `This may indicate Service Worker timeout or other issues.`,
            { chunkIndex: this.currentChunkIndex, gap }
          );
        }
      }

      // Reset pause state
      if (!this.isResuming) {
        this.isPaused = false;
      } else {
        this.isResuming = false;
      }
    };

    utterance.onend = () => {
      // === process3 sub3: チャンク実行時間の記録 ===
      // 各チャンクの読み上げ実行時間を記録してログ出力
      const chunkStartTime = (utterance as any)._chunkStartTime;
      if (chunkStartTime) {
        const actualDuration = Date.now() - chunkStartTime;
        const charsPerSecond = (chunk.text.length / actualDuration) * 1000;
        this.logger.info(
          `[TTSEngine] Chunk ${this.currentChunkIndex + 1} completed: ${actualDuration}ms for ${chunk.text.length} chars (${charsPerSecond.toFixed(2)} chars/sec)`
        );
      }

      // Minimal onend handler (read-aloud pattern)
      // Just record time and emit to Observable - no heavy operations
      this.lastChunkEndTime = Date.now();

      if (!this.isPaused) {
        // Emit to Observable Subject (synchronous)
        if (this.currentChunkIndex + 1 < this.chunks.length) {
          // More chunks to go - don't send 100% progress yet
          this.chunkTransition$.next('next');
        } else {
          // Last chunk - send 100% progress before completion
          if (hooks.onProgress) hooks.onProgress(100);
          this.chunkTransition$.next('complete');
        }
      }
    };

    utterance.onerror = (event: any) => {
      // === process3 sub2: エラー発生時に詳細ログを出力 ===
      const errorType = typeof event?.error === "string" ? event.error : "unknown";

      // Log timeout errors specially (likely 15s timeout)
      if (errorType === "interrupted" || errorType === "network") {
        this.logger.warn(
          `[TTSEngine] Possible timeout error (15s limit): ${errorType} for chunk ${this.currentChunkIndex + 1} (${chunk.text.length} chars)`
        );
      }

      // === process3 sub2: エラー内容の詳細ログ出力 ===
      this.logger.error(
        `[TTSEngine] Chunk ${this.currentChunkIndex} error: ${errorType}`,
        {
          chunkIndex: this.currentChunkIndex,
          errorType,
          chunkLength: chunk.text.length,
          chunkText: chunk.text.substring(0, 100),
          totalChunks: this.chunks.length,
          retryCount: this.chunkRetryCount,
          maxRetries: this.maxChunkRetries,
        }
      );

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
    // sub1: タイムアウトを3秒→10秒に延長
    // sub3: リトライロジックを実装（exponential backoff）

    const getVoicesOnce = (): Promise<SpeechSynthesisVoice[]> => {
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
        }, VOICES_TIMEOUT_MS);
      });
    };

    let lastVoices: SpeechSynthesisVoice[] = [];

    for (let attempt = 0; attempt < MAX_VOICE_RETRIES; attempt++) {
      const voices = await getVoicesOnce();

      if (voices.length > 0) {
        return voices;
      }

      lastVoices = voices;

      // 最後の試行でない場合、指数バックオフで待機
      if (attempt < MAX_VOICE_RETRIES - 1) {
        const delay = VOICE_RETRY_DELAYS[attempt];
        this.logger.warn(
          `[TTSEngine] Failed to get voices (attempt ${attempt + 1}/${MAX_VOICE_RETRIES}), retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    this.logger.warn(
      `[TTSEngine] Failed to get voices after ${MAX_VOICE_RETRIES} retries`
    );
    return lastVoices;
  }

  // === process2: Chunk Size Optimization ===
  // Calculate chunk size based on browser type and playback rate
  private calculateChunkConfig(settings: TTSSettings): ChunkConfig {
    const browserType = BrowserAdapter.getBrowserType();
    const isFirefox = browserType === 'firefox';

    // sub1: ブラウザ別チャンクサイズ設定
    // Firefox: より保守的でない計算（persistent scriptなので安定性高い）
    // Chrome: conservative calculation
    const charsPerSecond = isFirefox ? CHARS_PER_SECOND_FIREFOX : CHARS_PER_SECOND_CONSERVATIVE;

    // Calculate chunk size based on safe reading time (8 seconds)
    // This ensures we stay well under the Web Speech API 15-second timeout
    // Formula: maxChunkSize = SAFE_READING_TIME_SEC × charsPerSecond × rate
    //
    // Example (Firefox 2.5x speed):
    // - maxChunkSize = 8 × 3 × 2.5 = 60 characters
    // - Reading time = 60 ÷ (3 × 2.5) = 8 seconds ✅ Safe
    let maxChunkSize = Math.floor(SAFE_READING_TIME_SEC * charsPerSecond * settings.rate);

    // Apply minimum chunk size to avoid overly small chunks
    // This prevents creating too many tiny chunks at low speeds
    maxChunkSize = Math.max(MIN_CHUNK_SIZE_GENERAL, maxChunkSize);

    // Set minimum chunk size (slightly relaxed for Firefox due to persistent script)
    const minChunkSize = isFirefox ? 30 : 20;

    // Calculate estimated reading time for debugging
    const estimatedReadingTime = maxChunkSize / (charsPerSecond * settings.rate);

    this.logger.debug(
      `[TTSEngine] Chunk config calculated`,
      {
        browser: browserType,
        rate: settings.rate,
        charsPerSecond,
        maxChunkSize,
        minChunkSize,
        estimatedReadingTime: `${estimatedReadingTime.toFixed(1)}s`,
      },
    );

    return {
      maxChunkSize,
      minChunkSize,
    };
  }

  // === process4: デバッグ機能ヘルパーメソッド ===

  /**
   * エラー種別を抽出（process4 sub3）
   * @param error エラーオブジェクト
   * @returns エラー種別のキー
   */
  private extractErrorType(error: unknown): string {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('network')) return 'network_error';
      if (msg.includes('timeout')) return 'timeout_error';
      if (msg.includes('voice')) return 'voice_error';
      if (msg.includes('audio')) return 'audio_error';
    }
    return 'unknown_error';
  }

  /**
   * チャンク処理時間の平均値を計算（process4 sub2）
   */
  private calculateAverageChunkTime(): number {
    if (this.chunkProcessingTimes.size === 0) return 0;
    const total = Array.from(this.chunkProcessingTimes.values()).reduce((a, b) => a + b, 0);
    return Math.round(total / this.chunkProcessingTimes.size);
  }

  /**
   * 最も長いチャンク処理時間を検出（process4 sub2）
   */
  private findLongestChunkTime(): number {
    if (this.chunkProcessingTimes.size === 0) return 0;
    return Math.max(...Array.from(this.chunkProcessingTimes.values()));
  }
}
