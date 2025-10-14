import { useEffect, useState } from 'react';
import { PrefetchStatusSnapshot, PrefetchStatusPayload } from '../../shared/messages';
import { KeepAliveDiagnostics } from '../../shared/types';

interface PrefetchStatusState {
  statuses: PrefetchStatusPayload[];
  updatedAt: number;
  diagnostics?: KeepAliveDiagnostics;
}

const DEFAULT_STATE: PrefetchStatusState = { statuses: [], updatedAt: 0 };

export default function usePrefetchStatus(): PrefetchStatusState {
  const [state, setState] = useState<PrefetchStatusState>(DEFAULT_STATE);

  useEffect(() => {
    let mounted = true;

    const applySnapshot = (snapshot: PrefetchStatusSnapshot | null | undefined) => {
      if (!mounted || !snapshot) {
        return;
      }
      setState({
        statuses: snapshot.statuses ?? [],
        updatedAt: snapshot.updatedAt,
        diagnostics: snapshot.diagnostics,
      });
    };

    const handleRuntimeMessage = (message: any) => {
      if (!message || typeof message !== 'object') {
        return;
      }
      if (message.type === 'PREFETCH_STATUS_SYNC') {
        applySnapshot(message.payload as PrefetchStatusSnapshot);
      }
    };

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local' || !changes.prefetch_status) {
        return;
      }
      const snapshot = changes.prefetch_status.newValue as PrefetchStatusSnapshot;
      applySnapshot(snapshot);
    };

    chrome.runtime?.onMessage?.addListener(handleRuntimeMessage);
    chrome.storage?.onChanged?.addListener(handleStorageChange);

    chrome.runtime?.sendMessage?.({ type: 'PREFETCH_STATUS_SNAPSHOT_REQUEST' }, (response) => {
      if (chrome.runtime?.lastError) {
        return;
      }
      if (response?.success && response.snapshot) {
        applySnapshot(response.snapshot as PrefetchStatusSnapshot);
      }
    });

    chrome.storage?.local?.get?.('prefetch_status', (items) => {
      applySnapshot(items?.prefetch_status as PrefetchStatusSnapshot);
    });

    return () => {
      mounted = false;
      chrome.runtime?.onMessage?.removeListener(handleRuntimeMessage);
      chrome.storage?.onChanged?.removeListener(handleStorageChange);
    };
  }, []);

  return state;
}
