/**
 * Knowledge Grid Indexing Pipeline
 *
 * Per-entity indexers that sync source data into the knowledge grid.
 * Uses injectable adapters (no Prisma dependency).
 *
 * Each indexer:
 * 1. Builds a text representation of the entity
 * 2. Computes SHA-256 content hash to skip redundant embeddings
 * 3. Upserts a grid entry via the StorageAdapter
 * 4. Generates & stores vector embedding via the VectorAdapter
 *
 * @module @opafex/knowledge-grid/indexing-pipeline
 */

import { getGridConfig } from './adapters';
import { inferPrimaryDomain } from './domain-inference';
import type {
  GridDomain,
  GridSourceType,
  GridIndexInput,
  GridIndexResult,
  GridVectorMetadata,
  GridMaturity,
} from './types';
import { getGridCollectionName } from './types';

const logger = { warn: console.warn, error: console.error, info: console.info };

// ============================================================================
// Content Hashing
// ============================================================================

async function computeContentHash(text: string): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ============================================================================
// Core Upsert
// ============================================================================

/**
 * Index a single entity into the knowledge grid.
 * - Upserts the grid entry row
 * - Skips embedding if content hash is unchanged
 * - Generates and stores vector embedding
 */
export async function indexGridEntry(input: GridIndexInput): Promise<GridIndexResult> {
  const { storage, vector } = getGridConfig();
  const {
    agentId, layer, domain, sourceType, sourceId,
    title, contentText, metadata = {}, tags = [],
    confidence = 1.0, maturity = 'raw', sourceUpdatedAt,
  } = input;

  if (!contentText || contentText.trim().length === 0) {
    return { entryId: '', embedded: false, skippedReason: 'empty_content' };
  }

  const contentHash = await computeContentHash(contentText);
  const collection = getGridCollectionName(agentId);

  const existing = await storage.findEntry(agentId, sourceType, sourceId);

  let entryId: string;

  if (existing) {
    const updated = await storage.updateEntry(existing.id, {
      layer,
      domain,
      title,
      content_text: contentText,
      content_hash: contentHash,
      metadata,
      tags,
      confidence,
      maturity,
      source_updated_at: sourceUpdatedAt ?? null,
      indexed_at: new Date(),
      is_active: true,
    });
    entryId = updated.id;

    if (existing.content_hash === contentHash) {
      return { entryId, embedded: false, skippedReason: 'hash_unchanged' };
    }
  } else {
    const created = await storage.createEntry({
      agent_id: agentId,
      layer,
      domain,
      source_type: sourceType,
      source_id: sourceId,
      title,
      content_text: contentText,
      content_hash: contentHash,
      metadata,
      tags,
      confidence,
      maturity,
      source_updated_at: sourceUpdatedAt ?? null,
      indexed_at: new Date(),
      is_active: true,
    });
    entryId = created.id;
  }

  if (!vector.isEmbeddingAvailable()) {
    return { entryId, embedded: false, skippedReason: 'embedding_unavailable' };
  }

  const embedding = await vector.generateEmbedding(contentText);
  if (!embedding) {
    return { entryId, embedded: false, skippedReason: 'embedding_unavailable' };
  }

  // Delete any existing vector for this grid entry
  await vector.deleteEmbeddings(collection, { gridEntryId: entryId });

  // Store new vector embedding
  const vectorMetadata: GridVectorMetadata = {
    gridEntryId: entryId,
    agentId,
    layer,
    domain,
    sourceType,
    sourceId,
    confidence,
    maturity,
    title,
    content: contentText.slice(0, 2000),
  };

  await vector.storeEmbedding(collection, embedding, vectorMetadata as unknown as Record<string, unknown>);

  return { entryId, embedded: true };
}

/**
 * Remove a grid entry and its vector embedding.
 */
export async function removeGridEntry(
  agentId: string,
  sourceType: GridSourceType,
  sourceId: string,
): Promise<void> {
  const { storage, vector } = getGridConfig();

  const existing = await storage.findEntry(agentId, sourceType, sourceId);
  if (!existing) return;

  const collection = getGridCollectionName(agentId);

  await Promise.all([
    storage.deleteEntry(existing.id),
    vector.deleteEmbeddings(collection, { gridEntryId: existing.id }),
  ]);
}

// ============================================================================
// Per-Entity Indexers
// ============================================================================

export async function indexTask(agentId: string, task: {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  domain?: string | null;
  tags?: string[];
  updated_at?: Date;
}): Promise<GridIndexResult> {
  try {
    const domain = (task.domain as GridDomain) || inferPrimaryDomain(`${task.title} ${task.description || ''}`);
    const contentText = [
      `Task: ${task.title}`,
      task.description ? `Description: ${task.description}` : '',
      `Status: ${task.status}`,
      `Priority: ${task.priority}`,
    ].filter(Boolean).join('\n');

    return await indexGridEntry({
      agentId,
      layer: 'live',
      domain,
      sourceType: 'task',
      sourceId: task.id,
      title: task.title,
      contentText,
      metadata: { status: task.status, priority: task.priority, domain: task.domain },
      tags: task.tags || [],
      sourceUpdatedAt: task.updated_at,
    });
  } catch (err) {
    logger.error('[KnowledgeGrid] Failed to index task:', err);
    return { entryId: '', embedded: false, skippedReason: 'empty_content' };
  }
}

export async function indexWorkflow(agentId: string, workflow: {
  id: string;
  name: string;
  nodes?: unknown;
  active?: boolean;
  updated_at?: Date;
}): Promise<GridIndexResult> {
  try {
    const nodesDescription = workflow.nodes
      ? ` with ${Array.isArray(workflow.nodes) ? workflow.nodes.length : 'multiple'} steps`
      : '';
    const contentText = [
      `Workflow: ${workflow.name}${nodesDescription}`,
      `Active: ${workflow.active ?? true}`,
    ].join('\n');

    const domain = inferPrimaryDomain(workflow.name);

    return await indexGridEntry({
      agentId,
      layer: 'live',
      domain,
      sourceType: 'workflow',
      sourceId: workflow.id,
      title: workflow.name,
      contentText,
      metadata: { active: workflow.active ?? true },
      sourceUpdatedAt: workflow.updated_at,
    });
  } catch (err) {
    logger.error('[KnowledgeGrid] Failed to index workflow:', err);
    return { entryId: '', embedded: false, skippedReason: 'empty_content' };
  }
}

export async function indexKnowledgeDoc(agentId: string, doc: {
  id: string;
  filename: string;
  content: string;
  context?: string | null;
  tags?: string[];
  updated_at?: Date;
}): Promise<GridIndexResult> {
  try {
    const contentText = [
      `Document: ${doc.filename}`,
      doc.context ? `Context: ${doc.context}` : '',
      `Content: ${doc.content.slice(0, 3000)}`,
    ].filter(Boolean).join('\n');

    const domain = inferPrimaryDomain(`${doc.filename} ${doc.context || ''} ${doc.content.slice(0, 500)}`);

    return await indexGridEntry({
      agentId,
      layer: 'base',
      domain,
      sourceType: 'knowledge_doc',
      sourceId: doc.id,
      title: doc.filename,
      contentText,
      tags: doc.tags || [],
      sourceUpdatedAt: doc.updated_at,
    });
  } catch (err) {
    logger.error('[KnowledgeGrid] Failed to index knowledge doc:', err);
    return { entryId: '', embedded: false, skippedReason: 'empty_content' };
  }
}

export async function indexLearnedPattern(agentId: string, pattern: {
  id: string;
  pattern_type: string;
  description: string;
  confidence: number;
  pattern_data?: unknown;
  updated_at?: Date;
}): Promise<GridIndexResult> {
  try {
    const contentText = [
      `Pattern (${pattern.pattern_type}): ${pattern.description}`,
      pattern.pattern_data ? `Data: ${JSON.stringify(pattern.pattern_data).slice(0, 1000)}` : '',
    ].filter(Boolean).join('\n');

    const domain = inferPrimaryDomain(pattern.description);
    const maturity: GridMaturity = pattern.confidence >= 0.85 ? 'mature'
      : pattern.confidence >= 0.5 ? 'developing' : 'raw';

    return await indexGridEntry({
      agentId,
      layer: 'experience',
      domain,
      sourceType: 'learned_pattern',
      sourceId: pattern.id,
      title: `${pattern.pattern_type}: ${pattern.description.slice(0, 100)}`,
      contentText,
      confidence: pattern.confidence,
      maturity,
      sourceUpdatedAt: pattern.updated_at,
    });
  } catch (err) {
    logger.error('[KnowledgeGrid] Failed to index learned pattern:', err);
    return { entryId: '', embedded: false, skippedReason: 'empty_content' };
  }
}

export async function indexMemory(agentId: string, memory: {
  id: string;
  memory_type: string;
  content: string;
  confidence: number;
  updated_at?: Date;
}): Promise<GridIndexResult> {
  try {
    const contentText = `Memory (${memory.memory_type}): ${memory.content}`;
    const domain = inferPrimaryDomain(memory.content);

    return await indexGridEntry({
      agentId,
      layer: 'experience',
      domain,
      sourceType: 'memory',
      sourceId: memory.id,
      title: `Memory: ${memory.content.slice(0, 100)}`,
      contentText,
      confidence: memory.confidence,
      sourceUpdatedAt: memory.updated_at,
    });
  } catch (err) {
    logger.error('[KnowledgeGrid] Failed to index memory:', err);
    return { entryId: '', embedded: false, skippedReason: 'empty_content' };
  }
}

export async function indexSystemBestPractice(agentId: string, bestPractice: {
  id: string;
  title: string;
  content: string;
  domain: GridDomain;
  tags?: string[];
}): Promise<GridIndexResult> {
  try {
    return await indexGridEntry({
      agentId,
      layer: 'system',
      domain: bestPractice.domain,
      sourceType: 'system_best_practice',
      sourceId: bestPractice.id,
      title: bestPractice.title,
      contentText: bestPractice.content,
      confidence: 0.9,
      maturity: 'canonical',
      tags: bestPractice.tags || ['system', 'best-practice'],
    });
  } catch (err) {
    logger.error('[KnowledgeGrid] Failed to index system best practice:', err);
    return { entryId: '', embedded: false, skippedReason: 'empty_content' };
  }
}

// ============================================================================
// Convenience Removal Wrappers
// ============================================================================

/** Remove a task from the grid */
export async function removeTask(agentId: string, taskId: string): Promise<void> {
  return removeGridEntry(agentId, 'task', taskId);
}

/** Remove a workflow from the grid */
export async function removeWorkflow(agentId: string, workflowId: string): Promise<void> {
  return removeGridEntry(agentId, 'workflow', workflowId);
}

/** Remove a knowledge document from the grid */
export async function removeKnowledgeDoc(agentId: string, docId: string): Promise<void> {
  return removeGridEntry(agentId, 'knowledge_doc', docId);
}

/** Remove a memory entry from the grid */
export async function removeMemory(agentId: string, memoryId: string): Promise<void> {
  return removeGridEntry(agentId, 'memory', memoryId);
}

/**
 * Fire-and-forget wrapper. Logs errors but doesn't throw.
 */
export function indexGridEntryAsync(input: GridIndexInput): void {
  indexGridEntry(input).catch(err => {
    logger.error('[KnowledgeGrid] Async indexing failed:', err);
  });
}
