import { importSettings } from '../settingsTransfer';
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
  });
});
