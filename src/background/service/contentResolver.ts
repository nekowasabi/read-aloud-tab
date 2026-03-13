import { TabInfo } from '../../shared/types';
import { AiPrefetcher } from '../aiPrefetcher';
import { AiProcessor } from '../aiProcessor';
import { LoggerLike } from '../tabManager';

export interface ContentResolverDeps {
  prefetcher: AiPrefetcher | null;
  aiProcessor: AiProcessor | null;
  getTabById: (tabId: number) => TabInfo | null | undefined;
  logger: LoggerLike;
  emitContentRequest: (tabId: number, reason: 'missing' | 'stale') => void;
}

export type ContentResolvedResult = {
  content?: string;
  summary?: string;
  translation?: string;
  extractedAt?: Date | string | number;
} | null;

/**
 * Factory function that creates a content resolver for TabManager.
 * Waits for AI summary/translation if enabled before returning.
 * If prefetch isn't ready yet, returns null immediately and triggers
 * prefetch in the background so the caller can use fallback content.
 */
export function createContentResolver(deps: ContentResolverDeps) {
  const { prefetcher, aiProcessor, getTabById, logger, emitContentRequest } = deps;

  return async (tab: TabInfo): Promise<ContentResolvedResult> => {
    // If no content, request extraction first
    if (!tab.content || tab.content.trim().length === 0) {
      emitContentRequest(tab.tabId, 'missing');
      return null;
    }

    // If AI prefetcher is available and enabled, wait for summary/translation
    if (prefetcher) {
      try {
        const settings = await import('../../shared/utils/storage').then((m) =>
          m.StorageManager.getAiSettings()
        );
        const needsAi = settings.enableAiSummary === true || settings.enableAiTranslation === true;

        if (needsAi) {
          logger.info(`[ContentResolver] Waiting for AI prefetch for tab ${tab.tabId}...`);
          const waitMode = settings.summaryWaitMode || 'wait';

          const isPrefetchComplete = prefetcher.isPrefetchComplete(tab.tabId);
          if (!isPrefetchComplete) {
            const boundedTimeout = waitMode === 'wait' ? 120000 : 30000;
            const waitResult = await prefetcher.waitForPrefetch(
              tab.tabId,
              boundedTimeout,
              waitMode
            );

            if (waitResult === 'completed') {
              logger.info(`[ContentResolver] AI prefetch completed for tab ${tab.tabId}`);
            } else if (waitResult === 'failed') {
              logger.warn(
                `[ContentResolver] AI prefetch failed for tab ${tab.tabId}, using best available content`
              );
            } else {
              logger.warn(
                `[ContentResolver] AI prefetch timed out for tab ${tab.tabId}, attempting on-demand fallback`
              );
            }

            const updatedTab = getTabById(tab.tabId) ?? tab;
            const waitWasCancelled = prefetcher.consumeCancelledWait(tab.tabId);
            const shouldFallbackToOnDemandSummary =
              settings.enableAiSummary === true &&
              !updatedTab.summary &&
              !waitWasCancelled &&
              (waitResult !== 'failed' || waitMode === 'wait');

            if (shouldFallbackToOnDemandSummary) {
              logger.info(
                `[ContentResolver] Fallback: checking result store for tab ${tab.tabId}`
              );
              const cachedResult = await prefetcher.getResultFromStore(tab.tabId, tab.url);
              if (cachedResult?.summary) {
                logger.info(
                  `[ContentResolver] Found cached result in store for tab ${tab.tabId}`
                );
                const currentTab = getTabById(tab.tabId);
                if (!currentTab || currentTab.url === tab.url) {
                  updatedTab.summary = cachedResult.summary;
                  if (cachedResult.translation) {
                    updatedTab.translation = cachedResult.translation;
                  }
                }
              } else if (aiProcessor) {
                logger.info(
                  `[ContentResolver] Fallback: triggering on-demand summarization for tab ${tab.tabId}`
                );
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
            logger.debug?.(
              `[ContentResolver] Prefetch result: summary=${hasSummary}, translation=${hasTranslation}`
            );
            return {
              content: updatedTab.content,
              summary: updatedTab.summary,
              translation: updatedTab.translation,
              extractedAt: updatedTab.extractedAt,
            };
          } else {
            const currentTab = getTabById(tab.tabId) ?? tab;
            const hasSummary = !!currentTab.summary;
            const hasTranslation = !!currentTab.translation;
            logger.debug?.(
              `[ContentResolver] Prefetch already complete for tab ${tab.tabId}: summary=${hasSummary}, translation=${hasTranslation}`
            );
            return {
              content: currentTab.content,
              summary: currentTab.summary,
              translation: currentTab.translation,
              extractedAt: currentTab.extractedAt,
            };
          }
        }
      } catch (error) {
        logger.warn(
          '[ContentResolver] Failed to check AI settings or wait for prefetch',
          error
        );
      }
    }

    // Return current content (fallback or AI disabled)
    const hasSummary = !!tab.summary;
    const hasTranslation = !!tab.translation;
    logger.debug?.(
      `[ContentResolver] Resolved content for tab ${tab.tabId}: summary=${hasSummary}, translation=${hasTranslation}`
    );
    return {
      content: tab.content,
      summary: tab.summary,
      translation: tab.translation,
      extractedAt: tab.extractedAt,
    };
  };
}
