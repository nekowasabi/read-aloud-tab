/**
 * lifecycleSupervisor.ts
 * Extracted from service.ts (Process 50)
 *
 * Manages registration and cleanup of all runtime event listeners
 * (runtime messages, port connections, keyboard shortcuts, alarms,
 * storage changes, and TabManager event subscriptions).
 */
import { StorageManager } from '../shared/utils/storage';
import { LoggerLike } from './tabManager';
import {
  QueueStatusPayload,
  QueueProgressPayload,
  QueueErrorPayload,
  QueueBroadcastMessage,
} from '../shared/messages';

// ---- minimal interface shapes for the APIs we need ----

export interface RuntimeLike {
  onMessage: { addListener: (listener: (...args: any[]) => any) => void };
  onConnect: { addListener: (listener: (port: any) => void) => void };
}

export interface CommandsLike {
  onCommand: { addListener: (listener: (command: string) => void) => void };
}

export interface AlarmsLike {
  onAlarm: {
    addListener: (listener: (alarm: { name: string }) => void) => void;
    removeListener?: (listener: (alarm: { name: string }) => void) => void;
  };
}

export interface StorageLike {
  onChanged: {
    addListener: (
      listener: (changes: Record<string, any>, area: string) => void,
    ) => void;
    removeListener: (
      listener: (changes: Record<string, any>, area: string) => void,
    ) => void;
  };
}

export interface TabManagerSubscribable {
  addStatusListener: (listener: (payload: QueueStatusPayload) => void) => () => void;
  addProgressListener: (listener: (payload: QueueProgressPayload) => void) => () => void;
  addErrorListener: (listener: (payload: QueueErrorPayload) => void) => () => void;
  addCommandListener: (listener: (event: QueueBroadcastMessage) => void) => () => void;
}

export interface LifecycleSupervisorDeps {
  logger: LoggerLike;
  runtime: RuntimeLike;
  commands?: CommandsLike | null;
  alarms?: AlarmsLike | null;
  storage?: StorageLike | null;
  tabManager: TabManagerSubscribable;
  onRuntimeMessage: (...args: any[]) => any;
  onRuntimeConnect: (port: any) => void;
  onStatusUpdate: (payload: QueueStatusPayload) => void;
  onProgressUpdate: (payload: QueueProgressPayload) => void;
  onError: (payload: QueueErrorPayload) => void;
  onCommandEvent: (event: QueueBroadcastMessage) => void;
  onAlarm?: (alarm: { name: string }) => void;
  onShortcutCommand: (command: string) => void;
  onDeveloperModeChanged?: () => void;
}

/**
 * LifecycleSupervisor registers and tears down all event listeners
 * for the background orchestrator. Call registerAll() once during
 * initialization, and dispose() on shutdown.
 */
export class LifecycleSupervisor {
  private readonly deps: LifecycleSupervisorDeps;
  private readonly logger: LoggerLike;
  private unsubscribeFns: Array<() => void> = [];
  private _developerMode = false;

  constructor(deps: LifecycleSupervisorDeps) {
    this.deps = deps;
    this.logger = deps.logger;
  }

  get developerMode(): boolean {
    return this._developerMode;
  }

  /**
   * Register all event listeners. Should be called once during initialize().
   */
  registerAll(): void {
    this.registerTabManagerListeners();
    this.registerRuntimeListeners();
    this.registerCommandListeners();
    this.registerKeepAliveListeners();
    this.registerDeveloperModeListener();
  }

  /**
   * Clean up all registered listeners.
   */
  dispose(): void {
    for (const fn of this.unsubscribeFns) {
      try {
        fn();
      } catch (error) {
        this.logger.warn('[LifecycleSupervisor] Error during unsubscribe', error);
      }
    }
    this.unsubscribeFns = [];
  }

  /**
   * Load and cache the developer mode flag from storage.
   */
  async refreshDeveloperMode(): Promise<void> {
    try {
      this._developerMode = await StorageManager.getDeveloperMode();
    } catch (error) {
      this._developerMode = false;
      this.logger.warn('[LifecycleSupervisor] Failed to load developer mode flag', error);
    }
  }

  // ---- private registration methods ----

  private registerTabManagerListeners(): void {
    this.unsubscribeFns.push(
      this.deps.tabManager.addStatusListener(this.deps.onStatusUpdate),
    );
    this.unsubscribeFns.push(
      this.deps.tabManager.addProgressListener(this.deps.onProgressUpdate),
    );
    this.unsubscribeFns.push(
      this.deps.tabManager.addErrorListener(this.deps.onError),
    );
    this.unsubscribeFns.push(
      this.deps.tabManager.addCommandListener(this.deps.onCommandEvent),
    );
  }

  private registerRuntimeListeners(): void {
    this.deps.runtime.onMessage.addListener(this.deps.onRuntimeMessage);
    this.deps.runtime.onConnect.addListener(this.deps.onRuntimeConnect);
  }

  private registerCommandListeners(): void {
    if (!this.deps.commands?.onCommand) {
      return;
    }
    this.deps.commands.onCommand.addListener((command: string) => {
      try {
        this.deps.onShortcutCommand(command);
      } catch (error) {
        this.logger.error('[LifecycleSupervisor] Shortcut command failed', error);
      }
    });
  }

  private registerKeepAliveListeners(): void {
    if (!this.deps.alarms?.onAlarm?.addListener || !this.deps.onAlarm) {
      return;
    }
    const handler = this.deps.onAlarm;
    this.deps.alarms.onAlarm.addListener(handler);
    this.unsubscribeFns.push(() => {
      this.deps.alarms?.onAlarm?.removeListener?.(handler);
    });
  }

  private registerDeveloperModeListener(): void {
    if (!this.deps.storage) {
      return;
    }
    const listener = (changes: Record<string, any>, area: string) => {
      if (area !== 'sync') {
        return;
      }
      this.refreshDeveloperMode().catch((error) => {
        this.logger.warn('[LifecycleSupervisor] Failed to refresh developer mode', error);
      });
      this.deps.onDeveloperModeChanged?.();
    };
    this.deps.storage.onChanged.addListener(listener);
    this.unsubscribeFns.push(() => {
      this.deps.storage?.onChanged.removeListener(listener);
    });
  }
}
