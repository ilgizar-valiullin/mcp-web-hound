import { logger } from '../utils/logger.js';
import { validators, type ToolDef } from '../mcp/schemas.js';

/** Thin adapter: usage write runs inside the hot worker (single DB owner). */
export function makeReportUsageTool(
  reportFn: (search_id: string, used_doc_ids: string[]) => Promise<boolean>,
): ToolDef {
  return {
    name: 'report_search_usage',
    description: 'Report which search results were actually cited in the agent\'s final answer. Call this after you have formulated your response using web_search results.',
    inputSchema: {
      type: 'object',
      properties: {
        search_id: { type: 'string', minLength: 1, description: 'Search ID from the search response' },
        used_doc_ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'Doc IDs that were actually cited in the agent\'s final answer',
        },
      },
      required: ['search_id', 'used_doc_ids'],
    },
    run: async (args) => {
      try {
        const search_id = validators.reqString(args, 'search_id');
        const used_doc_ids = validators.optStringArray(args, 'used_doc_ids', 1);

        const updated = await reportFn(search_id, used_doc_ids);

        if (!updated) {
          logger.warn({ searchId: search_id }, 'Search ID not found in logs');
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  error: `Search ID "${search_id}" not found in logs. Make sure to call this after web_search.`,
                }, null, 2),
              },
            ],
          };
        }

        logger.info({ searchId: search_id, usedDocs: used_doc_ids.length }, 'Usage signal recorded');

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                search_id,
                used_count: used_doc_ids.length,
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'report_search_usage error');
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: err instanceof Error ? err.message : String(err),
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  };
}
