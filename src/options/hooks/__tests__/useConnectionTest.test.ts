/**
 * useConnectionTest.test.ts
 * Process 100 Red Phase: OpenRouter接続テストhookのテスト
 */
import { renderHook, act } from '@testing-library/react';
import { useConnectionTest } from '../useConnectionTest';

const mockTestConnection = jest.fn();

jest.mock('../../../shared/services/openrouter', () => ({
  OpenRouterClient: jest.fn().mockImplementation(() => ({
    testConnection: mockTestConnection,
  })),
}));

const makeAiSettings = (overrides = {}) => ({
  enableAiSummary: false,
  enableAiTranslation: false,
  openRouterApiKey: 'sk-test-key',
  openRouterModel: 'meta-llama/llama-3.2-1b-instruct',
  openRouterProvider: '',
  summaryPrompt: '',
  translationPrompt: '',
  summaryWaitMode: 'wait' as const,
  ...overrides,
});

describe('useConnectionTest (Process 100)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should start with no result and not testing', () => {
    const { result } = renderHook(() => useConnectionTest());

    expect(result.current.isTestingConnection).toBe(false);
    expect(result.current.connectionTestResult).toBeNull();
  });

  it('should set result to success on successful connection', async () => {
    mockTestConnection.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useConnectionTest());

    await act(async () => {
      await result.current.runConnectionTest(makeAiSettings());
    });

    expect(result.current.isTestingConnection).toBe(false);
    expect(result.current.connectionTestResult).toEqual({ success: true });
  });

  it('should set error result when api key is missing', async () => {
    const { result } = renderHook(() => useConnectionTest());

    await act(async () => {
      await result.current.runConnectionTest(makeAiSettings({ openRouterApiKey: '' }));
    });

    expect(result.current.connectionTestResult?.success).toBe(false);
    expect(result.current.connectionTestResult?.error).toMatch(/APIキー/);
    expect(mockTestConnection).not.toHaveBeenCalled();
  });

  it('should set error result on connection failure', async () => {
    mockTestConnection.mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useConnectionTest());

    await act(async () => {
      await result.current.runConnectionTest(makeAiSettings());
    });

    expect(result.current.connectionTestResult?.success).toBe(false);
    expect(result.current.connectionTestResult?.error).toBe('network error');
  });
});
