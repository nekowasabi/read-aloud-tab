/**
 * contentResolver.ts
 * Extracted from service.ts (Process 50)
 *
 * Implements the ContentResolver contract for TabManager.
 * Waits for AI prefetch (summary/translation) when enabled,
 * falls back to on-demand AiProcessor if prefetch fails or times out.
 */
import { TabInfo } from '../shared/types';
import { ContentResolverResult } from './tabManager';
import { StorageManager } from '../shared/utils/storage';
import { LoggerLike } from './tabManager';

export interface PrefetcherLike {
  isPrefetchComplete(tabId: number): boolean;
  waitForPrefetch(
    tabId: number,
    timeoutMs: number,
    waitMode: 'wait' | 'skip',
  ): Promise<'completed' | 'timed_out' | 'failed'>;
  consumeCancelledWait(tabId: number): boolean;
  getResultFromStore(
    tabId: number,
    url?: string,
  ): Promise<{ summary?: string; translation?: string } | null>;
}

export interface AiProcessorLike {
  processContent(tab: TabInfo, settings: unknown): Promise<string | null>;
}

export interface TabLookup {
  getTabById(tabId: number): TabInfo | null;
}

export interface ContentResolverDeps {
  logger: LoggerLike;
  prefetcher: PrefetcherLike | null;
  aiProcessor: AiProcessorLike | null;
  tabLookup: TabLookup;
  emitContentRequest: (tabId: number) => void;
}

/**
 * Creates a ContentResolver function suitable for TabManager.setContentResolver().
 *
 * The resolver:
 * 1. Returns null (and triggers extraction) when tab has no content.
 * 2. If AI is enabled, waits for prefetch completion or times out,
 *    then falls back to on-demand AiProcessor when appropriate.
 * 3. Returns the best available content in all other cases.
 */
export function createContentResolver(deps: ContentResolverDeps) {
  const { logger, prefetcher, aiProcessor, tabLookup, emitContentRequest } = deps;

  return async (tab: TabInfo): Promise<ContentResolverResult | null> => {
    // If no content, request extraction and return null
    if (!tab.content || tab.content.trim().length === 0) {
      emitContentRequest(tab.tabId);
      return null;
    }

    // If AI prefetcher is available and enabled, wait for summary/translation
    if (prefetcher) {
      try {
        const settings = await StorageManager.getAiSettings();
        const needsAi = settings.enableAiSummary === true || settings.enableAiTranslation === true;

        if (needsAi) {
          logger.info(`[ContentResolver] Waiting for AI prefetch for tab ${tab.tabId}...`);
          const waitMode = settings.summaryWaitMode || 'wait';

          const isPrefetchComplete = prefetcher.isPrefetchComplete(tab.tabId);
          if (!isPrefetchComplete) {
            // Prefetch is in progress — use a bounded wait based on waitMode
            const boundedTimeout = waitMode === 'wait' ? 120000 : 30000;
            const waitResult = await prefetcher.waitForPrefetch(tab.tabId, boundedTimeout, waitMode);

            if (waitResult === 'completed') {
              logger.info(`[ContentResolver] AI prefetch completed for tab ${tab.tabId}`);
            } else if (waitResult === 'failed') {
              logger.warn(`[ContentResolver] AI prefetch failed for tab ${tab.tabId}, using best available content`);
            } else {
              logger.warn(`[ContentResolver] AI prefetch timed out for tab ${tab.tabId}, attempting on-demand fallback`);
            }

            const updatedTab = tabLookup.getTabById(tab.tabId) ?? tab;
            const waitWasCancelled = prefetcher.consumeCancelledWait(tab.tabId);
            const shouldFallbackToOnDemandSummary =
              settings.enableAiSummary === true &&
              !updatedTab.summary &&
              !waitWasCancelled &&
              (waitResult !== 'failed' || waitMode === 'wait');

            if (shouldFallbackToOnDemandSummary) {
              logger.info(`[ContentResolver] Fallback: checking result store for tab ${tab.tabId}`);
              const cachedResult = await prefetcher.getResultFromStore(tab.tabId, tab.url);
              if (cachedResult?.summary) {
                logger.info(`[ContentResolver] Found cached result in store for tab ${tab.tabId}`);
                const currentTab = tabLookup.getTabById(tab.tabId);
                if (!currentTab || currentTab.url === tab.url) {
                  updatedTab.summary = cachedResult.summary;
                  if (cachedResult.translation) {
                    updatedTab.translation = cachedResult.translation;
                  }
                }
              } else if (aiProcessor) {
                logger.info(`[ContentResolver] Fallback: triggering on-demand summarization for tab ${tab.tabId}`);
                try {
                  const processed = await aiProcessor.processContent(updatedTab, settings);
                  if (processed) {
                    updatedTab.summary = processed;
                  }
                } catch (fallbackError) {
                  logger.warn('[ContentResolver] On-demand fallback failed', fallbackError);
                }
              }
            }

            const hasSummary = !!updatedTab.summary;
            const hasTranslation = !!updatedTab.translation;
            logger.debug?.(`[ContentResolver] Prefetch result: summary=${hasSummary}, translation=${hasTranslation}`);
            return {
              content: updatedTab.content,
              summary: updatedTab.summary,
              translation: updatedTab.translation,
              extractedAt: updatedTab.extractedAt,
            };
          } else {
            // Prefetch already complete (or not needed) — return current tab state
            const currentTab = tabLookup.getTabById(tab.tabId) ?? tab;
            const hasSummary = !!currentTab.summary;
            const hasTranslation = !!currentTab.translation;
            logger.debug?.(`[ContentResolver] Prefetch already complete for tab ${tab.tabId}: summary=${hasSummary}, translation=${hasTranslation}`);
            return {
              content: currentTab.content,
              summary: currentTab.summary,
              translation: currentTab.translation,
              extractedAt: currentTab.extractedAt,
            };
          }
        }
      } catch (error) {
        logger.warn('[ContentResolver] Failed to check AI settings or wait for prefetch', error);
      }
    }

    // Return current content (fallback or AI disabled)
    const hasSummary = !!tab.summary;
    const hasTranslation = !!tab.translation;
    logger.debug?.(`[ContentResolver] Resolved content for tab ${tab.tabId}: summary=${hasSummary}, translation=${hasTranslation}`);
    return {
      content: tab.content,
      summary: tab.summary,
      translation: tab.translation,
      extractedAt: tab.extractedAt,
    };
  };
}
