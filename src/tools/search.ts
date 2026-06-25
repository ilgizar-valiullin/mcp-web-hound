import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SearchRequestSchema } from '../utils/types.js';
import { config } from '../utils/config.js';
import { Orchestrator } from '../search/orchestrator.js';
import { IntentClassifier } from '../search/intent-classifier.js';
import { logger } from '../utils/logger.js';

export function registerSearchTool(server: McpServer, orchestrator: Orchestrator, classifier: IntentClassifier): void {
  server.registerTool(
    'search',
    {
      description: 'Search the web for documentation, code examples, and other resources',
      inputSchema: SearchRequestSchema,
    },
    async (args) => {
      try {
        const request = SearchRequestSchema.parse(args);
        const intent = config.INTENT_CLASSIFICATION_ENABLED
          ? await classifier.classify(request.query)
          : request.intent;

        logger.info({ query: request.query, intent, classification: config.INTENT_CLASSIFICATION_ENABLED }, 'Search requested');

        const response = await orchestrator.search({ ...request, intent });

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
