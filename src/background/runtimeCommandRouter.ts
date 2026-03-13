import {
  QueueAddPayload,
  QueueCommandMessage,
  QueueControlAction,
  SetSummaryWaitModeMessage,
} from '../shared/messages';
import { StorageManager } from '../shared/utils/storage';

export interface RuntimeCommandResult {
  success: boolean;
  payload?: unknown;
  error?: string;
}

interface RuntimeCommandRouterTabManager {
  removeTab: (tabId: number) => Promise<void>;
  reorderTabs: (fromIndex: number, toIndex: number) => Promise<void>;
  skipTab: (direction: 'next' | 'previous') => Promise<void>;
  clearQueue: () => Promise<void>;
  getSnapshot: () => unknown;
}

interface RuntimeCommandRouterDeps {
  tabManager: RuntimeCommandRouterTabManager;
  handleAddCommand: (payload: QueueAddPayload) => Promise<void>;
  handleControlCommand: (action: QueueControlAction) => Promise<void>;
  handleUpdateSettings: (settings: unknown) => Promise<void>;
  prefetcher?: {
    cancelWait: (tabId: number) => void;
  } | null;
}

export function createRuntimeCommandRouter(deps: RuntimeCommandRouterDeps) {
  return async function routeRuntimeCommand(message: QueueCommandMessage): Promise<RuntimeCommandResult> {
    switch (message.type) {
      case 'QUEUE_ADD':
        await deps.handleAddCommand(message.payload);
        return { success: true };
      case 'QUEUE_REMOVE':
        await deps.tabManager.removeTab(message.payload.tabId);
        return { success: true };
      case 'QUEUE_REORDER':
        await deps.tabManager.reorderTabs(message.payload.fromIndex, message.payload.toIndex);
        return { success: true };
      case 'QUEUE_SKIP':
        await deps.tabManager.skipTab(message.payload.direction);
        return { success: true };
      case 'QUEUE_CONTROL':
        await deps.handleControlCommand(message.payload.action);
        return { success: true };
      case 'QUEUE_UPDATE_SETTINGS':
        await deps.handleUpdateSettings(message.payload.settings);
        return { success: true };
      case 'QUEUE_CLEAR':
        await deps.tabManager.clearQueue();
        return { success: true };
      case 'REQUEST_QUEUE_STATE':
        return { success: true, payload: deps.tabManager.getSnapshot() };
      case 'SET_SUMMARY_WAIT_MODE': {
        const { mode } = message as SetSummaryWaitModeMessage;
        const currentSettings = await StorageManager.getAiSettings();
        await StorageManager.saveAiSettings({ ...currentSettings, summaryWaitMode: mode });
        return { success: true };
      }
      case 'SKIP_SUMMARY_WAIT':
        deps.prefetcher?.cancelWait(message.tabId);
        return { success: true };
      default:
        return { success: false, error: 'Unknown command' };
    }
  };
}
