import { TextExtractor } from './extractor';
import { MessageType, TabContent } from '../shared/types';

class ContentScript {
  private isInitialized = false;

  constructor() {
    this.init();
  }

  private init(): void {
    if (this.isInitialized) return;

    this.setupMessageListener();
    this.isInitialized = true;
  }

  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message: MessageType, sender, sendResponse) => {
      this.handleMessage(message, sender)
        .then(sendResponse)
        .catch((error) => {
          console.error('Content script error:', error);
          sendResponse({ error: error.message });
        });

      // 非同期レスポンスを返すためにtrueを返す
      return true;
    });
  }

  private async handleMessage(message: MessageType, sender: chrome.runtime.MessageSender): Promise<any> {
    switch (message.type) {
      case 'EXTRACT_TEXT':
        return this.extractText(message.tabId);
      default:
        console.warn('Unknown message type:', message);
        return { success: false, error: 'Unknown message type' };
    }
  }

  private async extractText(tabId: number): Promise<{ success: boolean; content?: TabContent; error?: string }> {
    try {
      // ページがまだ読み込み中の場合は少し待つ
      if (document.readyState !== 'complete') {
        await this.waitForPageLoad();
      }

      const text = TextExtractor.extractPageText();
      const metadata = TextExtractor.extractPageMetadata();

      if (!text || text.trim().length === 0) {
        throw new Error('No extractable text found on this page');
      }

      const content: TabContent = {
        tabId: tabId,
        url: window.location.href,
        title: metadata.title,
        text: text,
        extractedAt: Date.now(),
      };

      // Background Scriptに抽出結果を送信
      chrome.runtime.sendMessage({
        type: 'TEXT_EXTRACTED',
        content: content,
      }).catch((error) => {
        console.error('Failed to send extracted content to background:', error);
      });

      return { success: true, content };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Text extraction failed:', error);
      return { success: false, error: errorMessage };
    }
  }

  private waitForPageLoad(): Promise<void> {
    return new Promise((resolve) => {
      if (document.readyState === 'complete') {
        resolve();
        return;
      }

      const listener = () => {
        if (document.readyState === 'complete') {
          document.removeEventListener('readystatechange', listener);
          resolve();
        }
      };

      document.addEventListener('readystatechange', listener);

      // 最大5秒で諦める
      setTimeout(resolve, 5000);
    });
  }

  // ページの言語を検出（将来的な機能拡張用）
  private detectPageLanguage(): string {
    const htmlLang = document.documentElement.lang;
    if (htmlLang) return htmlLang;

    // メタタグから言語情報を取得
    const langMeta = document.querySelector('meta[http-equiv="content-language"]') as HTMLMetaElement;
    if (langMeta?.content) return langMeta.content;

    // デフォルトは日本語
    return 'ja';
  }

  // デバッグ用：抽出されるテキストをハイライト
  private highlightExtractedContent(): void {
    const mainContent = document.querySelector('article, main, [role="main"]');
    if (mainContent) {
      (mainContent as HTMLElement).style.outline = '2px solid #007bff';
      (mainContent as HTMLElement).style.outlineOffset = '4px';

      setTimeout(() => {
        (mainContent as HTMLElement).style.outline = '';
        (mainContent as HTMLElement).style.outlineOffset = '';
      }, 3000);
    }
  }
}

// Content Scriptを初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new ContentScript();
  });
} else {
  new ContentScript();
}