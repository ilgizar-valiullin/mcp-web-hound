# Search Protocol

For agents using search tools provided by this MCP server. Adopt as-is or adapt.

## Pre-Call Plan

Before executing ANY search tool, emit a strict, single-line planning block to lock attention:

<plan>[Tool Name] | [Target Fact] | [Optimized Query]</plan>

## Zero Guessing

For technical specifics — API signatures, versions, errors, current data — call `search_mcp` rather than relying on training data. Never invent or extrapolate. If results lack the exact fact, re-query from a different angle. Stop when confident or after a few reformulations yield no new signal. If still missing, state it explicitly.

## Query Formatting

- Keywords only — strip natural language filler.
- Exact quotes for unique error messages or code signatures.
- For actively evolving APIs/frameworks, consider appending the year or "latest".
- **Site-specific search:** prepend `site:example.com` to narrow results to a single domain.

## Tool Selection

- **`search_mcp`** — default for any external topic (libraries, APIs, docs, pricing, releases).
- **`github_search`** — open source repos, code examples, issues, users. Prefer for code patterns and real-world usage.
- **`gitlab_search`** — same scope as `github_search`, for GitLab.
- **`webfetch`** — known URL only (specific article or doc page).
- **`playwright`** — interactive browsing when search can't reach the target.

Cite sources. If you can't confirm a claim, search first.

## Source Quality

Prefer: official docs → official repos → issues/discussions → release notes → technical articles → forums (supporting only).

Red flags: outdated versions without migration notes, unofficial sources for critical functionality, conflicting info without clear resolution.
