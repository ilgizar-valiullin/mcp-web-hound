import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const GitHubSearchSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty'),
  type: z.enum(['repositories', 'code', 'issues', 'users']).default('repositories'),
  language: z.string().optional(),
  stars: z.string().optional(),
  per_page: z.number().int().min(1).max(100).default(15),
  page: z.number().int().min(1).default(1),
});

interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  topics: string[];
  updated_at: string;
}

interface GitHubCodeItem {
  name: string;
  path: string;
  html_url: string;
  repository: { full_name: string; html_url: string };
}

interface GitHubIssue {
  title: string;
  html_url: string;
  state: string;
  labels: Array<{ name: string }>;
  comments: number;
  updated_at: string;
}

interface GitHubUser {
  login: string;
  html_url: string;
  userType: string;
  bio: string | null;
  public_repos: number;
  followers: number;
}

function buildQuery(query: string, language?: string, stars?: string): string {
  const parts = [query];
  if (language) parts.push(`language:${language}`);
  if (stars) parts.push(`stars:${stars}`);
  return parts.join('+');
}

export function registerGitHubSearchTool(server: McpServer): void {
  server.registerTool(
    'github_search',
    {
      description: 'Search GitHub repositories, code, issues, or users',
      inputSchema: GitHubSearchSchema,
    },
    async (args) => {
      try {
        const { query, type: searchType, language, stars, per_page, page } = GitHubSearchSchema.parse(args);
        const q = buildQuery(query, language, stars);

        logger.info({ query: q, type: searchType }, 'GitHub search requested');

        const url = new URL(`https://api.github.com/search/${searchType}`);
        url.searchParams.set('q', q);
        url.searchParams.set('per_page', String(per_page));
        url.searchParams.set('page', String(page));

        const headers: Record<string, string> = {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'search-mcp/1.0',
        };

        if (config.GITHUB_TOKEN) {
          headers.Authorization = `Bearer ${config.GITHUB_TOKEN}`;
        }

        const response = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(15000) });

        if (!response.ok) {
          const remaining = response.headers.get('X-RateLimit-Remaining') ?? '?';
          const reset = response.headers.get('X-RateLimit-Reset') ?? '?';
          throw new Error(
            `GitHub API ${response.status} (rate limit remaining: ${remaining}, resets at: ${reset})`,
          );
        }

        const body = (await response.json()) as { total_count: number; items: unknown[] };

        const remaining = response.headers.get('X-RateLimit-Remaining') ?? '?';
        logger.debug({ total: body.total_count, remaining }, 'GitHub search results');

        let results: Record<string, unknown>[] = [];

        if (searchType === 'repositories') {
          results = (body.items as GitHubRepo[]).map((r) => ({
            name: r.full_name,
            url: r.html_url,
            description: r.description,
            stars: r.stargazers_count,
            language: r.language,
            topics: r.topics,
            updated: r.updated_at,
          }));
        } else if (searchType === 'code') {
          results = (body.items as GitHubCodeItem[]).map((r) => ({
            file: r.name,
            path: r.path,
            url: r.html_url,
            repo: r.repository.full_name,
            repo_url: r.repository.html_url,
          }));
        } else if (searchType === 'issues') {
          results = (body.items as GitHubIssue[]).map((r) => ({
            title: r.title,
            url: r.html_url,
            state: r.state,
            labels: r.labels.map((l) => l.name),
            comments: r.comments,
            updated: r.updated_at,
          }));
        } else if (searchType === 'users') {
          results = (body.items as GitHubUser[]).map((r) => ({
            login: r.login,
            url: r.html_url,
            type: r.userType,
            bio: r.bio,
            public_repos: r.public_repos,
            followers: r.followers,
          }));
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  total_count: body.total_count,
                  page,
                  per_page,
                  rate_limit_remaining: remaining,
                  results,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'GitHub search tool error');
        return {
          content: [
            {
              type: 'text' as const,
              text: `GitHub search failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
