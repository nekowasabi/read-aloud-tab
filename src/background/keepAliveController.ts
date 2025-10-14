import { LoggerLike } from './tabManager';

type AlarmCreateInfo = {
  delayInMinutes?: number;
  periodInMinutes?: number;
};

type AlarmApi = {
  create: (name: string, info: AlarmCreateInfo) => Promise<void> | void;
  clear: (name: string) => Promise<boolean> | boolean;
};

export type RuntimePort = {
  postMessage?: (message: unknown) => void;
  disconnect?: () => void;
};

type RuntimeApi = {
  sendMessage?: (message: unknown) => Promise<unknown>;
  connect?: (options: { name: string }) => RuntimePort | undefined;
};

export type KeepAliveConfig = {
  alarmName: string;
  periodInMinutes: number;
  fallbackPingIntervalMs: number;
  maxMissCount: number;
};

export type KeepAliveEvent =
  | { type: 'heartbeat-started'; queueId: string; timestamp: number }
  | { type: 'heartbeat-stopped'; queueId: string; timestamp: number }
  | { type: 'alarm-fired'; alarmName: string; timestamp: number }
  | { type: 'fallback-triggered'; alarmName: string; timestamp: number };

type KeepAliveControllerOptions = {
  alarms: AlarmApi;
  runtime: RuntimeApi;
  logger: LoggerLike;
  onKeepAlive: () => Promise<void> | void;
  config: KeepAliveConfig;
  onEvent?: (event: KeepAliveEvent) => void;
};

export class KeepAliveController {
  private readonly alarms: AlarmApi;
  private readonly runtime: RuntimeApi;
  private readonly logger: LoggerLike;
  private readonly onKeepAlive: () => Promise<void> | void;
  private readonly config: KeepAliveConfig;
  private readonly onEvent?: (event: KeepAliveEvent) => void;

  private isActive = false;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private lastAlarmAt = Date.now();

  constructor(options: KeepAliveControllerOptions) {
    this.alarms = options.alarms;
    this.runtime = options.runtime;
    this.logger = options.logger;
    this.onKeepAlive = options.onKeepAlive;
    this.config = options.config;
    this.onEvent = options.onEvent;
  }

  async startHeartbeat(queueId: string): Promise<void> {
    if (this.isActive) {
      this.logger.debug?.('[KeepAliveController] Heartbeat already active', { queueId });
      return;
    }

    await Promise.resolve(this.alarms.create(this.config.alarmName, {
      delayInMinutes: this.config.periodInMinutes,
      periodInMinutes: this.config.periodInMinutes,
    }));

    this.isActive = true;
    this.lastAlarmAt = Date.now();
    this.logger.info?.('[KeepAliveController] Heartbeat started', { queueId });
    this.emitEvent({ type: 'heartbeat-started', queueId, timestamp: this.lastAlarmAt });
    this.scheduleFallbackMonitor();
  }

  async stopHeartbeat(queueId: string): Promise<void> {
    if (!this.isActive) {
      return;
    }

    await Promise.resolve(this.alarms.clear(this.config.alarmName));
    this.isActive = false;
    this.clearFallbackMonitor();
    this.logger.info?.('[KeepAliveController] Heartbeat stopped', { queueId });
    this.emitEvent({ type: 'heartbeat-stopped', queueId, timestamp: Date.now() });
  }

  async handleAlarm(alarmName: string): Promise<void> {
    if (alarmName !== this.config.alarmName || !this.isActive) {
      return;
    }

    this.lastAlarmAt = Date.now();
    this.logger.debug?.('[KeepAliveController] Alarm triggered');
    this.emitEvent({ type: 'alarm-fired', alarmName, timestamp: this.lastAlarmAt });
    await Promise.resolve(this.onKeepAlive());
  }

  dispose(): void {
    this.clearFallbackMonitor();
    this.isActive = false;
  }

  private scheduleFallbackMonitor(): void {
    this.clearFallbackMonitor();
    this.fallbackTimer = setInterval(() => {
      if (!this.isActive) {
        return;
      }

      const now = Date.now();
      const threshold = this.config.fallbackPingIntervalMs * this.config.maxMissCount;
      if (now - this.lastAlarmAt < threshold) {
        return;
      }

      this.logger.warn?.('[KeepAliveController] Heartbeat alarm missed threshold, triggering fallback');
      this.lastAlarmAt = now;
      void this.triggerFallback();
    }, this.config.fallbackPingIntervalMs);
  }

  private clearFallbackMonitor(): void {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  private async triggerFallback(): Promise<void> {
    try {
      const port = this.runtime.connect?.({ name: 'read-aloud-tab-keep-alive-fallback' });
      port?.postMessage?.({ type: 'PING' });
      port?.disconnect?.();

      if (this.runtime.sendMessage) {
        await this.runtime.sendMessage({ type: 'KEEP_ALIVE_PING' });
      }
      this.emitEvent({ type: 'fallback-triggered', alarmName: this.config.alarmName, timestamp: this.now() });
    } catch (error) {
      this.logger.warn?.('[KeepAliveController] Fallback ping failed', error);
    }
  }

  private emitEvent(event: KeepAliveEvent): void {
    this.onEvent?.(event);
  }

  private now(): number {
    return Date.now();
  }
}
