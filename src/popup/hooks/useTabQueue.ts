import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  QueueAddPayload,
  QueueBroadcastMessage,
  QueueCommandMessage,
  QueueProgressPayload,
  QueueStatusPayload,
  QueueTabInput,
  QueueSettingsUpdatePayload,
} from '../../shared/messages';
import { TTSSettings } from '../../shared/types';

type ControlAction = 'start' | 'pause' | 'resume' | 'stop';

interface CommandOptions {
  position?: 'start' | 'end' | number;
  autoStart?: boolean;
}

export interface UseTabQueueResult {
  state: QueueStatusPayload | null;
  isConnected: boolean;
  error: string | null;
  progressByTab: Record<number, number>;
  addTab: (tab: QueueTabInput, options?: CommandOptions) => Promise<void>;
  removeTab: (tabId: number) => Promise<void>;
  clearQueue: () => Promise<void>;
  reorderTabs: (from: number, to: number) => Promise<void>;
  skipNext: () => Promise<void>;
  skipPrevious: () => Promise<void>;
  control: (action: ControlAction) => Promise<void>;
  updateSettings: (settings: Partial<TTSSettings>) => Promise<void>;
}

const QUEUE_PORT_NAME = 'read-aloud-tab-queue';

export default function useTabQueue(): UseTabQueueResult {
  const [state, setState] = useState<QueueStatusPayload | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressByTab, setProgressByTab] = useState<Record<number, number>>({});

  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    let isMounted = true;

    try {
      console.log('[useTabQueue] Attempting to connect to background...');
      console.log('[useTabQueue] Port name:', QUEUE_PORT_NAME);

      const port = chrome.runtime.connect({ name: QUEUE_PORT_NAME });
      console.log('[useTabQueue] Port created successfully:', port);

      portRef.current = port;
      setIsConnected(true);
      console.log('[useTabQueue] Connection established');

      const handleMessage = (rawMessage: QueueBroadcastMessage | any) => {
        if (!isMounted) return;
        if (!rawMessage || typeof rawMessage.type !== 'string') {
          console.warn('[useTabQueue] Received invalid message:', rawMessage);
          return;
        }

        console.log('[useTabQueue] Received message:', rawMessage.type);

        switch (rawMessage.type) {
          case 'QUEUE_STATUS_UPDATE': {
            const payload = rawMessage.payload as QueueStatusPayload;
            console.log('[useTabQueue] Status update:', payload);
            setState(payload);
            setIsConnected(true);
            setProgressByTab((prev) => filterProgressByTabs(prev, payload));
            break;
          }
          case 'QUEUE_PROGRESS_UPDATE': {
            const payload = rawMessage.payload as QueueProgressPayload;
            console.log('[useTabQueue] Progress update:', payload);
            setProgressByTab((prev) => ({
              ...prev,
              [payload.tabId]: payload.progress,
            }));
            break;
          }
          case 'QUEUE_ERROR': {
            const payload = rawMessage.payload as { message?: string };
            console.error('[useTabQueue] Queue error:', payload);
            setError(payload?.message ?? 'キューでエラーが発生しました');
            break;
          }
          case 'QUEUE_COMMAND_RESULT': {
            const payload = rawMessage.payload as { error?: string };
            if (payload?.error) {
              console.error('[useTabQueue] Command error:', payload.error);
              setError(payload.error);
            }
            break;
          }
          default:
            console.warn('[useTabQueue] Unknown message type:', rawMessage.type);
            break;
        }
      };

      const handleDisconnect = () => {
        if (!isMounted) return;
        console.warn('[useTabQueue] Port disconnected');
        console.warn('[useTabQueue] Disconnect reason:', chrome.runtime.lastError);
        setIsConnected(false);
        setError('キューとの接続が切断されました');
      };

      port.onMessage.addListener(handleMessage);
      port.onDisconnect.addListener(handleDisconnect);

      try {
        console.log('[useTabQueue] Requesting initial queue state...');
        port.postMessage({ type: 'REQUEST_QUEUE_STATE' });
      } catch (postError) {
        console.error('[useTabQueue] Failed to request initial state:', postError);
        console.error('[useTabQueue] Post error details:', {
          name: (postError as Error)?.name,
          message: (postError as Error)?.message,
        });
      }

      return () => {
        isMounted = false;
        console.log('[useTabQueue] Cleaning up port connection...');
        try {
          port.onMessage.removeListener?.(handleMessage);
          port.onDisconnect.removeListener?.(handleDisconnect);
          port.disconnect?.();
          console.log('[useTabQueue] Port cleanup complete');
        } catch (disconnectError) {
          console.warn('[useTabQueue] Failed to cleanup port:', disconnectError);
        }
        portRef.current = null;
      };
    } catch (connectError) {
      console.error('[useTabQueue] Connection failed:', connectError);
      console.error('[useTabQueue] Error details:', {
        name: (connectError as Error)?.name,
        message: (connectError as Error)?.message,
        stack: (connectError as Error)?.stack,
      });

      const errorMsg = connectError instanceof Error
        ? `キューとの接続に失敗しました: ${connectError.message}`
        : 'キューとの接続に失敗しました';

      setError(errorMsg);
      setIsConnected(false);
    }

    return () => {
      isMounted = false;
    };
  }, []);

  const sendCommand = useCallback(
    (command: QueueCommandMessage): Promise<void> => {
      const port = portRef.current;

      if (!port) {
        const err = new Error('キューとの接続が確立されていません');
        setError(err.message);
        return Promise.reject(err);
      }

      try {
        setError(null);
        port.postMessage(command);
        return Promise.resolve();
      } catch (postError) {
        const err = postError instanceof Error ? postError : new Error('キューへの送信に失敗しました');
        setError(err.message);
        return Promise.reject(err);
      }
    },
    [],
  );

  const addTab = useCallback(
    (tab: QueueTabInput, options: CommandOptions = {}): Promise<void> => {
      const payload: QueueAddPayload = {
        tab,
        position: options.position,
        autoStart: options.autoStart,
      };
      return sendCommand({ type: 'QUEUE_ADD', payload });
    },
    [sendCommand],
  );

  const removeTab = useCallback(
    (tabId: number): Promise<void> => sendCommand({ type: 'QUEUE_REMOVE', payload: { tabId } }),
    [sendCommand],
  );

  const clearQueue = useCallback(
    (): Promise<void> => sendCommand({ type: 'QUEUE_CLEAR' }),
    [sendCommand],
  );

  const reorderTabs = useCallback(
    (fromIndex: number, toIndex: number): Promise<void> =>
      sendCommand({ type: 'QUEUE_REORDER', payload: { fromIndex, toIndex } }),
    [sendCommand],
  );

  const skipNext = useCallback(
    (): Promise<void> => sendCommand({ type: 'QUEUE_SKIP', payload: { direction: 'next' } }),
    [sendCommand],
  );

  const skipPrevious = useCallback(
    (): Promise<void> => sendCommand({ type: 'QUEUE_SKIP', payload: { direction: 'previous' } }),
    [sendCommand],
  );

  const control = useCallback(
    (action: ControlAction): Promise<void> => {
      return sendCommand({ type: 'QUEUE_CONTROL', payload: { action } });
    },
    [sendCommand],
  );

  const updateSettings = useCallback(
    (settings: Partial<TTSSettings>): Promise<void> => {
      const payload: QueueSettingsUpdatePayload = { settings };
      return sendCommand({ type: 'QUEUE_UPDATE_SETTINGS', payload });
    },
    [sendCommand],
  );

  const memoizedProgress = useMemo(() => progressByTab, [progressByTab]);

  return {
    state,
    isConnected,
    error,
    progressByTab: memoizedProgress,
    addTab,
    removeTab,
    clearQueue,
    reorderTabs,
    skipNext,
    skipPrevious,
    control,
    updateSettings,
  };
}

function filterProgressByTabs(
  progress: Record<number, number>,
  payload: QueueStatusPayload,
): Record<number, number> {
  const allowedIds = new Set(payload.tabs.map((tab) => tab.tabId));
  const next: Record<number, number> = {};
  for (const [tabIdStr, value] of Object.entries(progress)) {
    const tabId = Number(tabIdStr);
    if (allowedIds.has(tabId)) {
      next[tabId] = value;
    }
  }
  return next;
}
