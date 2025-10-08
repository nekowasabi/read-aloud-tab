import { BrowserAPI } from '../types';

// ブラウザAPI抽象化クラス
export class BrowserAdapter implements BrowserAPI {
  private static instance: BrowserAdapter;

  static getInstance(): BrowserAdapter {
    if (!this.instance) {
      this.instance = new BrowserAdapter();
    }
    return this.instance;
  }

  tabs = {
    query: async (queryInfo: any): Promise<any[]> => {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          chrome.tabs.query(queryInfo, resolve);
        } else if (typeof browser !== 'undefined' && browser.tabs) {
          browser.tabs.query(queryInfo).then(resolve);
        } else {
          resolve([]);
        }
      });
    },

    sendMessage: async (tabId: number, message: any): Promise<any> => {
      return new Promise((resolve, reject) => {
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          });
        } else if (typeof browser !== 'undefined' && browser.tabs) {
          browser.tabs.sendMessage(tabId, message).then(resolve).catch(reject);
        } else {
          reject(new Error('Browser tabs API not available'));
        }
      });
    },
  };

  storage = {
    sync: {
      get: async (keys?: string | string[] | null): Promise<any> => {
        return new Promise((resolve) => {
          if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.sync.get(keys || {}, resolve);
          } else if (typeof browser !== 'undefined' && browser.storage) {
            browser.storage.sync.get(keys).then(resolve);
          } else {
            resolve({});
          }
        });
      },

      set: async (items: any): Promise<void> => {
        return new Promise((resolve, reject) => {
          if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.sync.set(items, () => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve();
              }
            });
          } else if (typeof browser !== 'undefined' && browser.storage) {
            browser.storage.sync.set(items).then(resolve).catch(reject);
          } else {
            resolve();
          }
        });
      },

      remove: async (keys: string | string[]): Promise<void> => {
        return new Promise((resolve, reject) => {
          if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.sync.remove(keys, () => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve();
              }
            });
          } else if (typeof browser !== 'undefined' && browser.storage) {
            browser.storage.sync.remove(keys).then(resolve).catch(reject);
          } else {
            resolve();
          }
        });
      },
    },
  };

  runtime = {
    sendMessage: async (message: any): Promise<any> => {
      return new Promise((resolve, reject) => {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          });
        } else if (typeof browser !== 'undefined' && browser.runtime) {
          browser.runtime.sendMessage(message).then(resolve).catch(reject);
        } else {
          reject(new Error('Browser runtime API not available'));
        }
      });
    },

    onMessage: {
      addListener: (callback: (message: any, sender: any, sendResponse: any) => void): void => {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.onMessage.addListener(callback);
        } else if (typeof browser !== 'undefined' && browser.runtime) {
          browser.runtime.onMessage.addListener(callback);
        }
      },

      removeListener: (callback: (message: any, sender: any, sendResponse: any) => void): void => {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.onMessage.removeListener(callback);
        } else if (typeof browser !== 'undefined' && browser.runtime) {
          browser.runtime.onMessage.removeListener(callback);
        }
      },
    },

    onConnect: {
      addListener: (callback: any): void => {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.onConnect.addListener(callback);
        } else if (typeof browser !== 'undefined' && browser.runtime) {
          browser.runtime.onConnect.addListener(callback);
        }
      },
    },

    openOptionsPage: async (): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage(() => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve();
            }
          });
        } else if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.openOptionsPage) {
          browser.runtime.openOptionsPage().then(resolve).catch(reject);
        } else {
          reject(new Error('Browser API not available'));
        }
      });
    },
  };

  commands = {
    onCommand: {
      addListener: (callback: (command: string) => void): void => {
        if (typeof chrome !== 'undefined' && chrome.commands) {
          chrome.commands.onCommand.addListener(callback);
        } else if (typeof browser !== 'undefined' && browser.commands) {
          browser.commands.onCommand.addListener(callback);
        }
      },
    },
  };

  // 現在のブラウザを判定
  static getBrowserType(): 'chrome' | 'firefox' | 'unknown' {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
      return 'chrome';
    } else if (typeof browser !== 'undefined' && browser.runtime) {
      return 'firefox';
    }
    return 'unknown';
  }

  // Feature Detection
  static isFeatureSupported(feature: 'speechSynthesis' | 'storageSync' | 'offscreen' | string): boolean {
    switch (feature) {
      case 'speechSynthesis':
        return typeof speechSynthesis !== 'undefined';
      case 'storageSync':
        return (typeof chrome !== 'undefined' && !!chrome.storage?.sync) ||
               (typeof browser !== 'undefined' && !!browser.storage?.sync);
      case 'offscreen':
        return typeof chrome !== 'undefined' && !!chrome.offscreen;
      default:
        return false;
    }
  }

  // Offscreen Document API (Chrome only)
  static async createOffscreenDocument(url: string, reasons: chrome.offscreen.Reason[], justification: string): Promise<void> {
    if (!this.isFeatureSupported('offscreen')) {
      throw new Error('Offscreen API is not supported in this browser');
    }

    // @ts-ignore - chrome.offscreen is only available in Chrome
    await chrome.offscreen.createDocument({
      url,
      reasons,
      justification,
    });
  }

  static async closeOffscreenDocument(): Promise<void> {
    if (!this.isFeatureSupported('offscreen')) {
      return; // No-op for browsers without offscreen API
    }

    // @ts-ignore - chrome.offscreen is only available in Chrome
    await chrome.offscreen.closeDocument();
  }

  static async hasOffscreenDocument(): Promise<boolean> {
    if (!this.isFeatureSupported('offscreen')) {
      return false;
    }

    try {
      // @ts-ignore - chrome.runtime.getContexts and OFFSCREEN_DOCUMENT are only available in Chrome MV3
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as any],
      });
      // @ts-ignore
      return existingContexts.length > 0;
    } catch (error) {
      console.error('Failed to check offscreen document', error);
      return false;
    }
  }
}