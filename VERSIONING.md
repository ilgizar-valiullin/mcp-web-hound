# Versioning

This project follows **Semantic Versioning 2.0.0** (`MAJOR.MINOR.PATCH`).

## Rules

- **MAJOR** — breaking change in MCP tool schema (tool name, required params removed, response shape change)
- **MINOR** — new provider, new MCP tool, new feature (backward-compatible)
- **PATCH** — provider fix, config fix, dependency bump, docs, refactor, tests

## Pre-release

- `1.0.0-alpha.1` — prototyping
- `1.0.0-beta.1` — feature-complete, testing
- `1.0.0-rc.1` — release candidate

## How to bump

```bash
# Patch
npm version patch
git push --follow-tags

# Minor
npm version minor
git push --follow-tags

# Major
npm version major
git push --follow-tags
```

## Current

`1.9.3` — npm publish workflow, README inline setup, preferGlobal, default.env with all fields.
