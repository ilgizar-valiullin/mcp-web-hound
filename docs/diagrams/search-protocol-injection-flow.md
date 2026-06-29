# Search Protocol Injection Flow

How search protocol content reaches the agent through MCP channels only (no file references).

## Connection-time injection (InitializeResult)

```mermaid
sequenceDiagram
    participant Agent
    participant MCPClient
    participant McpServer

    Agent->>MCPClient: start
    MCPClient->>McpServer: initialize
    McpServer-->>MCPClient: InitializeResult<br/>(instructions: full protocol)
    MCPClient->>Agent: system prompt<br/>+ instructions content
    Note over Agent: Zero Guessing [CRITICAL]<br/>Pre-Call Plan<br/>Tool Selection<br/>Query Formatting<br/>Source Quality
    MCPClient->>McpServer: tools/list
    McpServer-->>MCPClient: ToolsListResult<br/>(web_search, github_search, gitlab_search)
    Note over Agent: web_search: "Search the web ...<br/>NEVER rely on training data ..."<br/>github_search: "... Prefer for open source repos ..."<br/>gitlab_search: "... Prefer for GitLab repos ..."
```

## Call-time parameter injection (ToolsCall)

```mermaid
sequenceDiagram
    participant Agent
    participant MCPClient
    participant McpServer

    Agent->>MCPClient: call web_search(query="...")
    Note over Agent: query param description:<br/>"Keywords only -- strip filler.<br/>Use exact quotes ...<br/>Append year or 'latest' ...<br/>Prepend site:domain ..."
    MCPClient->>McpServer: tools/call<br/>{name: "web_search", arguments: {query}}
    McpServer-->>MCPClient: CallToolResult
    MCPClient-->>Agent: result
    Note over Agent: Source Quality rules apply post-hoc:<br/>prefer official docs, check red flags
```

## Injection channels summary

```
InitializeResult.instructions (server-level, always in context)
  ├── Zero Guessing [CRITICAL]
  ├── Pre-Call Plan
  ├── Tool Selection routing
  ├── Query Formatting (summary)
  └── Source Quality

Tool.description (per-tool, at selection time)
  ├── web_search + Zero Guessing reinforcement
  ├── github_search + selection guidance
  └── gitlab_search + selection guidance

Parameter.describe() (per-parameter, at invocation time)
  └── web_search.query → formatting rules
```
