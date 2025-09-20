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
  static isFeatureSupported(feature: string): boolean {
    switch (feature) {
      case 'speechSynthesis':
        return typeof speechSynthesis !== 'undefined';
      case 'storageSync':
        return (typeof chrome !== 'undefined' && !!chrome.storage?.sync) ||
               (typeof browser !== 'undefined' && !!browser.storage?.sync);
      default:
        return false;
    }
  }
}