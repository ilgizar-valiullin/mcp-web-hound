# Reranking

## Overview

After receiving results from providers (one or multiple), final reranking is applied. The goal is to sort results by actual usefulness to the agent, not by raw search engine position.

## Scoring Formula

```
final_score = w1 * semantic_similarity
            + w2 * domain_quality
            + w3 * freshness_score
            + w4 * position_score
```

### Default Weights

| Factor | Weight | Description |
|--------|--------|-------------|
| `semantic_similarity` | 0.35 | Cosine similarity of query embedding and snippet |
| `domain_quality` | 0.30 | Domain quality (predefined list) |
| `freshness_score` | 0.15 | How recent the result is |
| `position_score` | 0.20 | Position in original provider results |

### Intent-Based Weight Adjustment

| Intent | semantic | domain | freshness | position |
|--------|----------|--------|-----------|----------|
| `web` | 0.35 | 0.25 | 0.15 | 0.25 |
| `docs` | 0.30 | **0.40** | 0.10 | 0.20 |
| `github` | 0.25 | **0.35** | 0.20 | 0.20 |
| `news` | 0.20 | 0.15 | **0.45** | 0.20 |

---

## Scoring Components

### 1. Semantic Similarity (0.0 – 1.0)

Cosine similarity between query embedding and result snippet/title embedding.

```typescript
function semanticScore(queryEmbedding: number[], resultText: string): number {
  const resultEmbedding = embeddingService.embed(resultText);
  return cosineSimilarity(queryEmbedding, resultEmbedding);
}
```

**Without embeddings:** `semantic_similarity = 0.5` for all results.

### 2. Domain Quality (0.0 – 1.0)

Predefined domain scoring tailored for development.

```typescript
const DOMAIN_SCORES: Record<string, number> = {
  // Tier S — official sources
  "github.com":           0.95,
  "docs.github.com":      0.95,
  "developer.mozilla.org": 0.95,
  "tc39.es":              0.90,

  // Tier A — documentation
  "readthedocs.io":       0.90,
  "docs.python.org":      0.90,
  "docs.rs":              0.90,
  "pkg.go.dev":           0.90,
  "nodejs.org":           0.85,
  "react.dev":            0.85,
  "nextjs.org":           0.85,
  "vuejs.org":            0.85,
  "angular.dev":          0.85,
  "svelte.dev":           0.85,

  // Tier B — package managers
  "npmjs.com":            0.85,
  "pypi.org":             0.85,
  "crates.io":            0.85,
  "rubygems.org":         0.80,
  "packagist.org":        0.80,

  // Tier C — Q&A and tutorials
  "stackoverflow.com":    0.80,
  "dev.to":               0.70,
  "medium.com":           0.55,
  "hashnode.dev":         0.65,
  "freecodecamp.org":     0.70,

  // Tier D — general
  "wikipedia.org":        0.60,
  "w3schools.com":        0.50,
};

// Unknown domains: 0.50
// Subdomains: look up parent domain
```

**Domain patterns (regex):**
```typescript
const DOMAIN_PATTERNS: Array<[RegExp, number]> = [
  [/^docs\./, 0.85],              // docs.* — documentation sites
  [/^developer\./, 0.85],         // developer.* — dev portals
  [/^api\./, 0.80],               // api.* — API docs
  [/\.readthedocs\.io$/, 0.90],   // *.readthedocs.io
  [/\.github\.io$/, 0.75],        // *.github.io — project pages
];
```

### 3. Freshness Score (0.0 – 1.0)

Based on the result's `published_date`. If unknown — neutral score.

```typescript
function freshnessScore(publishedDate: string | null): number {
  if (!publishedDate) return 0.5;  // Neutral

  const ageHours = (Date.now() - new Date(publishedDate).getTime()) / 3600000;

  if (ageHours < 24)    return 1.0;   // Last day
  if (ageHours < 168)   return 0.9;   // Last week
  if (ageHours < 720)   return 0.8;   // Last month
  if (ageHours < 2160)  return 0.7;   // Last 3 months
  if (ageHours < 8760)  return 0.5;   // Last year
  return 0.3;                          // Older than a year
}
```

### 4. Position Score (0.0 – 1.0)

Normalized position in the original provider results.

```typescript
function positionScore(position: number, totalResults: number): number {
  // Linear normalization: first position = 1.0, last = ~0.1
  return Math.max(0.1, 1.0 - (position / totalResults) * 0.9);
}
```

---

## Deduplication

Before reranking, results are deduplicated by URL:

```typescript
function deduplicateResults(results: ProviderResult[]): ProviderResult[] {
  const seen = new Map<string, ProviderResult>();

  for (const result of results) {
    const normalizedUrl = normalizeUrl(result.url);

    if (!seen.has(normalizedUrl)) {
      seen.set(normalizedUrl, result);
    } else {
      // Keep result with better (lower) position
      const existing = seen.get(normalizedUrl)!;
      if (result.raw_position < existing.raw_position) {
        seen.set(normalizedUrl, result);
      }
    }
  }

  return Array.from(seen.values());
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  // Remove trailing slash, utm_ params, www.
  parsed.hash = "";
  parsed.hostname = parsed.hostname.replace(/^www\./, "");
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.startsWith("utm_") || key === "ref") {
      parsed.searchParams.delete(key);
    }
  }
  return parsed.toString().replace(/\/$/, "");
}
```

## Example

```
Query: "react server components docs"
Intent: docs

Results before reranking:
1. medium.com/...        (position: 1, snippet sim: 0.72)
2. react.dev/...         (position: 2, snippet sim: 0.91)
3. github.com/react/...  (position: 3, snippet sim: 0.88)
4. stackoverflow.com/... (position: 4, snippet sim: 0.65)
5. dev.to/...            (position: 5, snippet sim: 0.70)

Scoring (docs intent: semantic=0.30, domain=0.40, freshness=0.10, position=0.20):

1. react.dev:        0.30*0.91 + 0.40*0.85 + 0.10*0.8 + 0.20*0.82 = 0.857
2. github.com:       0.30*0.88 + 0.40*0.95 + 0.10*0.7 + 0.20*0.74 = 0.862
3. stackoverflow:    0.30*0.65 + 0.40*0.80 + 0.10*0.5 + 0.20*0.56 = 0.677
4. medium.com:       0.30*0.72 + 0.40*0.55 + 0.10*0.9 + 0.20*1.00 = 0.626  (was #1!)
5. dev.to:           0.30*0.70 + 0.40*0.70 + 0.10*0.6 + 0.20*0.38 = 0.626

After reranking: github.com → react.dev → stackoverflow → medium → dev.to
```
