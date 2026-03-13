/**
 * useQueuePort.test.ts
 * Process 100 Red Phase: queue port接続hookのテスト
 */
import { renderHook, act } from '@testing-library/react';
import { useQueuePort } from '../tabQueue/useQueuePort';

const mockConnect = jest.fn();
const mockPostMessage = jest.fn();
const mockDisconnect = jest.fn();
const mockOnMessageAddListener = jest.fn();
const mockOnDisconnectAddListener = jest.fn();

const makeMockPort = () => ({
  postMessage: mockPostMessage,
  disconnect: mockDisconnect,
  onMessage: { addListener: mockOnMessageAddListener, removeListener: jest.fn() },
  onDisconnect: { addListener: mockOnDisconnectAddListener, removeListener: jest.fn() },
});

describe('useQueuePort (Process 100)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const port = makeMockPort();
    mockConnect.mockReturnValue(port);
    (global as any).chrome = {
      runtime: {
        connect: mockConnect,
        lastError: null,
      },
    };
  });

  it('should establish port connection to background on mount', () => {
    const onMessage = jest.fn();
    renderHook(() => useQueuePort(onMessage));

    expect(mockConnect).toHaveBeenCalledWith({ name: 'read-aloud-tab-queue' });
  });

  it('should start in connecting state and become connected', () => {
    const onMessage = jest.fn();
    const { result } = renderHook(() => useQueuePort(onMessage));

    // connect が呼ばれた直後は connected
    expect(result.current.connectionState).toBe('connected');
  });

  it('should send REQUEST_QUEUE_STATE after connecting', () => {
    const onMessage = jest.fn();
    renderHook(() => useQueuePort(onMessage));

    expect(mockPostMessage).toHaveBeenCalledWith({ type: 'REQUEST_QUEUE_STATE' });
  });

  it('should reject sendCommand when port is null', async () => {
    mockConnect.mockImplementation(() => {
      throw new Error('connection refused');
    });

    const onMessage = jest.fn();
    const { result } = renderHook(() => useQueuePort(onMessage));

    await expect(
      result.current.sendCommand({ type: 'QUEUE_CLEAR' }),
    ).rejects.toThrow();
  });
});
