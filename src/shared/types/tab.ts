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
  content?: string;
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
    summary: tab.summary,
    translation: tab.translation,
  };
}
