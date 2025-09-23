import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import OptionsApp from '../OptionsApp';
import { STORAGE_KEYS } from '../../shared/types';

jest.mock('../../shared/utils/storage', () => ({
  StorageManager: {
    getSettings: jest.fn(),
    saveSettings: jest.fn(),
  },
  getIgnoredDomains: jest.fn(),
}));

const storage = require('../../shared/utils/storage');

describe('OptionsApp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chrome.storage.sync.get as jest.Mock).mockResolvedValue({});
    (chrome.storage.sync.set as jest.Mock).mockResolvedValue(undefined);
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
});
