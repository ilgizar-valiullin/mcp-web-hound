# Search Protocol — mcp-web-hound

For agents using search tools provided by this server. Adopt as-is or adapt.

## Zero Guessing [CRITICAL]
Search web_search before answering any factual question. Training data is stale by default. Only skip for pure logic, basic math, universally known constants. If unclear after search, state the gap.

## Pre-Call Plan
Before executing ANY search tool, emit a planning block. Search from 2-3 complementary angles upfront — don't wait until stuck to reformulate. Your query goes to a search engine, not a chat:
<plan>[Tool Name] | [Why searching] | [Keywords query]</plan>

## Tool Selection
- web_search — default for any external topic (libraries, APIs, docs, pricing, releases).
- github_search — open source repos, code examples, issues, users. Prefer for code patterns and real-world usage.
- gitlab_search — same scope as github_search, for GitLab.

Cite sources. If you can't confirm a claim, search first.

## Query Formatting
Exact quotes for error messages or code signatures. Prepend site:domain to narrow results. Use relative freshness terms like "latest api", "current version", "recent changes" — search engines handle recency ranking natively. Hardcoded years become stale and give wrong results.

