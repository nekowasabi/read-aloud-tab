import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { TTSSettings, QueueStatus, STORAGE_KEYS } from '../../shared/types';
import { StorageManager, getIgnoredDomains } from '../../shared/utils/storage';
import { BrowserAdapter } from '../../shared/utils/browser';
import ControlButtons from './ControlButtons';
import QuickControls from './QuickControls';
import StatusDisplay from './StatusDisplay';
import TabQueueList from './TabQueueList';
import useTabQueue from '../hooks/useTabQueue';
import DiagnosticsBanner from './DiagnosticsBanner';
import usePrefetchStatus from '../hooks/usePrefetchStatus';
import { SerializedTabInfo } from '../../shared/messages';

const DEFAULT_SETTINGS: TTSSettings = {
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  voice: null,
};

// Additional debounce for settings changes (insurance layer)
const SETTINGS_DEBOUNCE_MS = 300;

export default function App() {
  const {
    state: queueState,
    connectionState,
    lastError: queueError,
    progressByTab,
    addTab,
    removeTab,
    reorderTabs,
    skipNext,
    skipPrevious,
    control,
    updateSettings,
  } = useTabQueue();

  const [settings, setSettings] = useState<TTSSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [developerMode, setDeveloperMode] = useState(false);

  // Debounce timer for settings changes (insurance layer)
  const settingsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { statuses: prefetchStatuses, diagnostics: prefetchDiagnostics } = usePrefetchStatus();
  const isConnected = connectionState === 'connected';

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        console.log('[Popup Init] Starting initialization...');

        console.log('[Popup Init] Querying active tab...');
        const browserAPI = BrowserAdapter.getInstance();
        const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
        console.log('[Popup Init] Active tab query result:', tabs);

        if (mounted && tabs[0]) {
          setActiveTab(tabs[0]);
          console.log('[Popup Init] Active tab set:', tabs[0].id, tabs[0].url);
        } else {
          console.warn('[Popup Init] No active tab found');
        }

        console.log('[Popup Init] Loading settings...');
        const [savedSettings, devMode] = await Promise.all([
          StorageManager.getSettings(),
          StorageManager.getDeveloperMode(),
        ]);
        console.log('[Popup Init] Settings loaded:', savedSettings);

        if (mounted) {
          setSettings(savedSettings);
          setDeveloperMode(devMode);
        }

        console.log('[Popup Init] Initialization successful');
      } catch (initError) {
        console.error('[Popup Init] Initialization failed:', initError);
        console.error('[Popup Init] Error name:', (initError as Error)?.name);
        console.error('[Popup Init] Error message:', (initError as Error)?.message);
        console.error('[Popup Init] Error stack:', (initError as Error)?.stack);

        if (mounted) {
          const errorMsg = initError instanceof Error
            ? `初期化に失敗しました: ${initError.message}`
            : '初期化に失敗しました';
          setError(errorMsg);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Listen for settings changes from options page
  useEffect(() => {
    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'sync') {
        if (changes.tts_settings?.newValue) {
          console.log('[Popup] Settings changed externally:', changes.tts_settings.newValue);
          setSettings(changes.tts_settings.newValue);
        }
        if (changes[STORAGE_KEYS.DEVELOPER_MODE]) {
          setDeveloperMode(Boolean(changes[STORAGE_KEYS.DEVELOPER_MODE].newValue));
        }
      }

    };

    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    } else if (typeof browser !== 'undefined' && browser.storage) {
      browser.storage.onChanged.addListener(handleStorageChange);
      return () => {
        browser.storage.onChanged.removeListener(handleStorageChange);
      };
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (queueError) {
      setError(queueError);
    }
  }, [queueError]);

  const activeQueueTab: SerializedTabInfo | null = useMemo(() => {
    if (!queueState) return null;
    return queueState.tabs[queueState.currentIndex] ?? null;
  }, [queueState]);

  const activeProgress = useMemo(() => {
    if (!activeQueueTab) return 0;
    return progressByTab[activeQueueTab.tabId] ?? (queueState?.status === 'reading' ? 0 : 0);
  }, [activeQueueTab, progressByTab, queueState?.status]);

  const handleAddCurrentTab = useCallback(async () => {
    if (!activeTab || typeof activeTab.id !== 'number' || !activeTab.url) {
      setError('追加できるタブが見つかりません');
      return;
    }

    try {
      await addTab({
        tabId: activeTab.id,
        url: activeTab.url,
        title: activeTab.title || activeTab.url,
      });
    } catch (commandError) {
      console.error('Failed to add tab to queue:', commandError);
      const message = commandError instanceof Error ? commandError.message : 'キューへの追加に失敗しました';
      setError(message);
    }
  }, [activeTab, addTab]);

  const handleAddAllTabs = useCallback(async () => {
    try {
      const browserAPI = BrowserAdapter.getInstance();
      const tabs = await browserAPI.tabs.query({ currentWindow: true });

      // Get ignored domains
      const ignoredDomains = await getIgnoredDomains();
      const ignoredSet = new Set(ignoredDomains.map(d => d.toLowerCase()));

      // Filter out invalid tabs (chrome://, chrome-extension://, about:) and ignored domains
      const validTabs = tabs.filter((tab) => {
        if (!tab.id || !tab.url) return false;

        // Filter invalid URLs
        if (
          tab.url.startsWith('chrome://') ||
          tab.url.startsWith('chrome-extension://') ||
          tab.url.startsWith('about:')
        ) {
          return false;
        }

        // Filter ignored domains
        try {
          const url = new URL(tab.url);
          const hostname = url.hostname.toLowerCase();
          if (ignoredSet.has(hostname)) {
            return false;
          }
        } catch (error) {
          console.error('Failed to parse URL:', tab.url, error);
          return false;
        }

        return true;
      });

      if (validTabs.length === 0) {
        setError('追加できるタブがありません');
        return;
      }

      let successCount = 0;
      for (const tab of validTabs) {
        try {
          await addTab({
            tabId: tab.id!,
            url: tab.url!,
            title: tab.title || tab.url!,
          });
          successCount++;
        } catch (tabError) {
          console.error('Failed to add tab:', tab.id, tabError);
        }
      }

      if (successCount > 0) {
        setError(`${successCount}個のタブをキューに追加しました`);
        setTimeout(() => setError(null), 3000);
      } else {
        setError('タブの追加に失敗しました');
      }
    } catch (commandError) {
      console.error('Failed to add all tabs:', commandError);
      const message = commandError instanceof Error ? commandError.message : 'すべてのタブの追加に失敗しました';
      setError(message);
    }
  }, [addTab]);

  const handleRemoveTab = useCallback(
    async (tabId: number) => {
      try {
        await removeTab(tabId);
      } catch (commandError) {
        const message = commandError instanceof Error ? commandError.message : 'キューからの削除に失敗しました';
        setError(message);
      }
    },
    [removeTab],
  );

  const handleReorder = useCallback(
    async (from: number, to: number) => {
      try {
        await reorderTabs(from, to);
      } catch (commandError) {
        const message = commandError instanceof Error ? commandError.message : 'キューの並び替えに失敗しました';
        setError(message);
      }
    },
    [reorderTabs],
  );

  const handleControl = useCallback(
    async (action: 'start' | 'pause' | 'resume' | 'stop') => {
      try {
        await control(action);
      } catch (commandError) {
        const message = commandError instanceof Error ? commandError.message : '操作に失敗しました';
        setError(message);
      }
    },
    [control],
  );

  const handleSettingsChange = useCallback(
    async (newSettings: TTSSettings) => {
      try {
        const validated = StorageManager.validateSettings(newSettings);
        // Update local state immediately for UI feedback
        setSettings(validated);

        // Clear existing timer
        if (settingsTimerRef.current) {
          clearTimeout(settingsTimerRef.current);
        }

        // Debounce actual save and background update (insurance layer)
        settingsTimerRef.current = setTimeout(async () => {
          try {
            await StorageManager.saveSettings(validated);
            await updateSettings(validated);
          } catch (saveError) {
            console.error('Failed to save settings:', saveError);
            const message = saveError instanceof Error ? saveError.message : '設定の保存に失敗しました';
            setError(message);
          }
        }, SETTINGS_DEBOUNCE_MS);
      } catch (validationError) {
        console.error('Failed to validate settings:', validationError);
        const message = validationError instanceof Error ? validationError.message : '設定の検証に失敗しました';
        setError(message);
      }
    },
    [updateSettings],
  );

  const clearError = useCallback(() => setError(null), []);

  const handlePrefetchRetry = useCallback((tabId: number) => {
    chrome.runtime?.sendMessage?.({ type: 'PREFETCH_RETRY', payload: { tabId } });
  }, []);

  const queueStatus: QueueStatus = queueState?.status ?? 'idle';
  const queueTabs = queueState?.tabs ?? [];
  const queueIndex = queueState?.currentIndex ?? 0;

  const handleToggle = useCallback(
    async () => {
      try {
        if (queueStatus === 'reading') {
          await control('pause');
        } else if (queueStatus === 'paused') {
          await control('resume');
        } else {
          await control('start');
        }
      } catch (commandError) {
        const message = commandError instanceof Error ? commandError.message : '操作に失敗しました';
        setError(message);
      }
    },
    [queueStatus, control],
  );

  if (isLoading) {
    return (
      <div className="popup-container">
        <div className="loading">
          <div className="spinner"></div>
          <p>読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="popup-container">
      <header className="header">
        <h1>Read Aloud Tab</h1>
        <button
          className="settings-toggle"
          onClick={() => {
            BrowserAdapter.getInstance().runtime.openOptionsPage().catch((err) => {
              console.error('Failed to open options page:', err);
              setError('設定画面を開けませんでした');
            });
          }}
          title="設定"
        >
          ⚙️
        </button>
      </header>

      {error && (
        <div className="error-message" role="alert">
          <span>{error}</span>
          <button onClick={clearError} className="error-close">×</button>
        </div>
      )}

      {developerMode && (
        <DiagnosticsBanner
          connectionState={connectionState}
          lastError={queueError}
          keepAlive={prefetchDiagnostics ?? null}
        />
      )}

      <div className="actions-row">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleAddCurrentTab}
          disabled={!activeTab}
        >
          キューに追加
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleAddAllTabs}
        >
          すべてのタブを追加
        </button>
      </div>

      <StatusDisplay
        activeTab={activeQueueTab}
        fallbackTab={activeTab}
        status={queueStatus}
        progress={activeProgress}
        connectionState={connectionState}
      />

      <QuickControls
        settings={settings}
        onChange={handleSettingsChange}
      />

      <ControlButtons
        isReading={queueStatus === 'reading' || queueStatus === 'paused'}
        isPaused={queueStatus === 'paused'}
        onToggle={handleToggle}
        onStop={() => handleControl('stop')}
        disabled={!isConnected}
      />

      <TabQueueList
        tabs={queueTabs}
        currentIndex={queueIndex}
        status={queueStatus}
        onRemoveTab={handleRemoveTab}
        onReorder={handleReorder}
        onSkipNext={() => {
          skipNext().catch((commandError) => {
            const message = commandError instanceof Error ? commandError.message : '次のタブへの移動に失敗しました';
            setError(message);
          });
        }}
        onSkipPrevious={() => {
          skipPrevious().catch((commandError) => {
            const message = commandError instanceof Error ? commandError.message : '前のタブへの移動に失敗しました';
            setError(message);
          });
        }}
        prefetchStatuses={prefetchStatuses}
        onRetryPrefetch={handlePrefetchRetry}
      />

      <footer className="footer">
        <small>Version 1.0.0</small>
      </footer>
    </div>
  );
}
