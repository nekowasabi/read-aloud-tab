import React, { useEffect } from 'react';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
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

  test('ポート切断時に再接続を試行し connectionState を更新する', () => {
    jest.useFakeTimers();
    const first = createPort();
    const second = createPort();
    (chrome.runtime.connect as jest.Mock)
      .mockReturnValueOnce(first.port)
      .mockReturnValueOnce(second.port);

    const TestComponent = () => {
      const { connectionState } = useTabQueue();
      return <div data-testid="state">{connectionState}</div>;
    };

    render(<TestComponent />);

    expect(screen.getByTestId('state').textContent).toBe('connected');

    const disconnectHandler = first.port.onDisconnect.addListener.mock.calls[0][0];
    act(() => {
      disconnectHandler();
    });

    expect(screen.getByTestId('state').textContent).toBe('connecting');

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('state').textContent).toBe('connected');
    jest.useRealTimers();
  });

  test('古いポートの切断イベントでは再接続を再実行しない', () => {
    jest.useFakeTimers();
    const first = createPort();
    const second = createPort();
    const third = createPort();
    (chrome.runtime.connect as jest.Mock)
      .mockReturnValueOnce(first.port)
      .mockReturnValueOnce(second.port)
      .mockReturnValueOnce(third.port);

    const TestComponent = () => {
      const { connectionState } = useTabQueue();
      return <div data-testid="state">{connectionState}</div>;
    };

    const { unmount } = render(<TestComponent />);

    const firstDisconnectHandler = first.port.onDisconnect.addListener.mock.calls[0][0];
    act(() => {
      firstDisconnectHandler();
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('state').textContent).toBe('connected');

    // 既に置き換わった古いポートの切断通知が再度来ても再接続しないこと
    act(() => {
      firstDisconnectHandler();
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
    // 次テストへの残留を防ぐため明示的にアンマウント
    act(() => { unmount(); });
    jest.useRealTimers();
  });

  describe('Process 100 Red prep', () => {
    beforeEach(() => {
      // 前テストの fake timer 残留・レンダリング残留をリセット
      jest.useRealTimers();
      cleanup();
    });

    it('アンマウント後はポート切断イベントが来ても再接続を行わない', () => {
      jest.useFakeTimers();
      const { port } = createPort();
      (chrome.runtime.connect as jest.Mock).mockReturnValue(port);
      const TestComponent = () => {
        useTabQueue();
        return null;
      };
      const { unmount } = render(<TestComponent />);
      // アンマウント前に切断ハンドラを取得（cleanup順序の観点）
      const disconnectHandler = port.onDisconnect.addListener.mock.calls[0]?.[0];
      act(() => { unmount(); });
      if (disconnectHandler) {
        // アンマウント後の切断通知で再接続が起きないこと
        act(() => { disconnectHandler(); });
        act(() => { jest.advanceTimersByTime(1000); });
      }
      // connect は初回マウント時の1回のみ（再接続なし）
      expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('useQueuePort 抽出後も onMessage と onDisconnect 双方にリスナーが登録される', () => {
      const { port } = createPort();
      (chrome.runtime.connect as jest.Mock).mockReturnValue(port);
      const TestComponent = () => {
        useTabQueue();
        return null;
      };
      render(<TestComponent />);
      expect(port.onMessage.addListener).toHaveBeenCalled();
      expect(port.onDisconnect.addListener).toHaveBeenCalled();
    });
  });
});
