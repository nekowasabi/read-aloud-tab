/**
 * useConnectionTest.ts
 * Extracted from OptionsApp.tsx (Process 100)
 *
 * Manages the OpenRouter API connection test lifecycle.
 */
import { useCallback, useState } from 'react';
import { AiSettings } from '../../shared/types';
import { OpenRouterClient } from '../../shared/services/openrouter';
import type { ConnectionTestResult } from '../../shared/types/ai';

export interface UseConnectionTestResult {
  isTestingConnection: boolean;
  connectionTestResult: ConnectionTestResult | null;
  runConnectionTest: (aiSettings: AiSettings) => Promise<void>;
}

export function useConnectionTest(): UseConnectionTestResult {
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<ConnectionTestResult | null>(null);

  const runConnectionTest = useCallback(async (aiSettings: AiSettings) => {
    if (!aiSettings.openRouterApiKey) {
      setConnectionTestResult({ success: false, error: 'APIキーを入力してください' });
      return;
    }

    setIsTestingConnection(true);
    setConnectionTestResult(null);

    try {
      const client = new OpenRouterClient(
        aiSettings.openRouterApiKey,
        aiSettings.openRouterModel,
        aiSettings.openRouterProvider,
      );
      const result = await client.testConnection();
      setConnectionTestResult(result);
    } catch (error) {
      console.error('[useConnectionTest] connection test failed', error);
      setConnectionTestResult({
        success: false,
        error: error instanceof Error ? error.message : '接続テストに失敗しました',
      });
    } finally {
      setIsTestingConnection(false);
    }
  }, []);

  return { isTestingConnection, connectionTestResult, runConnectionTest };
}
