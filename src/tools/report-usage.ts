import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SqliteCache } from '../cache/sqlite.js';
import { logger } from '../utils/logger.js';

const ReportUsageSchema = z.object({
  search_id: z.string().min(1).describe('Search ID from the search response'),
  used_doc_ids: z.array(z.string()).min(1).describe('Doc IDs that were actually cited in the agent\'s final answer'),
});

export function registerReportUsageTool(server: McpServer, cache: SqliteCache): void {
  server.registerTool(
    'report_search_usage',
    {
      description: 'Report which search results were actually cited in the agent\'s final answer. Call this after you have formulated your response using web_search results.',
      inputSchema: ReportUsageSchema,
    },
    async (args) => {
      try {
        const parsed = ReportUsageSchema.parse(args);

        const updated = cache.updateSearchLogUsage(parsed.search_id, parsed.used_doc_ids);

        if (!updated) {
          logger.warn({ searchId: parsed.search_id }, 'Search ID not found in logs');
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  error: `Search ID "${parsed.search_id}" not found in logs. Make sure to call this after web_search.`,
                }, null, 2),
              },
            ],
          };
        }

        logger.info({ searchId: parsed.search_id, usedDocs: parsed.used_doc_ids.length }, 'Usage signal recorded');

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                search_id: parsed.search_id,
                used_count: parsed.used_doc_ids.length,
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
  );
}
