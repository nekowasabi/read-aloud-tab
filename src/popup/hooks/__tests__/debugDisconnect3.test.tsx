import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import useTabQueue from '../useTabQueue';

const createPort = () => ({
  name: 'queue',
  postMessage: jest.fn(),
  onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
  onDisconnect: { addListener: jest.fn(), removeListener: jest.fn() },
  disconnect: jest.fn(),
});

// Check if the issue is that connect mock isn't being used
test('debug: chrome.runtime.connect is actually called', async () => {
  const port = createPort();
  (chrome.runtime.connect as jest.Mock).mockReturnValue(port);
  
  const C = () => { useTabQueue(); return null; };
  let unmount!: () => void;
  
  act(() => { ({ unmount } = render(<C />)); });
  
  // If connect was called, onMessage.addListener should be called
  const connectCalled = (chrome.runtime.connect as jest.Mock).mock.calls.length > 0;
  const addListenerCalled = port.onMessage.addListener.mock.calls.length > 0;
  
  act(() => { unmount(); });
  
  const disconnectCalled = port.disconnect.mock.calls.length > 0;
  const removeListenerCalled = port.onMessage.removeListener.mock.calls.length > 0;
  
  // Log to stderr which is not suppressed
  process.stderr.write(`connectCalled: ${connectCalled}\n`);
  process.stderr.write(`addListenerCalled: ${addListenerCalled}\n`);
  process.stderr.write(`disconnectCalled: ${disconnectCalled}\n`);
  process.stderr.write(`removeListenerCalled: ${removeListenerCalled}\n`);
  
  expect(true).toBe(true);
});
