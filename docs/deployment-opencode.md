# Deployment Guide — OpenCode

## Prerequisites

- **Node.js** >= 20
- **npm** (comes with Node.js)

## Quick Install (npx)

No install needed — npx fetches and runs the latest version automatically.

```bash
# Verify it works
npx mcp-web-hound --help
```

## Configuration

Config lives in two places:

| Tier | File | Purpose |
|------|------|---------|
| **Server** | `~/.config/mcp-web-hound/.env` | Main config — written by `configure` tool |
| **Project** | `<project>/.env` | Optional per-folder overrides (individual keys only) |

The server config is auto-created from defaults on first `npx mcp-web-hound` run.

### Set API keys

```bash
# Interactive (TUI) — writes to server .env
npx mcp-web-hound-configure

# Machine-readable (for agents) — writes to server .env
npx mcp-web-hound-configure --json set BRAVE_API_KEY=your_key_here
npx mcp-web-hound-configure --json set TAVILY_API_KEY=your_key_here
npx mcp-web-hound-configure --json set GITHUB_TOKEN=ghp_xxx
```

To see all available settings:

```bash
npx mcp-web-hound-configure --json get
```

Startpage, DuckDuckGo, Brave Web, and Bing work without keys (HTML scraping).

## Register in OpenCode

Add to `~/.config/opencode/opencode.json` under `mcp`:

```json
"web_search": {
  "type": "local",
  "command": ["npx.cmd", "-y", "mcp-web-hound"],
  "enabled": true
}
```

Or via CLI:

```bash
opencode mcp add web_search -- npx.cmd -y mcp-web-hound
```

## Alternative: Local Install

```bash
git clone https://github.com/ilgizar-valiullin/mcp-web-hound.git
cd mcp-web-hound
npm install
npm run build
```

## Search Protocol Setup

The search protocol (Zero Guessing, Pre-Call Plan, Tool Selection, Query Formatting, Source Quality) is embedded in the server itself and delivered via MCP's `InitializeResult.instructions`.

### OpenCode v1.17.10+

**No additional config needed.** The protocol is automatically injected into the agent's system prompt when the MCP server connects. The agent will see it as:

```
Instructions from: MCP server mcp-web-hound
...
```

If you have search-related instructions in other system prompt files (`free-mode-prompt.md`, `AGENTS.md`, etc.), remove them to avoid conflicts.

### OpenCode v1.17.7 and older

These versions do not support MCP server instructions. Add the protocol manually via `opencode.json`:

```json
"instructions": [
  "free-mode-prompt.md",
  "AGENTS.md",
  ".ai-workspace.md",
  "./search-protocol.md"
]
```

The path is relative to the project root (`D:\Projects\mcp_search`). You can also use an absolute path.

> ⚠️ If your agent has search instructions in other prompts, remove them and keep only this one reference to avoid conflicting instructions.

## Verify

Restart OpenCode, then check the tool is available:

```
web_search("hello world")
```

Expected response — list of search results.

## Troubleshooting

**"No search providers configured"**  
Check the server `.env` via `mcp-web-hound-configure --json get` — at least one provider must be enabled. DDG and Bing need no key, just set:
```
DDG_ENABLED=true
BING_ENABLED=true
```

## Search Log Export

If `SEARCH_LOG_ENABLED=true` is set, every `web_search` call is logged to the SQLite database.

Export training data:

```bash
# All entries
npx mcp-web-hound-export-logs

# Training subset (only entries where agent reported usage)
npx mcp-web-hound-export-logs --export --jsonl > training-data.jsonl

# See full options
npx mcp-web-hound-export-logs --help
```

**Build errors**  
Ensure Node.js >= 20:
```bash
node --version
```

**Semantic cache disabled**  
Semantic search (`SEMANTIC_ENABLED=true`) requires `@xenova/transformers` (~120MB download on first use). Installed as optional dependency.

**Instructions not appearing in agent context**  
Check your OpenCode version: `opencode --version`. If < 1.17.10, use the manual `search-protocol.md` method above.
