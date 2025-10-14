import { PrefetchResultStore } from './worker';

interface ResultStoreOptions {
  storage: Pick<typeof chrome.storage.local, 'get' | 'set'>;
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

interface StoredResults {
  results: PrefetchEntry[];
}

interface PrefetchEntry {
  tabId: number;
  summary?: string;
  translation?: string;
  generatedAt: number;
}

const STORAGE_KEY = 'prefetch_results';

export class PrefetchResultStoreImpl implements PrefetchResultStore {
  private readonly storage: Pick<typeof chrome.storage.local, 'get' | 'set'>;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private cache: PrefetchEntry[] | null = null;

  constructor(options: ResultStoreOptions) {
    this.storage = options.storage;
    this.maxEntries = options.maxEntries ?? 10;
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  async save(entry: PrefetchEntry): Promise<void> {
    const results = await this.load();
    const filtered = results.filter((item) => item.tabId !== entry.tabId);
    filtered.unshift(entry);
    this.cache = this.pruneArray(filtered);
    await this.persist();
  }

  async get(tabId: number): Promise<PrefetchEntry | null> {
    const results = await this.load();
    const result = results.find((item) => item.tabId === tabId) ?? null;
    if (!result) {
      return null;
    }
    if (this.isExpired(result)) {
      await this.delete(tabId);
      return null;
    }
    return result;
  }

  async delete(tabId: number): Promise<void> {
    const results = await this.load();
    const next = results.filter((item) => item.tabId !== tabId);
    if (next.length === results.length) {
      return;
    }
    this.cache = next;
    await this.persist();
  }

  async prune(): Promise<void> {
    const results = await this.load();
    const pruned = this.pruneArray(results);
    if (pruned.length === results.length) {
      return;
    }
    this.cache = pruned;
    await this.persist();
  }

  private async load(): Promise<PrefetchEntry[]> {
    if (this.cache) {
      return this.cache;
    }
    const data = await this.storage.get(STORAGE_KEY);
    const results: PrefetchEntry[] = Array.isArray(data?.[STORAGE_KEY]?.results)
      ? data[STORAGE_KEY].results
      : [];
    const cleaned = this.pruneArray(results);
    this.cache = cleaned;
    if (cleaned.length !== results.length) {
      await this.persist();
    }
    return cleaned;
  }

  private pruneArray(entries: PrefetchEntry[]): PrefetchEntry[] {
    const fresh = entries.filter((item) => !this.isExpired(item));
    return fresh.slice(0, this.maxEntries);
  }

  private isExpired(entry: PrefetchEntry): boolean {
    return this.now() - entry.generatedAt > this.ttlMs;
  }

  private async persist(): Promise<void> {
    await this.storage.set({
      [STORAGE_KEY]: {
        results: this.cache ?? [],
      } satisfies StoredResults,
    });
  }
}

export type { PrefetchEntry as PrefetchResult };
