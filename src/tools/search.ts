import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Orchestrator } from '../search/orchestrator.js';
import { IntentClassifier } from '../search/intent-classifier.js';
import { logger } from '../utils/logger.js';

const SearchRequestSchema = z.object({
  query: z.string().min(1).describe('Keywords only — strip filler. Use exact quotes for error messages or code signatures. Prepend site:domain to narrow to a specific source. Never hardcode a year — if temporal context matters, state the need naturally (e.g. "latest api", "current version", "recent changes"). Search engines handle freshness.'),

});

export function registerSearchTool(server: McpServer, orchestrator: Orchestrator, classifier: IntentClassifier): void {
  server.registerTool(
    'web_search',
    {
      description: 'Search the web for real-time data, current events, documentation, and up-to-date factual information. NEVER rely on training data for technical specifics — always search first. See server instructions for full protocol.',
      inputSchema: SearchRequestSchema,
    },
    async (args) => {
      try {
        const parsed = SearchRequestSchema.parse(args);
        const classification = await classifier.classify(parsed.query);
        const intent = classification.intent;

        logger.info({ query: parsed.query, intent }, 'Search requested');

        const response = await orchestrator.search({
          query: parsed.query,
          intent,
        });

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
  );
}
