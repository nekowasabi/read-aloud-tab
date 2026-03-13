/**
 * useQueueCommands.test.ts
 * Process 100 Red Phase: queue操作コマンドhookのテスト
 */
import { renderHook } from '@testing-library/react';
import { useQueueCommands } from '../tabQueue/useQueueCommands';

describe('useQueueCommands (Process 100)', () => {
  const mockSendCommand = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should provide queue command interface', () => {
    const { result } = renderHook(() => useQueueCommands(mockSendCommand));

    expect(typeof result.current.addTab).toBe('function');
    expect(typeof result.current.removeTab).toBe('function');
    expect(typeof result.current.clearQueue).toBe('function');
    expect(typeof result.current.reorderTabs).toBe('function');
    expect(typeof result.current.skipNext).toBe('function');
    expect(typeof result.current.skipPrevious).toBe('function');
    expect(typeof result.current.control).toBe('function');
    expect(typeof result.current.updateSettings).toBe('function');
  });

  it('should call sendCommand with QUEUE_ADD on addTab', async () => {
    const { result } = renderHook(() => useQueueCommands(mockSendCommand));

    await result.current.addTab({
      tabId: 1,
      url: 'https://example.com',
      title: 'Example',
    });

    expect(mockSendCommand).toHaveBeenCalledWith({
      type: 'QUEUE_ADD',
      payload: expect.objectContaining({ tab: { tabId: 1, url: 'https://example.com', title: 'Example' } }),
    });
  });

  it('should call sendCommand with QUEUE_CLEAR on clearQueue', async () => {
    const { result } = renderHook(() => useQueueCommands(mockSendCommand));

    await result.current.clearQueue();

    expect(mockSendCommand).toHaveBeenCalledWith({ type: 'QUEUE_CLEAR' });
  });

  it('should call sendCommand with QUEUE_CONTROL on control', async () => {
    const { result } = renderHook(() => useQueueCommands(mockSendCommand));

    await result.current.control('start');

    expect(mockSendCommand).toHaveBeenCalledWith({
      type: 'QUEUE_CONTROL',
      payload: { action: 'start' },
    });
  });

  it('should call sendCommand with QUEUE_SKIP next on skipNext', async () => {
    const { result } = renderHook(() => useQueueCommands(mockSendCommand));

    await result.current.skipNext();

    expect(mockSendCommand).toHaveBeenCalledWith({
      type: 'QUEUE_SKIP',
      payload: { direction: 'next' },
    });
  });
});
