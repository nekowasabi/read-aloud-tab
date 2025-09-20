export class TextExtractor {
  private static readonly IGNORE_TAGS = [
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'EMBED', 'OBJECT',
    'AUDIO', 'VIDEO', 'CANVAS', 'SVG', 'MATH'
  ];

  private static readonly CONTENT_SELECTORS = [
    'article',
    'main',
    '[role="main"]',
    '.content',
    '#content',
    '.post',
    '.article',
    '.entry',
    '.story',
    '.text'
  ];

  static extractPageText(): string {
    // メインコンテンツの検出を試みる
    const mainContent = this.findMainContent();
    if (mainContent) {
      return this.extractTextFromElement(mainContent);
    }

    // フォールバック: body全体から抽出（不要な要素を除外）
    return this.extractTextFromElement(document.body);
  }

  private static findMainContent(): HTMLElement | null {
    // 優先順位の高い順にセレクタを試す
    for (const selector of this.CONTENT_SELECTORS) {
      const element = document.querySelector(selector) as HTMLElement;
      if (element && this.hasSignificantText(element)) {
        return element;
      }
    }

    // ヒューリスティック: 最も長いテキストを持つ要素を探す
    const candidates = document.querySelectorAll('div, section, article');
    let bestCandidate: HTMLElement | null = null;
    let maxTextLength = 0;

    for (const candidate of candidates) {
      const textLength = this.getTextLength(candidate as HTMLElement);
      if (textLength > maxTextLength && textLength > 100) {
        maxTextLength = textLength;
        bestCandidate = candidate as HTMLElement;
      }
    }

    return bestCandidate;
  }

  private static hasSignificantText(element: HTMLElement): boolean {
    const text = this.extractTextFromElement(element);
    return text.trim().length > 50; // 最低50文字は必要
  }

  private static getTextLength(element: HTMLElement): number {
    return this.extractTextFromElement(element).length;
  }

  private static extractTextFromElement(element: HTMLElement): string {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          // 無視するタグの子要素は除外
          if (this.IGNORE_TAGS.includes(parent.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }

          // 非表示要素は除外
          if (this.isHidden(parent)) {
            return NodeFilter.FILTER_REJECT;
          }

          const text = node.textContent?.trim();
          if (!text || text.length === 0) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const texts: string[] = [];
    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (text) {
        // 重複する空白文字を正規化
        const normalizedText = text.replace(/\s+/g, ' ');
        texts.push(normalizedText);
      }
    }

    // テキストを結合し、適切な区切りを追加
    return texts.join(' ').trim();
  }

  private static isHidden(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    return (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      element.hidden ||
      element.offsetWidth === 0 ||
      element.offsetHeight === 0
    );
  }

  // ページのメタ情報を取得
  static extractPageMetadata(): { title: string; description?: string; lang?: string } {
    const title = document.title || 'Untitled';

    const descriptionMeta = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    const description = descriptionMeta?.content || undefined;

    const htmlLang = document.documentElement.lang || undefined;

    return {
      title,
      description,
      lang: htmlLang
    };
  }

  // 長いテキストを分割して処理しやすくする
  static splitTextIntoChunks(text: string, maxChunkSize: number = 500): string[] {
    if (text.length <= maxChunkSize) {
      return [text];
    }

    const sentences = text.split(/[.!?。！？]+\s*/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > maxChunkSize && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }
}