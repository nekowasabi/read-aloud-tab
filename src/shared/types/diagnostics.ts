export interface KeepAliveDiagnostics {
  state: 'running' | 'stopped';
  lastHeartbeatAt: number | null;
  lastAlarmAt: number | null;
  lastFallbackAt: number | null;
  fallbackCount: number;
}
