import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';

const mockAddTab = jest.fn();
const mockRemoveTab = jest.fn();
const mockReorderTabs = jest.fn();
const mockControl = jest.fn();
const mockOpenOptionsPage = jest.fn();

beforeEach(() => {
  mockAddTab.mockResolvedValue(undefined);
  mockRemoveTab.mockResolvedValue(undefined);
  mockReorderTabs.mockResolvedValue(undefined);
  mockControl.mockResolvedValue(undefined);
  mockOpenOptionsPage.mockResolvedValue(undefined);
});

jest.mock('../../hooks/useTabQueue', () => ({
  __esModule: true,
  default: () => ({
    state: {
      status: 'idle',
      currentIndex: 0,
      totalCount: 1,
      activeTabId: 1,
      tabs: [
        {
          tabId: 1,
          url: 'https://example.com',
          title: 'Example Tab',
          content: 'hello',
          summary: null,
          isIgnored: false,
          position: 0,
          extractedAt: new Date().toISOString(),
        },
      ],
      settings: { rate: 1, pitch: 1, volume: 1, voice: null },
      updatedAt: Date.now(),
    },
    connectionState: 'connected',
    lastError: null,
    progressByTab: {},
    addTab: mockAddTab,
    removeTab: mockRemoveTab,
    reorderTabs: mockReorderTabs,
    skipNext: jest.fn().mockResolvedValue(undefined),
    skipPrevious: jest.fn().mockResolvedValue(undefined),
    control: mockControl,
    updateSettings: jest.fn().mockResolvedValue(undefined),
  }),
}));

const mockBrowserQuery = jest.fn();
const mockBrowserGetStorage = jest.fn();

jest.mock('../../../shared/utils/browser', () => ({
  BrowserAdapter: {
    getInstance: jest.fn(() => ({
      tabs: {
        query: mockBrowserQuery,
      },
      storage: {
        sync: {
          get: mockBrowserGetStorage,
        },
      },
      runtime: {
        openOptionsPage: mockOpenOptionsPage,
      },
    })),
  },
}));

describe('App integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock BrowserAdapter methods
    mockBrowserQuery.mockResolvedValue([{ id: 99, url: 'https://active.com', title: 'Active Tab' }]);
    mockBrowserGetStorage.mockResolvedValue({
      tts_settings: { rate: 1, pitch: 1, volume: 1, voice: null },
    });

    // Mock chrome.tabs.query (callback-based API)
    (chrome.tabs.query as jest.Mock).mockImplementation((queryInfo, callback) => {
      callback([{ id: 99, url: 'https://active.com', title: 'Active Tab' }]);
    });

    // Mock chrome.storage.sync.get (callback-based API)
    (chrome.storage.sync.get as jest.Mock).mockImplementation((keys, callback) => {
      callback({
        tts_settings: { rate: 1, pitch: 1, volume: 1, voice: null },
      });
    });

    // Mock chrome.storage.onChanged (listener API)
    (chrome.storage as any).onChanged = {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    };
  });

  test('アクティブタブをキューに追加する', async () => {
    render(<App />);

    const addButton = await screen.findByRole('button', { name: /キューに追加/ });
    fireEvent.click(addButton);

    expect(mockAddTab).toHaveBeenCalledWith({
      tabId: 99,
      url: 'https://active.com',
      title: 'Active Tab',
    });
  });

  test('リストから削除ボタンを押すと removeTab が呼ばれる', async () => {
    render(<App />);

    const removeButton = await screen.findByLabelText(/削除:/);
    fireEvent.click(removeButton);

    expect(mockRemoveTab).toHaveBeenCalledWith(1);
  });

  test('再生コントロールが control を呼び出す', async () => {
    render(<App />);

    const playButton = await screen.findByRole('button', { name: /再生/ });
    fireEvent.click(playButton);

    expect(mockControl).toHaveBeenCalledWith('start');
  });

  test('歯車ボタンをクリックすると openOptionsPage が呼ばれる', async () => {
    render(<App />);

    const settingsButton = await screen.findByTitle('設定');
    fireEvent.click(settingsButton);

    expect(mockOpenOptionsPage).toHaveBeenCalled();
  });

  test('すべてのタブをキューに追加する', async () => {
    // Mock multiple tabs
    mockBrowserQuery.mockResolvedValue([
      { id: 1, url: 'https://example1.com', title: 'Tab 1' },
      { id: 2, url: 'https://example2.com', title: 'Tab 2' },
      { id: 3, url: 'chrome://extensions', title: 'Extensions' }, // Should be filtered out
      { id: 4, url: 'about:blank', title: 'Blank' }, // Should be filtered out
    ]);

    render(<App />);

    const addAllButton = await screen.findByRole('button', { name: /すべてのタブを追加/ });
    fireEvent.click(addAllButton);

    // Wait for async operations
    await screen.findByText(/2個のタブをキューに追加しました/);

    // Should only add valid tabs (chrome:// and about: are filtered)
    expect(mockAddTab).toHaveBeenCalledTimes(2);
    expect(mockAddTab).toHaveBeenCalledWith({
      tabId: 1,
      url: 'https://example1.com',
      title: 'Tab 1',
    });
    expect(mockAddTab).toHaveBeenCalledWith({
      tabId: 2,
      url: 'https://example2.com',
      title: 'Tab 2',
    });
  });

  test('無視リストのドメインを除外してすべてのタブを追加する', async () => {
    // Mock ignored domains
    mockBrowserGetStorage.mockResolvedValue({
      ignoredDomains: ['docs.google.com', 'example2.com'],
      tts_settings: { rate: 1, pitch: 1, volume: 1, voice: null },
    });

    // Mock multiple tabs including ignored domains
    mockBrowserQuery.mockResolvedValue([
      { id: 1, url: 'https://example1.com', title: 'Tab 1' },
      { id: 2, url: 'https://docs.google.com/document/1', title: 'Google Doc' }, // Should be filtered out
      { id: 3, url: 'https://example2.com', title: 'Tab 2' }, // Should be filtered out
      { id: 4, url: 'https://example3.com', title: 'Tab 3' },
    ]);

    render(<App />);

    const addAllButton = await screen.findByRole('button', { name: /すべてのタブを追加/ });
    fireEvent.click(addAllButton);

    // Wait for async operations
    await screen.findByText(/2個のタブをキューに追加しました/);

    // Should only add tabs not in ignored list
    expect(mockAddTab).toHaveBeenCalledTimes(2);
    expect(mockAddTab).toHaveBeenCalledWith({
      tabId: 1,
      url: 'https://example1.com',
      title: 'Tab 1',
    });
    expect(mockAddTab).toHaveBeenCalledWith({
      tabId: 4,
      url: 'https://example3.com',
      title: 'Tab 3',
    });

    // Should NOT add ignored domains
    expect(mockAddTab).not.toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://docs.google.com/document/1' })
    );
    expect(mockAddTab).not.toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example2.com' })
    );
  });
});
