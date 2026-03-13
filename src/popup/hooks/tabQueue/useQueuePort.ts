/**
 * useQueuePort.ts
 * Extracted from useTabQueue.ts (Process 100)
 *
 * Manages the chrome.runtime.Port connection to the background queue,
 * including automatic reconnection with exponential back-off.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { QueueCommandMessage } from '../../../shared/messages';
import { TabQueueConnectionState } from '../useTabQueue';

const QUEUE_PORT_NAME = 'read-aloud-tab-queue';

export interface UseQueuePortResult {
  sendCommand: (command: QueueCommandMessage) => Promise<void>;
  connectionState: TabQueueConnectionState;
  lastError: string | null;
}

export function useQueuePort(
  onMessage: (rawMessage: any) => void,
): UseQueuePortResult {
  const [connectionState, setConnectionState] = useState<TabQueueConnectionState>('connecting');
  const [lastError, setLastError] = useState<string | null>(null);

  const portRef = useRef<chrome.runtime.Port | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const isUnmountedRef = useRef(false);

  useEffect(() => {
    isUnmountedRef.current = false;

    const clearRetryTimer = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (isUnmountedRef.current) return;
      setConnectionState('connecting');
      clearRetryTimer();
      const delay = Math.min(500 * 2 ** retryAttemptRef.current, 5000);
      retryAttemptRef.current += 1;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (isUnmountedRef.current) return;

      try {
        const port = chrome.runtime.connect({ name: QUEUE_PORT_NAME });
        portRef.current = port;
        retryAttemptRef.current = 0;
        setConnectionState('connected');
        setLastError(null);
        clearRetryTimer();

        const handleDisconnect = () => {
          if (isUnmountedRef.current) return;
          if (portRef.current !== port) return;
          portRef.current = null;
          setLastError(chrome.runtime.lastError?.message ?? 'キューとの接続が切断されました');
          scheduleReconnect();
        };

        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(handleDisconnect);

        try {
          port.postMessage({ type: 'REQUEST_QUEUE_STATE' });
        } catch (postError) {
          setLastError((postError as Error)?.message ?? '初期状態の取得に失敗しました');
        }
      } catch (connectError) {
        const errorMsg =
          connectError instanceof Error
            ? `キューとの接続に失敗しました: ${connectError.message}`
            : 'キューとの接続に失敗しました';
        setLastError(errorMsg);
        setConnectionState('disconnected');
        scheduleReconnect();
      }
    };

    connect();

    return () => {
      isUnmountedRef.current = true;
      clearRetryTimer();
      const port = portRef.current;
      if (port) {
        try {
          port.onMessage.removeListener(onMessage);
          port.disconnect?.();
        } catch (disconnectError) {
          console.warn('[useQueuePort] Failed to cleanup port:', disconnectError);
        }
      }
      portRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendCommand = useCallback(
    (command: QueueCommandMessage): Promise<void> => {
      const port = portRef.current;
      if (!port) {
        const err = new Error('キューとの接続が確立されていません');
        setLastError(err.message);
        setConnectionState('disconnected');
        return Promise.reject(err);
      }
      try {
        setLastError(null);
        port.postMessage(command);
        return Promise.resolve();
      } catch (postError) {
        const err =
          postError instanceof Error ? postError : new Error('キューへの送信に失敗しました');
        setLastError(err.message);
        setConnectionState('disconnected');
        return Promise.reject(err);
      }
    },
    [],
  );

  return { sendCommand, connectionState, lastError };
}
