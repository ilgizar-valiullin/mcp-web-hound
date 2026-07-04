# Search Protocol — mcp-web-hound

For agents using search tools provided by this server. Adopt as-is or adapt.

## Zero Guessing [CRITICAL]
Search web_search before answering any factual question. Training data is stale by default. Only skip for pure logic, basic math, universally known constants. Search from a few angles until confident; if unclear, state the gap.

## Pre-Call Plan
Before executing ANY search tool, emit a strict planning block:
<plan>[Tool Name] | [Target Fact] | [Optimized Query]</plan>

## Tool Selection
- web_search — default for any external topic (libraries, APIs, docs, pricing, releases).
- github_search — open source repos, code examples, issues, users. Prefer for code patterns and real-world usage.
- gitlab_search — same scope as github_search, for GitLab.

Cite sources. If you can't confirm a claim, search first.

## Query Formatting
Keywords only (strip filler). Exact quotes for error messages or code signatures. Prepend site:domain to narrow results. Use relative freshness terms like "latest api", "current version", "recent changes" — search engines handle recency ranking natively. Hardcoded years become stale and give wrong results.

## Source Quality
Prefer: official docs → official repos → issues/discussions → release notes → technical articles → forums (supporting only).
Red flags: outdated versions without migration notes, unofficial sources for critical functionality, conflicting info without clear resolution.
