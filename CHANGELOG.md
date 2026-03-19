# Changelog

## 0.1.0 (2026-03-19)

Initial release.

### Features

- **4-layer lattice architecture** — system, base, experience, live layers with static weight scoring
- **9 built-in domains** — sales, marketing, support, analytics, operations, social, general, platform, integrations (plus custom domains)
- **Keyword-based domain inference** — fast, deterministic classification with no LLM call
- **SHA-256 content deduplication** — unchanged content skips re-embedding automatically
- **Intent-driven retrieval** — query classification into domain + layer priority before vector search
- **Token-budgeted prompt composition** — structured domain sections with configurable limits
- **Injectable adapters** — `StorageAdapter` and `VectorAdapter` interfaces for any backend
- **In-memory adapters** — `InMemoryStorageAdapter` and `InMemoryVectorAdapter` with cosine similarity for testing and prototyping
- **7 entity indexers** — task, workflow, knowledge doc, learned pattern, memory, system best practice, integration spec
- **System layer seed** — 10 curated best practices for new agents
- **Connection auto-ingest** — template-based MCP server and SDK indexing
- **Zero runtime dependencies**
