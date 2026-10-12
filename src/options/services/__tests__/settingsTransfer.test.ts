import { exportSettings, importSettings } from '../settingsTransfer';
import { StorageManager } from '../../../shared/utils/storage';

jest.mock('../../../shared/utils/storage', () => ({
  StorageManager: {
    saveSettings: jest.fn().mockResolvedValue(undefined),
    saveAiSettings: jest.fn().mockResolvedValue(undefined),
    setAutoQueueNewTabs: jest.fn().mockResolvedValue(undefined),
    validateAiSettings: jest.fn(value => value),
  },
}));

describe('settings transfer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('imports version 3 auto queue setting and rejects non-boolean values', async () => {
    const settings = { rate: 1, pitch: 1, volume: 1, voice: null };
    (globalThis as any).chrome = {
      storage: { sync: { set: jest.fn().mockResolvedValue(undefined) } },
    };
    await importSettings(
      JSON.stringify({ version: 3, settings, ignoredDomains: [], autoQueueNewTabs: true })
    );
    expect(StorageManager.setAutoQueueNewTabs).toHaveBeenCalledWith(true);
    await expect(
      importSettings(
        JSON.stringify({ version: 3, settings, ignoredDomains: [], autoQueueNewTabs: 'true' })
      )
    ).rejects.toThrow();
    await expect(
      importSettings(JSON.stringify({ version: 3, settings, ignoredDomains: [] }))
    ).rejects.toThrow('Invalid auto queue setting');
  });

  it('keeps the auto queue setting absent for legacy imports', async () => {
    const settings = { rate: 1, pitch: 1, volume: 1, voice: null };
    (globalThis as any).chrome = {
      storage: { sync: { set: jest.fn().mockResolvedValue(undefined) } },
    };

    const result = await importSettings(
      JSON.stringify({ version: 2, settings, ignoredDomains: [] })
    );

    expect(result.autoQueueNewTabs).toBeUndefined();
    expect(StorageManager.setAutoQueueNewTabs).not.toHaveBeenCalled();
  });

  it('exports version 3 without the API key', async () => {
    const originalUrl = global.URL;
    Object.defineProperty(global, 'URL', {
      configurable: true,
      value: { createObjectURL: jest.fn(() => 'blob:test'), revokeObjectURL: jest.fn() },
    });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation();

    const blob = await exportSettings(
      { rate: 1, pitch: 1, volume: 1, voice: null },
      [],
      {
        enableAiSummary: false,
        enableAiTranslation: false,
        openRouterApiKey: 'secret',
        openRouterModel: '',
        openRouterProvider: '',
        summaryPrompt: '',
        translationPrompt: '',
        summaryWaitMode: 'wait',
      },
      true
    );
    const payload = JSON.parse(
      await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      })
    );

    expect(payload).toEqual(expect.objectContaining({ version: 3, autoQueueNewTabs: true }));
    expect(payload.aiSettings.openRouterApiKey).toBe('');
    click.mockRestore();
    Object.defineProperty(global, 'URL', { configurable: true, value: originalUrl });
  });
});
