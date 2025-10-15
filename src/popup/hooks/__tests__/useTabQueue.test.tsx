import React, { useEffect } from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import useTabQueue from '../useTabQueue';
import { QueueStatusPayload } from '../../../shared/messages';

type MessageListener = (message: any) => void;

const createPort = () => {
  const listeners: MessageListener[] = [];
  const port = {
    name: 'queue',
    postMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn((listener: MessageListener) => {
        listeners.push(listener);
      }),
      removeListener: jest.fn(),
    },
    onDisconnect: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    disconnect: jest.fn(),
  };

  return { port, listeners };
};

describe('useTabQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('runtimeポート接続からのステータス更新を状態に反映する', async () => {
    const { port, listeners } = createPort();
    (chrome.runtime.connect as jest.Mock).mockReturnValue(port);

    const TestComponent = () => {
      const { state } = useTabQueue();
      return <div>{state ? state.status : 'empty'}</div>;
    };

    render(<TestComponent />);

    const payload: QueueStatusPayload = {
      status: 'reading',
      currentIndex: 0,
      totalCount: 1,
      activeTabId: 10,
      tabs: [],
      settings: { rate: 1, pitch: 1, volume: 1, voice: null },
      updatedAt: Date.now(),
    };

    await act(async () => {
      listeners.forEach((listener) =>
        listener({ type: 'QUEUE_STATUS_UPDATE', payload }),
      );
    });

    expect(screen.getByText('reading')).toBeInTheDocument();
  });

  test('command関数がポートにメッセージを送信する', () => {
    const { port } = createPort();
    (chrome.runtime.connect as jest.Mock).mockReturnValue(port);

    const TestComponent = () => {
      const { removeTab, clearQueue } = useTabQueue();
      return (
        <>
          <button onClick={() => removeTab(42)}>remove</button>
          <button onClick={() => clearQueue()}>clear</button>
        </>
      );
    };

    render(<TestComponent />);

    fireEvent.click(screen.getByText('remove'));
    fireEvent.click(screen.getByText('clear'));

    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'QUEUE_REMOVE',
      payload: { tabId: 42 },
    });
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'QUEUE_CLEAR',
    });
  });
});
