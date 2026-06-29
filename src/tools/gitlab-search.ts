import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
  description: string | null;
  star_count: number;
  last_activity_at: string;
}

interface GitLabIssue {
  id: number;
  title: string;
  web_url: string;
  state: string;
  labels: string[];
  created_at: string;
  updated_at: string;
}

interface GitLabMR {
  id: number;
  title: string;
  web_url: string;
  state: string;
  source_branch: string;
  target_branch: string;
  author: { name: string };
  created_at: string;
  updated_at: string;
}

interface GitLabBlob {
  id: number;
  filename: string;
  ref: string;
  basename: string;
  data: string;
  project: { id: number; name: string; path_with_namespace: string; web_url: string };
}

export function registerGitLabSearchTool(server: McpServer): void {
  const schema = z.object({
    query: z.string().min(1, 'Query cannot be empty'),
    scope: z.enum(['projects', 'issues', 'merge_requests', 'blobs']).default('projects'),
    page: z.number().int().min(1).default(1),
  });

  server.registerTool(
    'gitlab_search',
    {
      description: 'Search GitLab projects, issues, merge requests, or code (blobs). Prefer for GitLab repos, code patterns, and real-world usage examples.',
      inputSchema: schema,
    },
    async (args) => {
      try {
        const { query, scope, page } = schema.parse(args);

        logger.info({ query, scope }, 'GitLab search requested');

        const url = new URL('https://gitlab.com/api/v4/search');
        url.searchParams.set('scope', scope);
        url.searchParams.set('search', query);
        url.searchParams.set('per_page', '10');
        url.searchParams.set('page', String(page));

        const headers: Record<string, string> = {
          'User-Agent': 'mcp-web-hound/1.0',
        };

        if (config.GITLAB_TOKEN) {
          headers['PRIVATE-TOKEN'] = config.GITLAB_TOKEN;
        }

        const response = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(15000) });

        if (!response.ok) {
          throw new Error(`GitLab API ${response.status}: ${response.statusText}`);
        }

        const body = (await response.json()) as unknown[];
        const totalHeader = response.headers.get('X-Total') ?? response.headers.get('X-Total-Pages');
        logger.debug({ results: body.length, total: totalHeader }, 'GitLab search results');

        let results: Record<string, unknown>[] = [];

        if (scope === 'projects') {
          results = (body as GitLabProject[]).map((r) => ({
            name: r.path_with_namespace,
            url: r.web_url,
            description: r.description,
            stars: r.star_count,
            updated: r.last_activity_at,
          }));
        } else if (scope === 'issues') {
          results = (body as GitLabIssue[]).map((r) => ({
            title: r.title,
            url: r.web_url,
            state: r.state,
            labels: r.labels,
            created: r.created_at,
            updated: r.updated_at,
          }));
        } else if (scope === 'merge_requests') {
          results = (body as GitLabMR[]).map((r) => ({
            title: r.title,
            url: r.web_url,
            state: r.state,
            source_branch: r.source_branch,
            target_branch: r.target_branch,
            author: r.author.name,
            created: r.created_at,
            updated: r.updated_at,
          }));
        } else if (scope === 'blobs') {
          results = (body as GitLabBlob[]).map((r) => ({
            file: r.filename,
            ref: r.ref,
            snippets: r.data,
            project: r.project.path_with_namespace,
            project_url: r.project.web_url,
          }));
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  total: body.length,
                  page,
                  results,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'GitLab search tool error');
        return {
          content: [
            {
              type: 'text' as const,
              text: `GitLab search failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
