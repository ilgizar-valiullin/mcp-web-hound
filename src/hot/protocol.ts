import type { CacheStats, ProviderStats, SearchResponse } from '../utils/types.js';

/** Operations served by the hot child process (single owner of DB/vec/router/models). */
export type HotOp = 'ping' | 'stats' | 'search' | 'status' | 'reportUsage' | 'shutdown';

export interface HotSearchArgs {
  query: string;
}

export interface HotReportUsageArgs {
  search_id: string;
  used_doc_ids: string[];
}

export interface HotStatusResult {
  cache: CacheStats;
  providers: ProviderStats[];
  budget: {
    searches_remaining: number;
    fetches_remaining: number;
  };
  models: {
    embedding_loaded: boolean;
    nli_loaded: boolean;
  };
}

export type HotOpResult =
  | { op: 'ping'; pid: number; mock: boolean }
  | { op: 'stats'; pid: number; mock: boolean; embeddingLoaded: boolean; nliLoaded: boolean }
  | { op: 'search'; response: SearchResponse }
  | { op: 'status'; status: HotStatusResult }
  | { op: 'reportUsage'; updated: boolean }
  | { op: 'shutdown' };
