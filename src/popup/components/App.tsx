import React, { useCallback, useMemo, useRef } from 'react';
import { TTSSettings } from '../../shared/types';
import { StorageManager } from '../../shared/utils/storage';
import { BrowserAdapter } from '../../shared/utils/browser';
import ControlButtons from './ControlButtons';
import QuickControls from './QuickControls';
import StatusDisplay from './StatusDisplay';
import TabQueueList from './TabQueueList';
import useTabQueue from '../hooks/useTabQueue';
import DiagnosticsBanner from './DiagnosticsBanner';
import usePrefetchStatus from '../hooks/usePrefetchStatus';
import SummaryControl from './SummaryControl';
import { SerializedTabInfo } from '../../shared/messages';
import { usePopupBootstrap } from '../hooks/usePopupBootstrap';
import { usePopupSettingsSync } from '../hooks/usePopupSettingsSync';
import { useAddTabsActions } from '../hooks/useAddTabsActions';

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
    clearQueue,
    reorderTabs,
    skipNext,
    skipPrevious,
    control,
    updateSettings,
  } = useTabQueue();

  const {
    settings,
    setSettings,
    activeTab,
    developerMode,
    setDeveloperMode,
    aiEnabled,
    summaryWaitMode,
    setSummaryWaitMode,
    isLoading,
    initError,
  } = usePopupBootstrap();

  const [error, setError] = React.useState<string | null>(initError);

  // Keep error state in sync with initError from bootstrap
  React.useEffect(() => {
    if (initError) setError(initError);
  }, [initError]);

  // Debounce timer for settings changes (insurance layer)
  const settingsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { statuses: prefetchStatuses, diagnostics: prefetchDiagnostics } = usePrefetchStatus();

  // Sync storage changes to local state
  usePopupSettingsSync({
    onSettingsChange: setSettings,
    onDeveloperModeChange: setDeveloperMode,
  });

  // Treat 'connecting' (auto-reconnect in progress) the same as 'connected' for
  // button availability. Commands sent while the port is not yet ready will
  // surface as error toasts via sendCommand's rejection path.  Only fully
  // disable controls when the connection has been given up entirely.
  const isConnected = connectionState !== 'disconnected';
  const manifestVersion = typeof chrome !== 'undefined' && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest().version
    : undefined;
  const appVersion = manifestVersion || __APP_VERSION__;

  const { handleAddCurrentTab, handleAddAllTabs } = useAddTabsActions(addTab);

  const activeQueueTab: SerializedTabInfo | null = useMemo(() => {
    if (!queueState) return null;
    return queueState.tabs[queueState.currentIndex] ?? null;
  }, [queueState]);

  const activeProgress = useMemo(() => {
    if (!activeQueueTab) return 0;
    return progressByTab[activeQueueTab.tabId] ?? (queueState?.status === 'reading' ? 0 : 0);
  }, [activeQueueTab, progressByTab, queueState?.status]);

  const handleAddCurrentTabWithError = useCallback(async () => {
    const errMsg = await handleAddCurrentTab(activeTab);
    if (errMsg) setError(errMsg);
  }, [activeTab, handleAddCurrentTab]);

  const handleAddAllTabsWithError = useCallback(async () => {
    const msg = await handleAddAllTabs();
    if (msg) {
      setError(msg);
      // Success messages auto-clear
      if (!msg.includes('失敗')) {
        setTimeout(() => setError(null), 3000);
      }
    }
  }, [handleAddAllTabs]);

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

  const handleResetQueue = useCallback(async () => {
    try {
      await clearQueue();
      setError('キューをリセットしました');
      setTimeout(() => setError(null), 3000);
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : 'キューのリセットに失敗しました';
      setError(message);
    }
  }, [clearQueue]);

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
    [updateSettings, setSettings],
  );

  const clearError = useCallback(() => setError(null), []);

  const handlePrefetchRetry = useCallback((tabId: number) => {
    chrome.runtime?.sendMessage?.({ type: 'PREFETCH_RETRY', payload: { tabId } });
  }, []);

  const handleSummaryWaitModeChange = useCallback((mode: 'wait' | 'skip') => {
    setSummaryWaitMode(mode);
    chrome.runtime?.sendMessage?.({ type: 'SET_SUMMARY_WAIT_MODE', mode });
  }, [setSummaryWaitMode]);

  const queueStatus = queueState?.status ?? 'idle';
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

      {developerMode && (
        <DiagnosticsBanner
          connectionState={connectionState}
          lastError={queueError}
          keepAlive={prefetchDiagnostics ?? null}
        />
      )}

      {error && (
        <div className="error-message" role="alert">
          <span>{error}</span>
          <button onClick={clearError} className="error-close">×</button>
        </div>
      )}

      <div className="actions-row">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleAddCurrentTabWithError}
          disabled={!activeTab}
        >
          キューに追加
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleAddAllTabsWithError}
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

      <SummaryControl
        aiEnabled={aiEnabled}
        summaryWaitMode={summaryWaitMode}
        onModeChange={handleSummaryWaitModeChange}
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
        onClearQueue={() => {
          clearQueue().catch((commandError) => {
            const message = commandError instanceof Error ? commandError.message : 'キューのリセットに失敗しました';
            setError(message);
          });
        }}
        prefetchStatuses={prefetchStatuses}
        onRetryPrefetch={handlePrefetchRetry}
      />

      <footer className="footer">
        <small>Version {appVersion}</small>
      </footer>
    </div>
  );
}
