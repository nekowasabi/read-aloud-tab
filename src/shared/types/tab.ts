export interface TabContent {
  tabId: number;
  url: string;
  title: string;
  text: string;
  extractedAt: number;
}

export interface TabInfo {
  tabId: number;
  url: string;
  title: string;
  /** 元のコンテンツ */
  content?: string;
  /** AI処理後のコンテンツ（要約・翻訳） */
  processedContent?: string;
  /** 後方互換性のため維持 */
  summary?: string;
  translation?: string;
  isIgnored: boolean;
  extractedAt: Date;
}

export function cloneTabInfo(tab: TabInfo): TabInfo {
  return {
    ...tab,
    extractedAt: new Date(tab.extractedAt),
    content: tab.content,
    processedContent: tab.processedContent,
    summary: tab.summary,
    translation: tab.translation,
  };
}
