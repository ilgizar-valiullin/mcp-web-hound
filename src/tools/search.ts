import type { SearchResponse } from '../utils/types.js';
import { logger } from '../utils/logger.js';
import { validators, type ToolDef } from '../mcp/schemas.js';

const QUERY_DESCRIPTION = 'Keywords only — strip filler. Use exact quotes for error messages or code signatures. Prepend site:domain to narrow to a specific source. Never hardcode a year — if temporal context matters, state the need naturally (e.g. "latest api", "current version", "recent changes"). Search engines handle freshness.';

/** Thin adapter: classification + orchestration run inside the hot worker. */
export function makeSearchTool(searchFn: (query: string) => Promise<SearchResponse>): ToolDef {
  return {
    name: 'web_search',
    description: 'Search the web for real-time data, current events, documentation, and up-to-date factual information. NEVER rely on training data for technical specifics — always search first. See server instructions for full protocol.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: QUERY_DESCRIPTION },
      },
      required: ['query'],
    },
    run: async (args) => {
      try {
        const query = validators.reqString(args, 'query');

        logger.info({ query }, 'Search requested');

        const response = await searchFn(query);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'Search tool error');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  };
}
