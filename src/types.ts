/**
 * Knowledge Grid Types
 *
 * Type definitions for the knowledge grid system: Domains x Layers with
 * unified vector indexing, intent-driven retrieval, and maturation tracking.
 *
 * @module @opafex/knowledge-grid/types
 */

// ============================================================================
// Grid Dimensions
// ============================================================================

/** Knowledge layers — vertical axis of the grid (4-layer lattice) */
export type GridLayer = 'system' | 'base' | 'experience' | 'live';

/**
 * Default grid domains — the 9 built-in domains.
 * Custom domains are supported via the GridDomain type.
 *
 * SYNC: This list is duplicated in the platform at
 * apps/customer-portal/lib/agent-builder/knowledge-grid/types.ts.
 * Changes here must be mirrored there (and vice versa).
 */
export const DEFAULT_GRID_DOMAINS = [
  'sales', 'marketing', 'support', 'analytics', 'operations',
  'social', 'general', 'platform', 'integrations',
] as const;

export type DefaultGridDomain = typeof DEFAULT_GRID_DOMAINS[number];

/**
 * Grid domains — horizontal axis of the grid.
 * Includes 9 built-in defaults plus custom domains (any string).
 */
export type GridDomain = DefaultGridDomain | (string & {});

/** Source entity types that can be indexed into the grid */
export type GridSourceType =
  | 'task'
  | 'workflow'
  | 'knowledge_doc'
  | 'learned_pattern'
  | 'domain_rule'
  | 'memory'
  | 'tool_capability'
  | 'integration_spec'
  | 'skill_definition'
  | 'learning_outcome'
  | 'locale_context'
  | 'system_best_practice'
  | 'bundle_capability';

/** Maturity levels for individual grid entries */
export type GridMaturity = 'raw' | 'developing' | 'mature' | 'canonical';

/** Domain maturation levels for agent expertise per domain */
export type MaturationLevel = 'novice' | 'apprentice' | 'proficient' | 'expert';

// ============================================================================
// Grid Entry
// ============================================================================

/** A single entry in the knowledge grid */
export interface GridEntry {
  id: string;
  agentId: string;
  layer: GridLayer;
  domain: GridDomain;
  sourceType: GridSourceType;
  sourceId: string;
  title: string;
  contentText: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  tags: string[];
  confidence: number;
  maturity: GridMaturity;
  accessCount: number;
  lastAccessed: Date | null;
  sourceUpdatedAt: Date | null;
  indexedAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Indexing Types
// ============================================================================

/** Input for indexing a single entity into the grid */
export interface GridIndexInput {
  agentId: string;
  layer: GridLayer;
  domain: GridDomain;
  sourceType: GridSourceType;
  sourceId: string;
  title: string;
  contentText: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  confidence?: number;
  maturity?: GridMaturity;
  sourceUpdatedAt?: Date;
}

/** Result from indexing an entity */
export interface GridIndexResult {
  entryId: string;
  embedded: boolean;
  skippedReason?: 'hash_unchanged' | 'embedding_unavailable' | 'empty_content';
}

// ============================================================================
// Retrieval Types
// ============================================================================

/** Search mode for grid retrieval */
export type GridSearchMode = 'vertical' | 'horizontal' | 'targeted';

/** Query intent with domain and layer classification */
export interface QueryIntent {
  primaryDomains: GridDomain[];
  secondaryDomains: GridDomain[];
  layerPriority: GridLayer[];
  searchMode: GridSearchMode;
}

/** Options for searching the grid */
export interface GridSearchOptions {
  agentId: string;
  query: string;
  queryVector?: number[];
  intent?: QueryIntent;
  layers?: GridLayer[];
  domains?: GridDomain[];
  sourceTypes?: GridSourceType[];
  minConfidence?: number;
  topK?: number;
  minScore?: number;
  domainFilter?: string;
}

/** A single search result with score and grid metadata */
export interface GridSearchResult {
  entry: GridEntry;
  score: number;
  layerWeight: number;
  finalScore: number;
}

/** Complete search response */
export interface GridSearchResponse {
  results: GridSearchResult[];
  totalSearched: number;
  queryIntent: QueryIntent;
  /** Per-domain maturation levels (populated by Intelligence tier; omitted on free tier) */
  maturationLevels?: Record<string, MaturationLevel>;
}

// ============================================================================
// Prompt Construction Types
// ============================================================================

/** A section of grid-aware context for prompt construction */
export interface GridContextSection {
  domain: GridDomain;
  isPrimary: boolean;
  entries: Array<{
    layer: GridLayer;
    title: string;
    content: string;
    sourceType: GridSourceType;
    confidence: number;
  }>;
  maturationLevel: MaturationLevel;
  tokenEstimate: number;
}

/** Grid-aware prompt context ready for injection */
export interface GridPromptContext {
  sections: GridContextSection[];
  totalTokenEstimate: number;
  domainsIncluded: GridDomain[];
  layerDistribution: Record<GridLayer, number>;
}

// ============================================================================
// Vector Metadata Extension
// ============================================================================

/** Metadata stored alongside vector embeddings for grid entries */
export interface GridVectorMetadata {
  gridEntryId: string;
  agentId: string;
  layer: GridLayer;
  domain: GridDomain;
  sourceType: GridSourceType;
  sourceId: string;
  confidence: number;
  maturity: GridMaturity;
  title: string;
  content: string;
}

// ============================================================================
// Collection Naming
// ============================================================================

/** Get the vector collection name for a grid */
export function getGridCollectionName(agentId: string): string {
  return `grid_${agentId}`;
}

// ============================================================================
// Layer Weights (static — free tier)
// ============================================================================

/** Default weights for layer-based scoring during retrieval */
export const LAYER_WEIGHTS: Record<GridLayer, number> = {
  live: 1.0,
  experience: 0.85,
  base: 0.7,
  system: 0.5,
};
