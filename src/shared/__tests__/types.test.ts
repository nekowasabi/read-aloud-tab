/**
 * @file Type definitions test suite
 * TDD RED Phase: These tests will fail until types are implemented
 */

import {
  ReadingQueue,
  TabInfo,
  QueueMessage,
  QueueStatus,
  TTSSettings,
} from '../types';

describe('Type Definitions', () => {
  describe('ReadingQueue interface', () => {
    it('should have correct structure for ReadingQueue', () => {
      const mockQueue: ReadingQueue = {
        tabs: [],
        currentIndex: 0,
        status: 'idle',
        settings: {
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
          voice: null,
        },
      };

      expect(mockQueue).toBeDefined();
      expect(mockQueue.tabs).toEqual([]);
      expect(mockQueue.currentIndex).toBe(0);
      expect(mockQueue.status).toBe('idle');
      expect(mockQueue.settings).toBeDefined();
    });

    it('should support all QueueStatus values', () => {
      const statuses: QueueStatus[] = ['idle', 'reading', 'paused', 'error'];

      statuses.forEach(status => {
        const queue: ReadingQueue = {
          tabs: [],
          currentIndex: 0,
          status,
          settings: {
            rate: 1.0,
            pitch: 1.0,
            volume: 1.0,
            voice: null,
          },
        };
        expect(queue.status).toBe(status);
      });
    });
  });

  describe('TabInfo interface', () => {
    it('should have correct structure for TabInfo', () => {
      const mockTab: TabInfo = {
        tabId: 123,
        url: 'https://example.com',
        title: 'Example Page',
        content: 'This is example content',
        summary: 'Example summary',
        translation: 'これは翻訳された内容です',
        isIgnored: false,
        extractedAt: new Date(),
      };

      expect(mockTab.tabId).toBe(123);
      expect(mockTab.url).toBe('https://example.com');
      expect(mockTab.title).toBe('Example Page');
      expect(mockTab.content).toBe('This is example content');
      expect(mockTab.summary).toBe('Example summary');
      expect(mockTab.translation).toBe('これは翻訳された内容です');
      expect(mockTab.isIgnored).toBe(false);
      expect(mockTab.extractedAt).toBeInstanceOf(Date);
    });

    it('should allow optional fields to be undefined', () => {
      const minimalTab: TabInfo = {
        tabId: 456,
        url: 'https://minimal.com',
        title: 'Minimal Page',
        isIgnored: false,
        extractedAt: new Date(),
      };

      expect(minimalTab.content).toBeUndefined();
      expect(minimalTab.summary).toBeUndefined();
      expect(minimalTab.translation).toBeUndefined();
    });
  });

  describe('QueueMessage types', () => {
    it('should support QUEUE_ADD message', () => {
      const addMessage: QueueMessage = {
        type: 'QUEUE_ADD',
        payload: {
          tabInfo: {
            tabId: 789,
            url: 'https://new.com',
            title: 'New Page',
            isIgnored: false,
            extractedAt: new Date(),
          },
          position: 'end',
        },
      };

      expect(addMessage.type).toBe('QUEUE_ADD');
      expect(addMessage.payload.tabInfo.tabId).toBe(789);
      expect(addMessage.payload.position).toBe('end');
    });

    it('should support QUEUE_REMOVE message', () => {
      const removeMessage: QueueMessage = {
        type: 'QUEUE_REMOVE',
        payload: {
          tabId: 123,
        },
      };

      expect(removeMessage.type).toBe('QUEUE_REMOVE');
      expect(removeMessage.payload.tabId).toBe(123);
    });

    it('should support QUEUE_REORDER message', () => {
      const reorderMessage: QueueMessage = {
        type: 'QUEUE_REORDER',
        payload: {
          fromIndex: 0,
          toIndex: 2,
        },
      };

      expect(reorderMessage.type).toBe('QUEUE_REORDER');
      expect(reorderMessage.payload.fromIndex).toBe(0);
      expect(reorderMessage.payload.toIndex).toBe(2);
    });

    it('should support QUEUE_SKIP message', () => {
      const skipMessage: QueueMessage = {
        type: 'QUEUE_SKIP',
        payload: {
          direction: 'next',
        },
      };

      expect(skipMessage.type).toBe('QUEUE_SKIP');
      expect(skipMessage.payload.direction).toBe('next');
    });
  });
});
