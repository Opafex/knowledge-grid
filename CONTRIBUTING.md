# Contributing to @intelagent/knowledge-grid

Thanks for your interest in contributing. This guide covers everything you need to get started.

## Development setup

```bash
git clone https://github.com/opafex/knowledge-grid.git
cd knowledge-grid
npm install
npm run typecheck   # Verify TypeScript compiles
npm test            # Run all tests
npm run build       # Build to dist/
```

**Requirements:** Node 20+, TypeScript 5+

## Project structure

```
src/
  types.ts                  # All type definitions
  adapters.ts               # StorageAdapter + VectorAdapter interfaces
  adapters-memory.ts        # In-memory reference implementations
  domain-inference.ts       # Keyword-based domain classification
  indexing-pipeline.ts      # SHA-256 dedup + per-entity indexers
  grid-retriever.ts         # Intent classification + vector search + ranking
  grid-prompt-builder.ts    # Token-budgeted prompt composition
  system-layer-seed.ts      # Curated best practices
  connection-auto-ingest.ts # MCP/SDK auto-indexing
  index.ts                  # Public exports
  __tests__/                # Tests (node:test)
```

## Running tests

Tests use Node's built-in test runner with the in-memory adapters:

```bash
npm test
```

All tests should pass before submitting a PR. If you're adding a new feature, add tests for it.

## Making changes

### Adding a new entity indexer

1. Add the entity function in `indexing-pipeline.ts` (follow `indexTask` as a template)
2. Export it from `index.ts`
3. Add a test in `__tests__/knowledge-grid.test.ts`

### Adding a new domain

1. Add keywords to `DOMAIN_KEYWORDS` in `domain-inference.ts`
2. Add the domain name to `DEFAULT_GRID_DOMAINS` in `types.ts`
3. **Important:** Update the platform's copy too (see the `SYNC:` comment in `types.ts`)

### Implementing a new adapter

Implement `StorageAdapter` and/or `VectorAdapter` from `adapters.ts`. See `adapters-memory.ts` for a complete reference implementation.

We welcome adapter packages for popular backends (pgvector, Pinecone, Qdrant, ChromaDB, SQLite, etc.) as separate npm packages.

## Code style

- TypeScript strict mode
- No external runtime dependencies (keep the package zero-dep)
- `console.warn`/`console.error` for logging (no logging library)
- Explicit types on `match()` results: `const matches: string[] = str.match(...) || []`
- No ES2018+ regex flags (use `[\s\S]` instead of `s` flag)

## Pull requests

1. Fork the repo and create a branch from `main`
2. Make your changes with tests
3. Run `npm run typecheck && npm test`
4. Open a PR with a clear description of what and why
5. Keep PRs focused — one feature or fix per PR

## Reporting issues

Open an issue on GitHub with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Node version and OS

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
