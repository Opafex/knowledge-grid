# @intelagent/knowledge-grid

Better context for AI agents. A layered knowledge grid that gives your agent structured, relevant context — so it performs better on every interaction. Zero dependencies.

```
npm install @intelagent/knowledge-grid
```

## Why this exists

AI agents are only as good as the context they receive. Most RAG systems dump flat vector results into the prompt — no structure, no priority, no awareness of what *kind* of knowledge is being retrieved. The result is diluted context and inconsistent agent behaviour.

**Knowledge Grid** organises agent knowledge into a **4-layer lattice** crossed with **9 domains**, giving your agent structured context that distinguishes live state from learned experience from reference docs from system knowledge. The agent gets the right context, in the right priority, every time — and performs better because of it.

```
             sales  marketing  support  analytics  operations  social  general  platform  integrations
           ┌────────────────────────────────────────────────────────────────────────────────────────────┐
  system   │  Platform best practices, collective intelligence, curated seed knowledge                 │
  base     │  Documents, integration specs, API references, tool capabilities                          │
  experience│  Learned patterns, domain rules, memories, approval history                              │
  live     │  Current tasks, active workflows, dashboard state, recent events                          │
           └────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Each layer has a different weight** during retrieval — live data ranks highest, system knowledge ranks lowest — so agents naturally prioritise actionable context over static reference material.

## Quick start

```ts
import {
  initKnowledgeGrid,
  InMemoryStorageAdapter,
  InMemoryVectorAdapter,
  indexTask,
  indexKnowledgeDoc,
  searchGrid,
  composeGridContext,
  renderGridContext,
} from '@intelagent/knowledge-grid';

// 1. Initialise with adapters (in-memory for dev, bring your own for production)
initKnowledgeGrid({
  storage: new InMemoryStorageAdapter(),
  vector: new InMemoryVectorAdapter(),
});

// 2. Index some knowledge
await indexTask('agent-1', {
  id: 'task-1',
  title: 'Review Q1 sales pipeline',
  description: 'Audit all open deals and flag at-risk opportunities',
  status: 'in_progress',
  priority: 'high',
});

await indexKnowledgeDoc('agent-1', {
  id: 'doc-1',
  filename: 'sales-playbook.md',
  content: 'When a deal is at risk, schedule a check-in within 48 hours...',
});

// 3. Search with intent-driven retrieval
const results = await searchGrid({
  agentId: 'agent-1',
  query: 'which deals need attention?',
});

// 4. Compose token-budgeted prompt context
const context = composeGridContext(results.results, results.queryIntent);
const promptSection = renderGridContext(context);

// Inject `promptSection` into your LLM system prompt
```

## Architecture

### Layers (vertical axis)

| Layer | What lives here | Default weight |
|-------|-----------------|----------------|
| **live** | Current tasks, active workflows, recent events | 1.0 |
| **experience** | Learned patterns, domain rules, memories | 0.85 |
| **base** | Documents, integration specs, tool capabilities | 0.7 |
| **system** | Platform best practices, curated seed knowledge | 0.5 |

### Domains (horizontal axis)

9 built-in: `sales`, `marketing`, `support`, `analytics`, `operations`, `social`, `general`, `platform`, `integrations`

Custom domains are supported — pass any string as a domain and it participates in the same retrieval and classification system.

### Retrieval pipeline

```
Query → Domain inference (keyword, no LLM) → Layer priority → Vector search → Rank by:
  finalScore = similarity × layerWeight × confidence × domainBoost
```

1. **`classifyQueryIntent(query)`** — identifies relevant domains and layer priority from keywords
2. **`searchGrid(options)`** — embeds query, searches the vector collection, ranks results
3. **`composeGridContext(results, intent)`** — organises results into token-budgeted domain sections
4. **`renderGridContext(context)`** — renders to markdown for prompt injection

### Indexing pipeline

Each entity is:
1. Converted to a text representation
2. SHA-256 hashed for deduplication (unchanged content skips re-embedding)
3. Stored via your `StorageAdapter`
4. Embedded and stored via your `VectorAdapter`

Built-in indexers: `indexTask`, `indexWorkflow`, `indexKnowledgeDoc`, `indexLearnedPattern`, `indexMemory`, `indexSystemBestPractice`

Connection indexers: `autoIngestMCPServer`, `autoIngestSDK`

## Adapters

The grid doesn't depend on any database or vector store. You provide two adapters:

### StorageAdapter

Stores grid entry rows (the metadata, not the vectors).

```ts
interface StorageAdapter {
  findEntry(agentId: string, sourceType: string, sourceId: string): Promise<GridEntryRow | null>;
  createEntry(data: Omit<GridEntryRow, 'id' | 'access_count' | 'last_accessed' | 'created_at' | 'updated_at'>): Promise<GridEntryRow>;
  updateEntry(id: string, data: Partial<GridEntryRow>): Promise<GridEntryRow>;
  deleteEntry(id: string): Promise<void>;
  findEntriesByIds(ids: string[]): Promise<GridEntryRow[]>;
  findEntriesBySourceType(agentId: string, sourceType: string, options?: { limit?: number }): Promise<GridEntryRow[]>;
  incrementAccessCount(ids: string[]): Promise<void>;
  deleteEntriesByPrefix(agentId: string, sourceIdPrefix: string): Promise<void>;
}
```

### VectorAdapter

Handles embedding generation and similarity search.

```ts
interface VectorAdapter {
  generateEmbedding(text: string): Promise<number[] | null>;
  isEmbeddingAvailable(): boolean;
  storeEmbedding(collection: string, embedding: number[], metadata: Record<string, unknown>): Promise<string>;
  deleteEmbeddings(collection: string, metadataFilter: Record<string, unknown>): Promise<void>;
  searchEmbeddings(options: {
    collection: string;
    queryVector: number[];
    topK: number;
    minScore: number;
    metadataFilters?: Record<string, unknown>;
  }): Promise<VectorSearchResult>;
}
```

### Built-in: In-memory adapters

For development, testing, and prototyping:

```ts
import { InMemoryStorageAdapter, InMemoryVectorAdapter } from '@intelagent/knowledge-grid';

// Uses a deterministic hash-based embedding (not semantic — for testing only)
const storage = new InMemoryStorageAdapter();
const vector = new InMemoryVectorAdapter();

// With real embeddings (OpenAI, Cohere, local model, etc.)
const vector = new InMemoryVectorAdapter({
  embedFn: async (text) => {
    const response = await openai.embeddings.create({
      input: text,
      model: 'text-embedding-3-small',
    });
    return response.data[0].embedding;
  },
  dimensions: 1536,
});
```

### Production adapter example (PostgreSQL + pgvector)

```ts
import { StorageAdapter, VectorAdapter } from '@intelagent/knowledge-grid';
import { PrismaClient } from '@prisma/client';

class PrismaStorageAdapter implements StorageAdapter {
  constructor(private prisma: PrismaClient) {}

  async findEntry(agentId: string, sourceType: string, sourceId: string) {
    return this.prisma.knowledge_grid_entries.findFirst({
      where: { agent_id: agentId, source_type: sourceType, source_id: sourceId },
    });
  }
  // ... implement remaining methods
}
```

## System layer seed

New agents start with 10 curated best practices covering error recovery, API auth, approval thresholds, context prioritisation, and more:

```ts
import { seedSystemLayerForAgent } from '@intelagent/knowledge-grid';

const seeded = await seedSystemLayerForAgent('agent-1');
// seeded = 10 (first run), 0 (idempotent on repeat)
```

## Connection auto-ingest

When you connect an MCP server or SDK, the grid automatically indexes each tool/method:

```ts
import { autoIngestMCPServer, autoIngestSDK } from '@intelagent/knowledge-grid';

await autoIngestMCPServer('agent-1', {
  id: 'server-1',
  name: 'GitHub',
  url: 'https://mcp.github.com',
  discoveredTools: [
    { name: 'create_issue', description: 'Create a GitHub issue', inputSchema: { properties: { title: { type: 'string' } } } },
  ],
});
```

This creates grid entries for each tool so they surface in retrieval when relevant — your agent doesn't need 150 tools loaded, just the 5-10 the grid identifies as relevant to the current query.

## License

MIT
