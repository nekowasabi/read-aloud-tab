import React from 'react';
import { render, act } from '@testing-library/react';
import useTabQueue from '../useTabQueue';

type MessageListener = (message: any) => void;

// Exact replica of createPort from useTabQueue.test.tsx
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

  describe('Process 100 Red prep', () => {
    it('コンポーネントアンマウント時に port.disconnect が呼ばれる', () => {
      const { port } = createPort();
      (chrome.runtime.connect as jest.Mock).mockReturnValue(port);
      const TestComponent = () => {
        useTabQueue();
        return null;
      };
      let unmount!: () => void;
      act(() => {
        ({ unmount } = render(<TestComponent />));
      });
      act(() => {
        unmount();
      });

      process.stderr.write(`disconnect calls: ${port.disconnect.mock.calls.length}\n`);
      process.stderr.write(`connect calls: ${(chrome.runtime.connect as jest.Mock).mock.calls.length}\n`);

      expect(port.disconnect).toHaveBeenCalled();
    });
  });
});
