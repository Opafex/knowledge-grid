/**
 * Knowledge Grid Retriever (Free Tier)
 *
 * Intent-driven retrieval with static layer weights.
 * No pathway boosts, no maturation-adaptive weights — those are Intelligence-tier.
 *
 * @module @intelagent/knowledge-grid/grid-retriever
 */

import { getGridConfig } from './adapters';
import type { GridEntryRow } from './adapters';
import { inferDomains } from './domain-inference';
import type {
  GridDomain,
  GridLayer,
  GridSearchOptions,
  GridSearchResult,
  GridSearchResponse,
  GridVectorMetadata,
  QueryIntent,
  GridEntry,
} from './types';
import { getGridCollectionName, LAYER_WEIGHTS } from './types';

// ============================================================================
// Intent Classification
// ============================================================================

/**
 * Classify a user query into grid-aware intent with domain detection.
 * No LLM call — keyword-based for speed.
 */
export function classifyQueryIntent(query: string): QueryIntent {
  const domains = inferDomains(query);
  const primaryDomains = domains.slice(0, 2) as GridDomain[];
  const secondaryDomains = domains.slice(2, 5) as GridDomain[];

  const lower = query.toLowerCase();
  const layerPriority = determineLayerPriority(lower);

  let searchMode: 'vertical' | 'horizontal' | 'targeted' = 'targeted';
  if (primaryDomains.length >= 2 || secondaryDomains.length >= 2) {
    searchMode = 'horizontal';
  } else if (primaryDomains.length === 1 && secondaryDomains.length === 0) {
    searchMode = 'vertical';
  }

  return { primaryDomains, secondaryDomains, layerPriority, searchMode };
}

function determineLayerPriority(query: string): GridLayer[] {
  const liveKeywords = [
    'current', 'now', 'today', 'active', 'pending', 'status',
    'progress', 'open', 'ongoing', 'recent', 'latest', 'overdue',
  ];
  const experienceKeywords = [
    'usually', 'normally', 'pattern', 'history', 'learned',
    'best practice', 'recommendation', 'suggest', 'how do',
    'previous', 'last time', 'typical', 'always',
  ];
  const baseKeywords = [
    'document', 'spec', 'reference', 'guide', 'manual',
    'definition', 'what is', 'explain', 'describe', 'api',
    'integration', 'feature', 'capability',
  ];

  const liveScore = liveKeywords.filter(kw => query.includes(kw)).length;
  const experienceScore = experienceKeywords.filter(kw => query.includes(kw)).length;
  const baseScore = baseKeywords.filter(kw => query.includes(kw)).length;

  const layers: Array<{ layer: GridLayer; score: number }> = [
    { layer: 'live', score: liveScore + 1 },
    { layer: 'experience', score: experienceScore },
    { layer: 'base', score: baseScore },
    { layer: 'system', score: 0 },
  ];

  return layers.sort((a, b) => b.score - a.score).map(l => l.layer);
}

// ============================================================================
// Grid Search
// ============================================================================

const DEFAULT_TOP_K = 15;
const DEFAULT_MIN_SCORE = 0.4;

/**
 * Search the knowledge grid with intent-driven filtering.
 * Uses static layer weights (free tier — no maturation or pathway boosts).
 */
export async function searchGrid(
  options: GridSearchOptions,
): Promise<GridSearchResponse> {
  const { vector, storage } = getGridConfig();
  const {
    agentId,
    query,
    topK = DEFAULT_TOP_K,
    minScore = DEFAULT_MIN_SCORE,
    domainFilter,
  } = options;

  const intent = options.intent ?? classifyQueryIntent(query);

  const allDomains = domainFilter
    ? [domainFilter as GridDomain]
    : [...intent.primaryDomains, ...intent.secondaryDomains];
  if (allDomains.length === 0) allDomains.push('general');

  // Generate query embedding
  let queryVector = options.queryVector;
  if (!queryVector) {
    const embedding = await vector.generateEmbedding(query);
    if (!embedding) {
      return { results: [], totalSearched: 0, queryIntent: intent };
    }
    queryVector = embedding;
  }

  // Search vector embeddings
  const collection = getGridCollectionName(agentId);
  const metadataFilters: Record<string, unknown> = {};
  if (allDomains.length > 0) metadataFilters.domain = allDomains;
  if (options.layers && options.layers.length > 0 && options.layers.length < 4) {
    metadataFilters.layer = options.layers;
  }
  if (options.sourceTypes && options.sourceTypes.length > 0) {
    metadataFilters.sourceType = options.sourceTypes;
  }

  const searchResult = await vector.searchEmbeddings({
    collection,
    queryVector,
    topK: topK * 2,
    minScore,
    metadataFilters: Object.keys(metadataFilters).length > 0 ? metadataFilters : undefined,
  });

  // Rank results with static weights
  const results = await rankResults(searchResult.matches, agentId, intent, storage, options.minConfidence);

  return {
    results: results.slice(0, topK),
    totalSearched: searchResult.totalInCollection,
    queryIntent: intent,
  };
}

// ============================================================================
// Ranking (Static Weights)
// ============================================================================

async function rankResults(
  matches: Array<{ id: string; score: number; metadata: Record<string, unknown> }>,
  agentId: string,
  intent: QueryIntent,
  storage: ReturnType<typeof getGridConfig>['storage'],
  minConfidence?: number,
): Promise<GridSearchResult[]> {
  const entryIds = matches
    .map(m => m.metadata.gridEntryId as string)
    .filter(Boolean);

  if (entryIds.length === 0) return [];

  const entries = await storage.findEntriesByIds(entryIds);
  const entryMap = new Map(entries.map(e => [e.id, e]));

  const results: GridSearchResult[] = [];

  for (const match of matches) {
    const meta = match.metadata as unknown as GridVectorMetadata;
    const entry = entryMap.get(meta.gridEntryId);
    if (!entry) continue;
    if (minConfidence && entry.confidence < minConfidence) continue;

    const layer = entry.layer as GridLayer;
    const domain = entry.domain as GridDomain;

    // Static layer weight (free tier — no maturation adaptation)
    const layerWeight = LAYER_WEIGHTS[layer] ?? 0.5;

    // Boost primary domain results
    const isPrimaryDomain = intent.primaryDomains.includes(domain);
    const domainBoost = isPrimaryDomain ? 1.2 : 1.0;

    // Free tier: no pathway boost
    const finalScore = match.score * layerWeight * entry.confidence * domainBoost;

    results.push({
      entry: rowToGridEntry(entry),
      score: match.score,
      layerWeight,
      finalScore,
    });
  }

  results.sort((a, b) => b.finalScore - a.finalScore);

  // Update access counts (fire-and-forget)
  const accessedIds = results.map(r => r.entry.id);
  if (accessedIds.length > 0) {
    storage.incrementAccessCount(accessedIds).catch(() => {});
  }

  return results;
}

/** Convert a storage row to a GridEntry */
function rowToGridEntry(row: GridEntryRow): GridEntry {
  return {
    id: row.id,
    agentId: row.agent_id,
    layer: row.layer as GridLayer,
    domain: row.domain as GridDomain,
    sourceType: row.source_type as GridEntry['sourceType'],
    sourceId: row.source_id,
    title: row.title,
    contentText: row.content_text,
    contentHash: row.content_hash,
    metadata: row.metadata ?? {},
    tags: row.tags,
    confidence: row.confidence,
    maturity: row.maturity as GridEntry['maturity'],
    accessCount: row.access_count,
    lastAccessed: row.last_accessed,
    sourceUpdatedAt: row.source_updated_at,
    indexedAt: row.indexed_at,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Quick grid search — single-call convenience method.
 */
export async function quickGridSearch(
  agentId: string,
  query: string,
  topK = 10,
): Promise<GridSearchResult[]> {
  const response = await searchGrid({ agentId, query, topK });
  return response.results;
}
