/**
 * @opafex/knowledge-grid
 *
 * Open-source knowledge grid for AI agents.
 * Provides vector indexing, domain inference, intent-driven retrieval,
 * and prompt composition with a 4-layer lattice architecture.
 *
 * ## Quick Start
 *
 * ```ts
 * import { initKnowledgeGrid, indexTask, searchGrid } from '@opafex/knowledge-grid';
 *
 * // Initialize with your storage and vector adapters
 * initKnowledgeGrid({ storage: myStorageAdapter, vector: myVectorAdapter });
 *
 * // Index data
 * await indexTask('agent-1', { id: 't1', title: 'Review Q1', status: 'open', priority: 'high' });
 *
 * // Search
 * const results = await searchGrid({ agentId: 'agent-1', query: 'quarterly review' });
 * ```
 *
 * @module @opafex/knowledge-grid
 */

// Adapters (initialize before use)
export {
  initKnowledgeGrid,
  getGridConfig,
} from './adapters.js';
export type {
  StorageAdapter,
  VectorAdapter,
  KnowledgeGridConfig,
  GridEntryRow,
  VectorMatch,
  VectorSearchResult,
} from './adapters.js';

// In-memory reference adapters (testing & prototyping)
export {
  InMemoryStorageAdapter,
  InMemoryVectorAdapter,
} from './adapters-memory.js';

// Types
export type {
  GridLayer,
  GridDomain,
  DefaultGridDomain,
  GridSourceType,
  GridMaturity,
  MaturationLevel,
  GridEntry,
  GridIndexInput,
  GridIndexResult,
  GridSearchMode,
  QueryIntent,
  GridSearchOptions,
  GridSearchResult,
  GridSearchResponse,
  GridContextSection,
  GridPromptContext,
  GridVectorMetadata,
} from './types.js';

export {
  DEFAULT_GRID_DOMAINS,
  getGridCollectionName,
  LAYER_WEIGHTS,
} from './types.js';

// Domain inference
export { inferDomains, inferPrimaryDomain } from './domain-inference.js';

// Indexing pipeline
export {
  indexGridEntry,
  indexGridEntryAsync,
  removeGridEntry,
  removeTask,
  removeWorkflow,
  removeKnowledgeDoc,
  removeMemory,
  indexTask,
  indexWorkflow,
  indexKnowledgeDoc,
  indexLearnedPattern,
  indexMemory,
  indexSystemBestPractice,
} from './indexing-pipeline.js';

// Grid retriever
export {
  classifyQueryIntent,
  searchGrid,
  quickGridSearch,
} from './grid-retriever.js';

// Grid prompt builder
export {
  composeGridContext,
  renderGridContext,
} from './grid-prompt-builder.js';

// System layer seed
export { seedSystemLayerForAgent } from './system-layer-seed.js';

// Connection auto-ingest (template-based, no LLM)
export {
  generateUsageGuide,
  autoIngestMCPServer,
  autoIngestSDK,
  removeIngestedMCPServer,
  removeIngestedSDK,
} from './connection-auto-ingest.js';
export type { MCPToolInput, SDKMethodInput } from './connection-auto-ingest.js';
