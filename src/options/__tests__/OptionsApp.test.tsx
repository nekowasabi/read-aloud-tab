import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import OptionsApp from '../OptionsApp';
import { STORAGE_KEYS } from '../../shared/types';

jest.mock('../../shared/utils/storage', () => ({
  StorageManager: {
    getSettings: jest.fn(),
    saveSettings: jest.fn(),
    getAiSettings: jest.fn(),
    saveAiSettings: jest.fn(),
    validateAiSettings: jest.fn((settings) => ({
      openRouterApiKey: (settings?.openRouterApiKey || '').trim(),
      openRouterModel: settings?.openRouterModel || 'meta-llama/llama-3.2-1b-instruct',
      enableAiSummary: settings?.enableAiSummary ?? false,
      enableAiTranslation: settings?.enableAiTranslation ?? false,
      summaryPrompt: settings?.summaryPrompt?.trim() || 'default summary prompt',
      translationPrompt: settings?.translationPrompt?.trim() || 'default translation prompt',
    })),
    getDeveloperMode: jest.fn(),
    setDeveloperMode: jest.fn(),
  },
  getIgnoredDomains: jest.fn(),
}));

jest.mock('../../shared/services/openrouter', () => ({
  OpenRouterClient: jest.fn().mockImplementation(() => ({
    testConnection: jest.fn(),
  })),
}));

const storage = require('../../shared/utils/storage');
const { OpenRouterClient } = require('../../shared/services/openrouter');

const baseAiSettings = {
  openRouterApiKey: '',
  openRouterModel: 'meta-llama/llama-3.2-1b-instruct',
  enableAiSummary: false,
  enableAiTranslation: false,
  summaryPrompt: 'default summary prompt',
  translationPrompt: 'default translation prompt',
};

describe('OptionsApp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({});
    (chrome.storage.sync.set as jest.Mock).mockResolvedValue(undefined);
    storage.StorageManager.getAiSettings.mockResolvedValue(baseAiSettings);
    storage.StorageManager.getDeveloperMode.mockResolvedValue(false);
    storage.StorageManager.setDeveloperMode.mockResolvedValue(undefined);
  });

  test('初期表示で設定値と無視リストをロードしてフォームに反映する', async () => {
    storage.StorageManager.getSettings.mockResolvedValue({ rate: 1.2, pitch: 1.0, volume: 0.8, voice: 'Test Voice' });
    storage.getIgnoredDomains.mockResolvedValue(['example.com']);

    render(<OptionsApp />);

    const rateInput = await screen.findByLabelText('読み上げ速度');
    expect(rateInput).toHaveValue(1.2);
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  test('エクスポートボタンで設定と無視リストをJSONとして表示する', async () => {
    storage.StorageManager.getSettings.mockResolvedValue({ rate: 1, pitch: 1, volume: 1, voice: null });
    storage.getIgnoredDomains.mockResolvedValue(['foo.com']);

    render(<OptionsApp />);

    const exportButton = await screen.findByRole('button', { name: 'エクスポート' });
    fireEvent.click(exportButton);

    await waitFor(() => {
      const textarea = screen.getByLabelText('エクスポートデータ') as HTMLTextAreaElement;
      const parsed = JSON.parse(textarea.value);
      expect(parsed.ignoredDomains).toEqual(['foo.com']);
    });
  });

  test('インポートボタンでJSONを読み込み、設定と無視リストを保存する', async () => {
    storage.StorageManager.getSettings.mockResolvedValue({ rate: 1, pitch: 1, volume: 1, voice: null });
    storage.getIgnoredDomains.mockResolvedValue([]);

    render(<OptionsApp />);

    const textarea = await screen.findByLabelText('エクスポートデータ');
    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify({
          version: 2,
          settings: { rate: 1.5, pitch: 1.2, volume: 0.6, voice: 'Import Voice' },
          ignoredDomains: ['imported.com'],
        }),
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'インポート' }));

    await waitFor(() => {
      expect(storage.StorageManager.saveSettings).toHaveBeenCalledWith({ rate: 1.5, pitch: 1.2, volume: 0.6, voice: 'Import Voice' });
      expect(chrome.storage.sync.set).toHaveBeenCalledWith({ [STORAGE_KEYS.IGNORED_DOMAINS]: ['imported.com'] });
    });
  });

  test('AI設定UIがレンダリングされる', async () => {
    storage.StorageManager.getSettings.mockResolvedValue({ rate: 1, pitch: 1, volume: 1, voice: null });
    storage.getIgnoredDomains.mockResolvedValue([]);
    storage.StorageManager.getAiSettings.mockResolvedValue({
      ...baseAiSettings,
      openRouterApiKey: 'test-key',
      openRouterModel: 'test-model',
      enableAiSummary: true,
      summaryPrompt: 'summary prompt',
      translationPrompt: 'translation prompt',
    });

    render(<OptionsApp />);

    await waitFor(() => {
      expect(screen.getByLabelText('AI要約を有効化')).toBeInTheDocument();
      expect(screen.getByLabelText('要約プロンプト')).toBeInTheDocument();
      expect(screen.getByLabelText('OpenRouter APIキー')).toBeInTheDocument();
      expect(screen.getByLabelText('OpenRouterモデル名')).toBeInTheDocument();
      expect(screen.getByLabelText('翻訳プロンプト')).toBeInTheDocument();
    });
  });

  test('AI設定を変更すると保存される', async () => {
    storage.StorageManager.getSettings.mockResolvedValue({ rate: 1, pitch: 1, volume: 1, voice: null });
    storage.getIgnoredDomains.mockResolvedValue([]);
    storage.StorageManager.saveAiSettings.mockResolvedValue(undefined);

    render(<OptionsApp />);

    const enableCheckbox = await screen.findByLabelText('AI要約を有効化');
    fireEvent.click(enableCheckbox);

    await waitFor(() => {
      expect(storage.StorageManager.saveAiSettings).toHaveBeenCalledWith(
        expect.objectContaining({ enableAiSummary: true })
      );
    });

    const summaryPromptInput = await screen.findByLabelText('要約プロンプト');
    fireEvent.change(summaryPromptInput, { target: { value: '新しい要約プロンプト' } });

    await waitFor(() => {
      expect(storage.StorageManager.saveAiSettings).toHaveBeenCalledWith(
        expect.objectContaining({ summaryPrompt: '新しい要約プロンプト' })
      );
    });
  });

  test('開発者モードを切り替えると保存される', async () => {
    storage.StorageManager.getSettings.mockResolvedValue({ rate: 1, pitch: 1, volume: 1, voice: null });
    storage.getIgnoredDomains.mockResolvedValue([]);

    render(<OptionsApp />);

    const developerCheckbox = await screen.findByLabelText('開発者モードを有効にする');
    fireEvent.click(developerCheckbox);

    await waitFor(() => {
      expect(storage.StorageManager.setDeveloperMode).toHaveBeenCalledWith(true);
    });
  });

  test('エクスポートにAI設定が含まれる（APIキーは除外）', async () => {
    storage.StorageManager.getSettings.mockResolvedValue({ rate: 1, pitch: 1, volume: 1, voice: null });
    storage.getIgnoredDomains.mockResolvedValue([]);
    storage.StorageManager.getAiSettings.mockResolvedValue({
      ...baseAiSettings,
      openRouterApiKey: 'secret-key',
      openRouterModel: 'test-model',
      enableAiSummary: true,
      summaryPrompt: 'export summary',
      translationPrompt: 'export translation',
    });

    render(<OptionsApp />);

    const exportButton = await screen.findByRole('button', { name: 'エクスポート' });
    fireEvent.click(exportButton);

    await waitFor(() => {
      const textarea = screen.getByLabelText('エクスポートデータ') as HTMLTextAreaElement;
      const parsed = JSON.parse(textarea.value);
      expect(parsed.aiSettings).toBeDefined();
      expect(parsed.aiSettings.openRouterApiKey).toBe(''); // APIキーは除外
      expect(parsed.aiSettings.openRouterModel).toBe('test-model');
      expect(parsed.aiSettings.enableAiSummary).toBe(true);
      expect(parsed.aiSettings.summaryPrompt).toBe('export summary');
      expect(parsed.aiSettings.translationPrompt).toBe('export translation');
    });
  });

  test('インポートでAI設定が復元される', async () => {
    storage.StorageManager.getSettings.mockResolvedValue({ rate: 1, pitch: 1, volume: 1, voice: null });
    storage.getIgnoredDomains.mockResolvedValue([]);

    render(<OptionsApp />);

    const textarea = await screen.findByLabelText('エクスポートデータ');
    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify({
          version: 2,
          settings: { rate: 1, pitch: 1, volume: 1, voice: null },
          ignoredDomains: [],
          aiSettings: {
            openRouterApiKey: '',
            openRouterModel: 'imported-model',
            enableAiSummary: true,
            enableAiTranslation: true,
            summaryPrompt: 'import summary',
            translationPrompt: 'import translation',
          },
        }),
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'インポート' }));

    await waitFor(() => {
      expect(storage.StorageManager.saveAiSettings).toHaveBeenCalledWith({
        openRouterApiKey: '',
        openRouterModel: 'imported-model',
        enableAiSummary: true,
        enableAiTranslation: true,
        summaryPrompt: 'import summary',
        translationPrompt: 'import translation',
      });
    });
  });

  describe('接続テスト機能', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      storage.StorageManager.getSettings.mockResolvedValue({ rate: 1, pitch: 1, volume: 1, voice: null });
      storage.getIgnoredDomains.mockResolvedValue([]);
    });

    test('接続テストボタンが表示される', async () => {
      storage.StorageManager.getAiSettings.mockResolvedValue({
        ...baseAiSettings,
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
      });

      render(<OptionsApp />);

      const button = await screen.findByRole('button', { name: '接続テスト' });
      expect(button).toBeInTheDocument();
    });

    test('APIキー未入力時は接続テストボタンが無効化される', async () => {
      storage.StorageManager.getAiSettings.mockResolvedValue({
        ...baseAiSettings,
        openRouterModel: 'test-model',
      });

      render(<OptionsApp />);

      const button = await screen.findByRole('button', { name: '接続テスト' });
      expect(button).toBeDisabled();
    });

    test('接続テスト成功時に成功メッセージが表示される', async () => {
      storage.StorageManager.getAiSettings.mockResolvedValue({
        ...baseAiSettings,
        openRouterApiKey: 'valid-key',
        openRouterModel: 'test-model',
      });

      const mockTestConnection = jest.fn().mockResolvedValue({
        success: true,
      });
      OpenRouterClient.mockImplementation(() => ({
        testConnection: mockTestConnection,
      }));

      render(<OptionsApp />);

      const button = await screen.findByRole('button', { name: '接続テスト' });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText(/接続に成功しました/)).toBeInTheDocument();
      });
      expect(mockTestConnection).toHaveBeenCalled();
    });

    test('接続テスト失敗時にエラーメッセージが表示される', async () => {
      storage.StorageManager.getAiSettings.mockResolvedValue({
        ...baseAiSettings,
        openRouterApiKey: 'invalid-key',
        openRouterModel: 'test-model',
      });

      const mockTestConnection = jest.fn().mockResolvedValue({
        success: false,
        error: 'APIキーが無効です',
      });
      OpenRouterClient.mockImplementation(() => ({
        testConnection: mockTestConnection,
      }));

      render(<OptionsApp />);

      const button = await screen.findByRole('button', { name: '接続テスト' });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText(/接続に失敗しました/)).toBeInTheDocument();
        expect(screen.getByText(/APIキーが無効です/)).toBeInTheDocument();
      });
    });

    test('接続テスト中はボタンが無効化される', async () => {
      storage.StorageManager.getAiSettings.mockResolvedValue({
        ...baseAiSettings,
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
      });

      let resolveTestConnection: (value: any) => void;
      const testConnectionPromise = new Promise((resolve) => {
        resolveTestConnection = resolve;
      });
      const mockTestConnection = jest.fn().mockReturnValue(testConnectionPromise);
      OpenRouterClient.mockImplementation(() => ({
        testConnection: mockTestConnection,
      }));

      render(<OptionsApp />);

      const button = await screen.findByRole('button', { name: '接続テスト' });
      fireEvent.click(button);

      // テスト実行中はボタンが無効化される
      await waitFor(() => {
        expect(button).toBeDisabled();
      });

      // テスト完了
      resolveTestConnection!({ success: true });

      // ボタンが再度有効化される
      await waitFor(() => {
        expect(button).not.toBeDisabled();
      });
    });

    test('接続テスト中はローディングメッセージが表示される', async () => {
      storage.StorageManager.getAiSettings.mockResolvedValue({
        ...baseAiSettings,
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
      });

      let resolveTestConnection: (value: any) => void;
      const testConnectionPromise = new Promise((resolve) => {
        resolveTestConnection = resolve;
      });
      const mockTestConnection = jest.fn().mockReturnValue(testConnectionPromise);
      OpenRouterClient.mockImplementation(() => ({
        testConnection: mockTestConnection,
      }));

      render(<OptionsApp />);

      const button = await screen.findByRole('button', { name: '接続テスト' });
      fireEvent.click(button);

      // ローディング中のメッセージを確認
      await waitFor(() => {
        expect(screen.getByText(/接続テスト中/)).toBeInTheDocument();
      });

      // テスト完了
      resolveTestConnection!({ success: true });

      // ローディングメッセージが消える
      await waitFor(() => {
        expect(screen.queryByText(/接続テスト中/)).not.toBeInTheDocument();
      });
    });
  });

  describe('OpenRouter接続テスト', () => {
    test('接続テストボタンが表示される', async () => {
      storage.StorageManager.getSettings.mockResolvedValue({ rate: 1, pitch: 1, volume: 1, voice: null });
      storage.getIgnoredDomains.mockResolvedValue([]);

      render(<OptionsApp />);

      const testButton = await screen.findByRole('button', { name: '接続テスト' });
      expect(testButton).toBeInTheDocument();
    });

    test('APIキー未入力の場合、接続テストボタンが無効化される', async () => {
      storage.StorageManager.getSettings.mockResolvedValue({ rate: 1, pitch: 1, volume: 1, voice: null });
      storage.getIgnoredDomains.mockResolvedValue([]);
      storage.StorageManager.getAiSettings.mockResolvedValue({
        openRouterApiKey: '',
        openRouterModel: 'meta-llama/llama-3.2-1b-instruct',
        enableAiSummary: false,
        enableAiTranslation: false,
      });

      render(<OptionsApp />);

      const testButton = await screen.findByRole('button', { name: '接続テスト' });
      expect(testButton).toBeDisabled();
    });

    test('接続テストが成功した場合、成功メッセージが表示される', async () => {
      storage.StorageManager.getSettings.mockResolvedValue({ rate: 1, pitch: 1, volume: 1, voice: null });
      storage.getIgnoredDomains.mockResolvedValue([]);
      storage.StorageManager.getAiSettings.mockResolvedValue({
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: false,
      });

      const mockTestConnection = jest.fn().mockResolvedValue({
        success: true,
        message: '接続に成功しました',
      });
      OpenRouterClient.mockImplementation(() => ({
        testConnection: mockTestConnection,
      }));

      render(<OptionsApp />);

      const testButton = await screen.findByRole('button', { name: '接続テスト' });
      expect(testButton).not.toBeDisabled();

      fireEvent.click(testButton);

      await waitFor(() => {
        expect(screen.getByText(/接続に成功しました/i)).toBeInTheDocument();
      });

      expect(mockTestConnection).toHaveBeenCalledTimes(1);
    });

    test('接続テストが失敗した場合、エラーメッセージが表示される', async () => {
      storage.StorageManager.getSettings.mockResolvedValue({ rate: 1, pitch: 1, volume: 1, voice: null });
      storage.getIgnoredDomains.mockResolvedValue([]);
      storage.StorageManager.getAiSettings.mockResolvedValue({
        openRouterApiKey: 'invalid-key',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: false,
      });

      const mockTestConnection = jest.fn().mockResolvedValue({
        success: false,
        error: 'APIキーが無効です',
      });
      OpenRouterClient.mockImplementation(() => ({
        testConnection: mockTestConnection,
      }));

      render(<OptionsApp />);

      const testButton = await screen.findByRole('button', { name: '接続テスト' });
      fireEvent.click(testButton);

      await waitFor(() => {
        expect(screen.getByText(/接続に失敗しました.*APIキーが無効です/i)).toBeInTheDocument();
      });
    });

    test('接続テスト実行中はボタンが無効化され、ローディング表示になる', async () => {
      storage.StorageManager.getSettings.mockResolvedValue({ rate: 1, pitch: 1, volume: 1, voice: null });
      storage.getIgnoredDomains.mockResolvedValue([]);
      storage.StorageManager.getAiSettings.mockResolvedValue({
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: false,
      });

      let resolveTestConnection: (value: any) => void;
      const testConnectionPromise = new Promise((resolve) => {
        resolveTestConnection = resolve;
      });

      const mockTestConnection = jest.fn().mockReturnValue(testConnectionPromise);
      OpenRouterClient.mockImplementation(() => ({
        testConnection: mockTestConnection,
      }));

      render(<OptionsApp />);

      const testButton = await screen.findByRole('button', { name: '接続テスト' });
      fireEvent.click(testButton);

      // ローディング中の確認
      await waitFor(() => {
        expect(screen.getByText('接続テスト中...')).toBeInTheDocument();
      });
      expect(testButton).toBeDisabled();

      // テスト完了
      resolveTestConnection!({ success: true, message: '接続に成功しました' });

      await waitFor(() => {
        expect(screen.queryByText('接続テスト中...')).not.toBeInTheDocument();
      });
    });
  });
});
