/**
 * Knowledge Grid Adapters
 *
 * Injectable interfaces for storage and vector search backends.
 * The open-source package does NOT depend on Prisma or any specific
 * database — users provide their own implementations.
 *
 * @module @opafex/knowledge-grid/adapters
 */

import type { GridEntry, GridLayer, GridDomain, GridSourceType, GridMaturity } from './types';

// ============================================================================
// Storage Adapter
// ============================================================================

/** Row shape for grid entry storage (database-agnostic) */
export interface GridEntryRow {
  id: string;
  agent_id: string;
  layer: string;
  domain: string;
  source_type: string;
  source_id: string;
  title: string;
  content_text: string;
  content_hash: string;
  metadata: Record<string, unknown>;
  tags: string[];
  confidence: number;
  maturity: string;
  access_count: number;
  last_accessed: Date | null;
  source_updated_at: Date | null;
  indexed_at: Date;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Storage adapter — abstracts the database layer.
 * Implement this interface to plug in Prisma, Drizzle, Knex, raw SQL, etc.
 */
export interface StorageAdapter {
  /** Find the first entry matching agent + sourceType + sourceId */
  findEntry(agentId: string, sourceType: string, sourceId: string): Promise<GridEntryRow | null>;

  /** Create a new grid entry, return the created row */
  createEntry(data: Omit<GridEntryRow, 'id' | 'access_count' | 'last_accessed' | 'created_at' | 'updated_at'>): Promise<GridEntryRow>;

  /** Update an existing entry by ID, return the updated row */
  updateEntry(id: string, data: Partial<GridEntryRow>): Promise<GridEntryRow>;

  /** Delete an entry by ID */
  deleteEntry(id: string): Promise<void>;

  /** Find active entries for an agent by source_type */
  findEntriesBySourceType(agentId: string, sourceType: string, options?: { limit?: number }): Promise<GridEntryRow[]>;

  /** Find multiple entries by IDs (for batch retrieval) */
  findEntriesByIds(ids: string[]): Promise<GridEntryRow[]>;

  /** Increment access count for multiple entries (fire-and-forget safe) */
  incrementAccessCount(ids: string[]): Promise<void>;

  /** Delete entries by source_id prefix pattern */
  deleteEntriesByPrefix(agentId: string, sourceIdPrefix: string): Promise<void>;
}

// ============================================================================
// Vector Adapter
// ============================================================================

/** A vector search match */
export interface VectorMatch {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

/** Vector search result */
export interface VectorSearchResult {
  matches: VectorMatch[];
  totalInCollection: number;
}

/**
 * Vector adapter — abstracts the embedding storage and similarity search.
 * Implement this for pgvector, Pinecone, Qdrant, ChromaDB, etc.
 */
export interface VectorAdapter {
  /** Generate an embedding vector from text. Return null if unavailable. */
  generateEmbedding(text: string): Promise<number[] | null>;

  /** Check if embedding generation is available */
  isEmbeddingAvailable(): boolean;

  /** Store a vector embedding with metadata in a collection */
  storeEmbedding(collection: string, embedding: number[], metadata: Record<string, unknown>): Promise<string>;

  /** Delete embeddings matching a metadata filter from a collection */
  deleteEmbeddings(collection: string, metadataFilter: Record<string, unknown>): Promise<void>;

  /** Search for similar vectors in a collection */
  searchEmbeddings(options: {
    collection: string;
    queryVector: number[];
    topK: number;
    minScore: number;
    metadataFilters?: Record<string, unknown>;
  }): Promise<VectorSearchResult>;
}

// ============================================================================
// Grid Configuration
// ============================================================================

/**
 * Configuration for initializing the knowledge grid.
 * Pass your adapter implementations here.
 */
export interface KnowledgeGridConfig {
  storage: StorageAdapter;
  vector: VectorAdapter;
}

// ============================================================================
// Singleton Grid Instance
// ============================================================================

let _config: KnowledgeGridConfig | null = null;

/**
 * Initialize the knowledge grid with your storage and vector adapters.
 * Call this once at startup before using any grid functions.
 */
export function initKnowledgeGrid(config: KnowledgeGridConfig): void {
  _config = config;
}

/**
 * Get the current grid configuration. Throws if not initialized.
 */
export function getGridConfig(): KnowledgeGridConfig {
  if (!_config) {
    throw new Error(
      '[@opafex/knowledge-grid] Not initialized. Call initKnowledgeGrid({ storage, vector }) first.',
    );
  }
  return _config;
}
