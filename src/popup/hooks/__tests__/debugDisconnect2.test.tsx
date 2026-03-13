import React from 'react';
import { render, act } from '@testing-library/react';
import useTabQueue from '../useTabQueue';

type MessageListener = (message: any) => void;

const createPort = () => {
  const port = {
    name: 'queue',
    postMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn((l: MessageListener) => {}),
      removeListener: jest.fn(),
    },
    onDisconnect: { addListener: jest.fn(), removeListener: jest.fn() },
    disconnect: jest.fn(),
  };
  return port;
};

test('useTabQueue: connect called and portRef set?', () => {
  const port = createPort();
  (chrome.runtime.connect as jest.Mock).mockReturnValue(port);
  const C = () => { useTabQueue(); return null; };
  let unmount!: () => void;
  act(() => { ({ unmount } = render(<C />)); });
  console.log('connect calls:', (chrome.runtime.connect as jest.Mock).mock.calls.length);
  console.log('onMessage.addListener calls:', port.onMessage.addListener.mock.calls.length);
  console.log('postMessage calls:', port.postMessage.mock.calls.length);
  act(() => { unmount(); });
  console.log('disconnect calls after unmount:', port.disconnect.mock.calls.length);
  console.log('removeListener calls after unmount:', port.onMessage.removeListener.mock.calls.length);
});
