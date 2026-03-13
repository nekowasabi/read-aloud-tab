export class TextExtractor {
  private static readonly IGNORE_TAGS = [
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'EMBED', 'OBJECT',
    'AUDIO', 'VIDEO', 'CANVAS', 'SVG', 'MATH',
    'NAV', 'HEADER', 'FOOTER', 'ASIDE'
  ];

  private static readonly IGNORE_ARIA_ROLES = [
    'navigation',
    'banner',
    'complementary',
    'contentinfo'
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

    // フォールバック: body全体から抽出（IGNORE_TAGSとARIAロールフィルタ適用済み）
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

    // ヒューリスティック: article / main を優先
    const priorityElements = document.querySelectorAll('article, main');
    for (const el of priorityElements) {
      if (this.hasSignificantText(el as HTMLElement)) {
        return el as HTMLElement;
      }
    }

    // テキスト密度ヒューリスティック: HTMLに対するテキスト比率で選択
    const candidates = document.querySelectorAll('div, section, article');
    let bestCandidate: HTMLElement | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const el = candidate as HTMLElement;

      // ラッパー要素を除外: 直接の子ブロック要素が多い場合はスキップ
      const directBlockChildren = Array.from(el.children).filter(child =>
        ['DIV', 'SECTION', 'ARTICLE', 'P', 'UL', 'OL', 'TABLE'].includes(child.tagName)
      );
      if (directBlockChildren.length > 10) {
        continue;
      }

      const textLength = this.getTextLength(el);
      if (textLength < 100) {
        continue;
      }

      // テキスト密度: テキスト長 / innerHTML長の比率
      const htmlLength = el.innerHTML.length;
      if (htmlLength === 0) {
        continue;
      }
      const density = textLength / htmlLength;

      // スコア = テキスト密度 × テキスト長（長さにもボーナス）
      const score = density * Math.log(textLength + 1);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = el;
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

          // ARIAロールによるナビゲーション系要素を除外
          const role = parent.getAttribute('role');
          if (role && this.IGNORE_ARIA_ROLES.includes(role)) {
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
    let node = walker.nextNode();
    while (node !== null) {
      const text = node.textContent?.trim();
      if (text) {
        // 重複する空白文字を正規化
        const normalizedText = text.replace(/\s+/g, ' ');
        texts.push(normalizedText);
      }
      node = walker.nextNode();
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
      element.offsetHeight === 0 ||
      element.getAttribute('aria-hidden') === 'true'
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
