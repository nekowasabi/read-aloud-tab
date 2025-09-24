import type { QueueStatus } from '../types/queue';
import type { TabInfo } from '../types/tab';
import { createSerializedTab } from '../types/helpers';

describe('Shared types structure', () => {
  test('createSerializedTab produces normalized structure', () => {
    const tab: TabInfo = {
      tabId: 1,
      url: 'https://example.com',
      title: 'Example',
      isIgnored: false,
      extractedAt: new Date('2024-01-01T00:00:00Z'),
    };

    const serialized = createSerializedTab(tab);
    expect(serialized.extractedAt).toBe('2024-01-01T00:00:00.000Z');
  });

  test('QueueStatus type includes paused state', () => {
    const status: QueueStatus = 'paused';
    expect(status).toBe('paused');
  });
});
