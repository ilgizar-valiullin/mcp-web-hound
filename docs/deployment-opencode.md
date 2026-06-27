# Deployment Guide — OpenCode

> ⚠️ **Search protocol is in Testing Stage.** The `search-protocol.md` is a draft — adapt to your agent's behavior. It may change.

## Prerequisites

- **Node.js** >= 20
- **npm** (comes with Node.js)

## Installation

```bash
# Clone
git clone https://github.com/ilgizar-valiullin/mcp_search.git
cd mcp_search

# Install dependencies
npm install

# Build
npm run build
```

## Configuration

```bash
cp .env.example .env
```

Edit `.env` — fill in API keys for the providers you want:

| Provider | Key | Where to get |
|----------|-----|-------------|
| Brave API | `BRAVE_API_KEY` | https://api.search.brave.com |
| Tavily | `TAVILY_API_KEY` | https://tavily.com |
| Exa | `EXA_API_KEY` | https://exa.ai |
| Firecrawl | `FIRECRAWL_API_KEY` | https://firecrawl.dev |

Startpage, DuckDuckGo, Brave Web, and Bing work without keys (HTML scraping).

## Register in OpenCode

Add to `~/.config/opencode/opencode.json` under `mcp`:

```json
"search_mcp": {
  "type": "local",
  "command": ["node", "/absolute/path/to/mcp_search/dist/index.js"],
  "enabled": true
}
```

Or via CLI:

```bash
opencode mcp add search_mcp -- node /absolute/path/to/mcp_search/dist/index.js
```

## Add Search Protocol to Instructions

OpenCode reads `instructions` from `opencode.json`. Add the search protocol so the agent knows how to use the tools effectively:

```json
"instructions": [
  "...",
  "/absolute/path/to/mcp_search/search-protocol.md"
]
```

> ⚠️ **Testing Stage.** The search protocol is a draft — adapt and tweak as needed. It may change.

### Removing Search From Other Prompts

If your agent has search instructions in other system prompts (e.g., `free-mode-prompt.md`, `CLAUDE.md`, `AGENTS.md`), remove them and rely solely on `search-protocol.md`. This avoids conflicting instructions and ensures consistent search behavior.

## Verify

Restart OpenCode, then check the tool is available:

```
search("hello world")
```

Expected response — list of search results.

## Troubleshooting

**"No search providers configured"**  
Check `.env` — at least one provider must be enabled. DDG and Bing need no key, just set:
```
DDG_ENABLED=true
BING_ENABLED=true
```

**Build errors**  
Ensure Node.js >= 20:
```bash
node --version
```

**Semantic cache disabled**  
Semantic search (`SEMANTIC_ENABLED=true`) requires `@xenova/transformers` (~120MB download on first use). Installed as optional dependency.
