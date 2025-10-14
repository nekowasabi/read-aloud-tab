import { TabInfo } from './tab';

export interface SerializedTabInfo extends Omit<TabInfo, 'extractedAt' | 'content' | 'summary' | 'translation'> {
  extractedAt: string | null;
  content?: string;
  summary?: string;
  translation?: string;
}

export function createSerializedTab(tab: TabInfo): SerializedTabInfo {
  return {
    ...tab,
    extractedAt: tab.extractedAt ? new Date(tab.extractedAt).toISOString() : null,
  };
}
