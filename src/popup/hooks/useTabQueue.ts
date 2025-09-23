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
      const port = chrome.runtime.connect({ name: QUEUE_PORT_NAME });
      portRef.current = port;
      setIsConnected(true);

      const handleMessage = (rawMessage: QueueBroadcastMessage | any) => {
        if (!isMounted) return;
        if (!rawMessage || typeof rawMessage.type !== 'string') {
          return;
        }

        switch (rawMessage.type) {
          case 'QUEUE_STATUS_UPDATE': {
            const payload = rawMessage.payload as QueueStatusPayload;
            setState(payload);
            setIsConnected(true);
            setProgressByTab((prev) => filterProgressByTabs(prev, payload));
            break;
          }
          case 'QUEUE_PROGRESS_UPDATE': {
            const payload = rawMessage.payload as QueueProgressPayload;
            setProgressByTab((prev) => ({
              ...prev,
              [payload.tabId]: payload.progress,
            }));
            break;
          }
          case 'QUEUE_ERROR': {
            const payload = rawMessage.payload as { message?: string };
            setError(payload?.message ?? 'キューでエラーが発生しました');
            break;
          }
          case 'QUEUE_COMMAND_RESULT': {
            const payload = rawMessage.payload as { error?: string };
            if (payload?.error) {
              setError(payload.error);
            }
            break;
          }
          default:
            break;
        }
      };

      const handleDisconnect = () => {
        if (!isMounted) return;
        setIsConnected(false);
        setError('キューとの接続が切断されました');
      };

      port.onMessage.addListener(handleMessage);
      port.onDisconnect.addListener(handleDisconnect);

      try {
        port.postMessage({ type: 'REQUEST_QUEUE_STATE' });
      } catch (postError) {
        console.warn('useTabQueue: failed to request initial state', postError);
      }

      return () => {
        isMounted = false;
        try {
          port.onMessage.removeListener?.(handleMessage);
          port.onDisconnect.removeListener?.(handleDisconnect);
          port.disconnect?.();
        } catch (disconnectError) {
          console.warn('useTabQueue: failed to cleanup port', disconnectError);
        }
        portRef.current = null;
      };
    } catch (connectError) {
      console.error('useTabQueue: failed to connect to runtime port', connectError);
      setError('キューとの接続に失敗しました');
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
    (action: ControlAction): Promise<void> => sendCommand({ type: 'QUEUE_CONTROL', payload: { action } }),
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
