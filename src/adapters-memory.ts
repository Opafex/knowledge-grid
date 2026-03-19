/**
 * In-Memory Adapters
 *
 * Reference implementations of StorageAdapter and VectorAdapter that
 * store everything in memory. Zero external dependencies.
 *
 * Use these for:
 * - Testing and development
 * - Prototyping before choosing a production database
 * - Understanding the adapter contract
 *
 * NOT recommended for production — data is lost on process exit.
 *
 * @module @intelagent/knowledge-grid/adapters-memory
 */

import type { StorageAdapter, GridEntryRow, VectorAdapter, VectorMatch, VectorSearchResult } from './adapters';

// ============================================================================
// In-Memory Storage Adapter
// ============================================================================

let nextId = 1;
function generateId(): string {
  return `mem_${Date.now()}_${nextId++}`;
}

/**
 * In-memory storage adapter. Stores grid entries in a Map.
 *
 * ```ts
 * import { InMemoryStorageAdapter } from '@intelagent/knowledge-grid';
 * const storage = new InMemoryStorageAdapter();
 * ```
 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private entries = new Map<string, GridEntryRow>();

  async findEntry(agentId: string, sourceType: string, sourceId: string): Promise<GridEntryRow | null> {
    for (const entry of this.entries.values()) {
      if (entry.agent_id === agentId && entry.source_type === sourceType && entry.source_id === sourceId) {
        return entry;
      }
    }
    return null;
  }

  async createEntry(data: Omit<GridEntryRow, 'id' | 'access_count' | 'last_accessed' | 'created_at' | 'updated_at'>): Promise<GridEntryRow> {
    const now = new Date();
    const row: GridEntryRow = {
      id: generateId(),
      ...data,
      access_count: 0,
      last_accessed: null,
      created_at: now,
      updated_at: now,
    };
    this.entries.set(row.id, row);
    return row;
  }

  async updateEntry(id: string, data: Partial<GridEntryRow>): Promise<GridEntryRow> {
    const existing = this.entries.get(id);
    if (!existing) throw new Error(`Entry ${id} not found`);

    const updated: GridEntryRow = { ...existing, ...data, updated_at: new Date() };
    this.entries.set(id, updated);
    return updated;
  }

  async deleteEntry(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async findEntriesBySourceType(agentId: string, sourceType: string, options?: { limit?: number }): Promise<GridEntryRow[]> {
    const results: GridEntryRow[] = [];
    for (const entry of this.entries.values()) {
      if (entry.agent_id === agentId && entry.source_type === sourceType && entry.is_active) {
        results.push(entry);
        if (options?.limit && results.length >= options.limit) break;
      }
    }
    return results;
  }

  async findEntriesByIds(ids: string[]): Promise<GridEntryRow[]> {
    const idSet = new Set(ids);
    const results: GridEntryRow[] = [];
    for (const entry of this.entries.values()) {
      if (idSet.has(entry.id) && entry.is_active) {
        results.push(entry);
      }
    }
    return results;
  }

  async incrementAccessCount(ids: string[]): Promise<void> {
    const now = new Date();
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) {
        entry.access_count++;
        entry.last_accessed = now;
      }
    }
  }

  async deleteEntriesByPrefix(agentId: string, sourceIdPrefix: string): Promise<void> {
    for (const [id, entry] of this.entries) {
      if (entry.agent_id === agentId && entry.source_id.startsWith(sourceIdPrefix)) {
        this.entries.delete(id);
      }
    }
  }

  /** Get all entries (for debugging/testing) */
  getAll(): GridEntryRow[] {
    return [...this.entries.values()];
  }

  /** Clear all entries */
  clear(): void {
    this.entries.clear();
  }

  /** Get entry count */
  get size(): number {
    return this.entries.size;
  }
}

// ============================================================================
// In-Memory Vector Adapter (Cosine Similarity)
// ============================================================================

interface StoredVector {
  id: string;
  collection: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 means identical direction.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Simple hash-based embedding generator for testing.
 * Produces a deterministic 64-dimensional vector from text content.
 * NOT suitable for production — use OpenAI, Cohere, or a local model instead.
 */
function hashEmbedding(text: string, dimensions = 64): number[] {
  const vector = new Array(dimensions).fill(0);
  const normalized = text.toLowerCase().trim();

  for (let i = 0; i < normalized.length; i++) {
    const charCode = normalized.charCodeAt(i);
    const idx = (charCode * (i + 1)) % dimensions;
    vector[idx] += Math.sin(charCode * (i + 1) * 0.1);
  }

  // Normalize to unit vector
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) vector[i] /= norm;
  }

  return vector;
}

/**
 * In-memory vector adapter with cosine similarity search.
 *
 * Uses a simple hash-based embedding by default (for testing).
 * Pass a custom `embedFn` for real embeddings (OpenAI, Cohere, etc.).
 *
 * ```ts
 * import { InMemoryVectorAdapter } from '@intelagent/knowledge-grid';
 *
 * // With built-in hash embeddings (testing only)
 * const vector = new InMemoryVectorAdapter();
 *
 * // With real embeddings
 * const vector = new InMemoryVectorAdapter({
 *   embedFn: async (text) => openai.embeddings.create({ input: text, model: 'text-embedding-3-small' })
 *     .then(r => r.data[0].embedding)
 * });
 * ```
 */
export class InMemoryVectorAdapter implements VectorAdapter {
  private vectors: StoredVector[] = [];
  private embedFn: ((text: string) => Promise<number[] | null>) | null;
  private dimensions: number;
  private idCounter = 0;

  constructor(options?: {
    embedFn?: (text: string) => Promise<number[] | null>;
    dimensions?: number;
  }) {
    this.embedFn = options?.embedFn ?? null;
    this.dimensions = options?.dimensions ?? 64;
  }

  async generateEmbedding(text: string): Promise<number[] | null> {
    if (this.embedFn) {
      return this.embedFn(text);
    }
    return hashEmbedding(text, this.dimensions);
  }

  isEmbeddingAvailable(): boolean {
    return true;
  }

  async storeEmbedding(collection: string, embedding: number[], metadata: Record<string, unknown>): Promise<string> {
    const id = `vec_${++this.idCounter}`;
    this.vectors.push({ id, collection, embedding, metadata });
    return id;
  }

  async deleteEmbeddings(collection: string, metadataFilter: Record<string, unknown>): Promise<void> {
    this.vectors = this.vectors.filter(v => {
      if (v.collection !== collection) return true;
      for (const [key, value] of Object.entries(metadataFilter)) {
        if (v.metadata[key] !== value) return true;
      }
      return false; // matched all filters — delete
    });
  }

  async searchEmbeddings(options: {
    collection: string;
    queryVector: number[];
    topK: number;
    minScore: number;
    metadataFilters?: Record<string, unknown>;
  }): Promise<VectorSearchResult> {
    const collectionVectors = this.vectors.filter(v => v.collection === options.collection);

    // Apply metadata filters
    let candidates = collectionVectors;
    if (options.metadataFilters) {
      candidates = candidates.filter(v => {
        for (const [key, value] of Object.entries(options.metadataFilters!)) {
          const metaValue = v.metadata[key];
          if (Array.isArray(value)) {
            // Array filter: metadata value must be in the array
            if (!value.includes(metaValue)) return false;
          } else {
            if (metaValue !== value) return false;
          }
        }
        return true;
      });
    }

    // Score by cosine similarity
    const scored: Array<VectorMatch & { _score: number }> = [];
    for (const v of candidates) {
      const score = cosineSimilarity(options.queryVector, v.embedding);
      if (score >= options.minScore) {
        scored.push({ id: v.id, score, metadata: v.metadata, _score: score });
      }
    }

    // Sort by score descending, take topK
    scored.sort((a, b) => b._score - a._score);
    const matches = scored.slice(0, options.topK).map(({ _score, ...match }) => match);

    return {
      matches,
      totalInCollection: collectionVectors.length,
    };
  }

  /** Get total stored vectors (for debugging/testing) */
  get size(): number {
    return this.vectors.length;
  }

  /** Clear all vectors */
  clear(): void {
    this.vectors = [];
  }
}
