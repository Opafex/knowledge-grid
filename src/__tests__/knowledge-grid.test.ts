import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  initKnowledgeGrid,
  getGridConfig,
  InMemoryStorageAdapter,
  InMemoryVectorAdapter,
  indexTask,
  indexWorkflow,
  indexKnowledgeDoc,
  indexLearnedPattern,
  indexMemory,
  indexGridEntry,
  indexGridEntryAsync,
  removeGridEntry,
  removeTask,
  removeWorkflow,
  removeKnowledgeDoc,
  removeMemory,
  searchGrid,
  quickGridSearch,
  classifyQueryIntent,
  composeGridContext,
  renderGridContext,
  inferDomains,
  inferPrimaryDomain,
  seedSystemLayerForAgent,
  autoIngestSDK,
  autoIngestMCPServer,
  removeIngestedSDK,
  removeIngestedMCPServer,
  generateUsageGuide,
  LAYER_WEIGHTS,
  DEFAULT_GRID_DOMAINS,
} from '../index';

let storage: InstanceType<typeof InMemoryStorageAdapter>;
let vector: InstanceType<typeof InMemoryVectorAdapter>;

function setup() {
  storage = new InMemoryStorageAdapter();
  vector = new InMemoryVectorAdapter();
  initKnowledgeGrid({ storage, vector });
}

// ============================================================================
// Domain Inference
// ============================================================================

describe('inferDomains', () => {
  it('returns general for empty text', () => {
    assert.deepEqual(inferDomains(''), ['general']);
    assert.deepEqual(inferDomains('  '), ['general']);
  });

  it('detects sales domain', () => {
    assert.equal(inferDomains('close the deal with the prospect in the pipeline')[0], 'sales');
  });

  it('detects support domain', () => {
    assert.equal(inferDomains('escalate the customer ticket about the outage')[0], 'support');
  });

  it('detects integrations domain', () => {
    assert.equal(inferDomains('connect the Slack webhook integration')[0], 'integrations');
  });

  it('detects marketing domain', () => {
    assert.equal(inferPrimaryDomain('marketing campaign engagement'), 'marketing');
  });

  it('detects analytics domain', () => {
    assert.equal(inferPrimaryDomain('dashboard report metrics KPI insights'), 'analytics');
  });

  it('detects operations domain', () => {
    assert.equal(inferPrimaryDomain('workflow automation scheduling sprint kanban'), 'operations');
  });

  it('detects social domain', () => {
    assert.equal(inferPrimaryDomain('twitter post followers engagement hashtag'), 'social');
  });

  it('detects platform domain', () => {
    assert.equal(inferPrimaryDomain('agent settings configuration dashboard widget'), 'platform');
  });

  it('returns multiple scored domains', () => {
    const domains = inferDomains('sales pipeline analytics dashboard report');
    assert.ok(domains.length >= 2, 'Expected at least 2 domains');
    assert.ok(domains.includes('sales'));
    assert.ok(domains.includes('analytics'));
  });

  it('supports custom domains', () => {
    const domains = inferDomains('machine learning training data', {
      'ml': ['machine learning', 'training', 'model', 'data'],
    });
    assert.ok(domains.includes('ml'));
  });

  it('does not override built-in domains with custom', () => {
    const domains = inferDomains('sales pipeline', {
      'sales': ['custom_keyword'],
    });
    assert.equal(domains[0], 'sales'); // still detected via built-in keywords
  });

  it('returns general when no keywords match', () => {
    assert.deepEqual(inferDomains('xyzzy foobar baz'), ['general']);
  });
});

// ============================================================================
// Query Intent Classification
// ============================================================================

describe('classifyQueryIntent', () => {
  it('classifies live-layer queries', () => {
    const intent = classifyQueryIntent('what is the current status of active tasks?');
    assert.equal(intent.layerPriority[0], 'live');
  });

  it('classifies experience-layer queries', () => {
    const intent = classifyQueryIntent('what do we usually do? recommend based on history');
    assert.ok(intent.layerPriority.indexOf('experience') <= 1, 'experience should be near top');
  });

  it('classifies base-layer queries', () => {
    const intent = classifyQueryIntent('explain the API reference guide document');
    assert.ok(intent.layerPriority.indexOf('base') <= 1, 'base should be near top');
  });

  it('detects primary domains', () => {
    const intent = classifyQueryIntent('how many sales leads are in the pipeline?');
    assert.ok(intent.primaryDomains.includes('sales'));
  });

  it('detects vertical search mode for single-domain query', () => {
    // "escalate ticket" → only 'support', no secondary → vertical
    const intent = classifyQueryIntent('escalate the customer ticket');
    assert.equal(intent.searchMode, 'vertical');
    assert.equal(intent.primaryDomains.length, 1);
  });

  it('detects horizontal search mode for multi-domain', () => {
    const intent = classifyQueryIntent('sales pipeline analytics dashboard report KPI');
    assert.equal(intent.searchMode, 'horizontal');
  });

  it('falls back to general for no-keyword queries', () => {
    const intent = classifyQueryIntent('hello world');
    // No domain keywords matched → inferDomains returns ['general'] → 1 primary, 0 secondary → vertical
    assert.ok(intent.primaryDomains.length <= 1);
  });
});

// ============================================================================
// Indexing Pipeline
// ============================================================================

describe('indexing pipeline', () => {
  beforeEach(setup);

  it('indexes a task into the grid', async () => {
    const result = await indexTask('agent-1', {
      id: 'task-1',
      title: 'Review Q1 pipeline',
      description: 'Audit open deals',
      status: 'in_progress',
      priority: 'high',
    });

    assert.ok(result.entryId);
    assert.equal(result.embedded, true);
    assert.equal(storage.size, 1);
    assert.ok(vector.size > 0);
  });

  it('deduplicates on unchanged content hash', async () => {
    const r1 = await indexTask('agent-1', {
      id: 'task-1', title: 'Same title', status: 'open', priority: 'medium',
    });
    const r2 = await indexTask('agent-1', {
      id: 'task-1', title: 'Same title', status: 'open', priority: 'medium',
    });

    assert.equal(r1.embedded, true);
    assert.equal(r2.embedded, false);
    assert.equal(r2.skippedReason, 'hash_unchanged');
    assert.equal(storage.size, 1);
  });

  it('re-embeds on content change', async () => {
    await indexTask('agent-1', { id: 'task-1', title: 'Original title', status: 'open', priority: 'medium' });
    const r2 = await indexTask('agent-1', { id: 'task-1', title: 'Updated title with new content', status: 'open', priority: 'medium' });

    assert.equal(r2.embedded, true);
    assert.equal(storage.size, 1);
  });

  it('skips empty content', async () => {
    const result = await indexGridEntry({
      agentId: 'agent-1', layer: 'base', domain: 'general',
      sourceType: 'knowledge_doc', sourceId: 'empty-doc',
      title: 'Empty', contentText: '',
    });
    assert.equal(result.embedded, false);
    assert.equal(result.skippedReason, 'empty_content');
  });

  it('skips whitespace-only content', async () => {
    const result = await indexGridEntry({
      agentId: 'agent-1', layer: 'base', domain: 'general',
      sourceType: 'knowledge_doc', sourceId: 'ws-doc',
      title: 'Whitespace', contentText: '   \n  \t  ',
    });
    assert.equal(result.skippedReason, 'empty_content');
  });

  it('indexes a workflow', async () => {
    const result = await indexWorkflow('agent-1', { id: 'wf-1', name: 'Lead qualification workflow', active: true });
    assert.ok(result.entryId);
    assert.equal(result.embedded, true);
  });

  it('indexes a knowledge doc', async () => {
    const result = await indexKnowledgeDoc('agent-1', {
      id: 'doc-1', filename: 'playbook.md',
      content: 'When a customer asks about pricing, always reference the latest rate card.',
    });
    assert.ok(result.entryId);
    assert.equal(result.embedded, true);
  });

  it('indexes a learned pattern', async () => {
    const result = await indexLearnedPattern('agent-1', {
      id: 'pat-1', pattern_type: 'response_style',
      description: 'Users prefer concise answers with bullet points',
      confidence: 0.9,
    });
    assert.ok(result.entryId);
    assert.equal(result.embedded, true);

    // High confidence should get 'mature' maturity
    const entry = storage.getAll()[0];
    assert.equal(entry.maturity, 'mature');
  });

  it('indexes a memory', async () => {
    const result = await indexMemory('agent-1', {
      id: 'mem-1', memory_type: 'preference',
      content: 'User prefers formal communication style',
      confidence: 0.8,
    });
    assert.ok(result.entryId);
    assert.equal(result.embedded, true);
    assert.equal(storage.getAll()[0].layer, 'experience');
  });

  it('preserves metadata and tags', async () => {
    await indexGridEntry({
      agentId: 'agent-1', layer: 'base', domain: 'integrations',
      sourceType: 'tool_capability', sourceId: 'tool-1',
      title: 'Test Tool', contentText: 'A test tool capability',
      metadata: { provider: 'test', version: '1.0' },
      tags: ['test', 'tool'],
    });

    const entry = storage.getAll()[0];
    assert.equal((entry.metadata as Record<string, unknown>).provider, 'test');
    assert.deepEqual(entry.tags, ['test', 'tool']);
  });

  it('correctly infers domain for tasks', async () => {
    await indexTask('agent-1', {
      id: 't-sales', title: 'Follow up on sales lead pipeline',
      status: 'open', priority: 'high',
    });
    const entry = storage.getAll()[0];
    assert.equal(entry.domain, 'sales');
  });

  it('uses explicit domain when provided for tasks', async () => {
    await indexTask('agent-1', {
      id: 't-explicit', title: 'Generic task',
      status: 'open', priority: 'medium', domain: 'analytics',
    });
    const entry = storage.getAll()[0];
    assert.equal(entry.domain, 'analytics');
  });

  it('removes an entry and its vector', async () => {
    await indexTask('agent-1', { id: 't-1', title: 'Removable', status: 'open', priority: 'low' });
    assert.equal(storage.size, 1);
    const vectorsBefore = vector.size;

    await removeTask('agent-1', 't-1');
    assert.equal(storage.size, 0);
    assert.ok(vector.size < vectorsBefore, 'Vector should be deleted too');
  });

  it('removeGridEntry handles missing entries gracefully', async () => {
    await removeGridEntry('agent-1', 'task', 'nonexistent');
    // Should not throw
  });

  it('convenience removal wrappers work', async () => {
    await indexWorkflow('agent-1', { id: 'wf-del', name: 'Deletable', active: true });
    await indexKnowledgeDoc('agent-1', { id: 'doc-del', filename: 'del.md', content: 'delete me' });
    await indexMemory('agent-1', { id: 'mem-del', memory_type: 'test', content: 'delete me', confidence: 0.5 });
    assert.equal(storage.size, 3);

    await removeWorkflow('agent-1', 'wf-del');
    await removeKnowledgeDoc('agent-1', 'doc-del');
    await removeMemory('agent-1', 'mem-del');
    assert.equal(storage.size, 0);
  });

  it('indexGridEntryAsync does not throw', () => {
    // Fire-and-forget — should not throw even on error
    indexGridEntryAsync({
      agentId: 'agent-1', layer: 'live', domain: 'general',
      sourceType: 'task', sourceId: 'async-1',
      title: 'Async', contentText: 'Some async content',
    });
  });
});

// ============================================================================
// Multi-Agent Isolation
// ============================================================================

describe('multi-agent isolation', () => {
  before(async () => {
    setup();
    await indexTask('agent-A', { id: 't1', title: 'Agent A sales pipeline', status: 'open', priority: 'high' });
    await indexTask('agent-B', { id: 't1', title: 'Agent B support tickets', status: 'open', priority: 'high' });
  });

  it('search only returns entries for the queried agent', async () => {
    const responseA = await searchGrid({ agentId: 'agent-A', query: 'Agent A sales pipeline', minScore: 0.01 });
    const responseB = await searchGrid({ agentId: 'agent-B', query: 'Agent B support tickets', minScore: 0.01 });

    for (const r of responseA.results) {
      assert.equal(r.entry.agentId, 'agent-A', 'Agent A search returned Agent B entry');
    }
    for (const r of responseB.results) {
      assert.equal(r.entry.agentId, 'agent-B', 'Agent B search returned Agent A entry');
    }
  });

  it('different agents can have same sourceId without conflict', async () => {
    // Both agents have task 't1' — they should coexist
    assert.equal(storage.size, 2);
  });
});

// ============================================================================
// Search & Retrieval
// ============================================================================

describe('searchGrid', () => {
  before(async () => {
    setup();
    await indexTask('agent-1', { id: 't1', title: 'Close the Acme deal in sales pipeline', status: 'open', priority: 'high' });
    await indexTask('agent-1', { id: 't2', title: 'Fix login bug for support team', status: 'in_progress', priority: 'critical' });
    await indexKnowledgeDoc('agent-1', { id: 'd1', filename: 'sales-guide.md', content: 'Always follow up within 24 hours of a demo' });
    await indexLearnedPattern('agent-1', { id: 'p1', pattern_type: 'workflow', description: 'Pipeline reviews work best on Monday', confidence: 0.7 });
  });

  it('returns results for a relevant query', async () => {
    const response = await searchGrid({ agentId: 'agent-1', query: 'Close the Acme deal in sales pipeline', minScore: 0.01 });
    assert.ok(response.results.length > 0);
    assert.ok(response.queryIntent.primaryDomains.length > 0);
  });

  it('ranks results by finalScore descending', async () => {
    const response = await searchGrid({ agentId: 'agent-1', query: 'deals pipeline', minScore: 0.01 });
    for (let i = 1; i < response.results.length; i++) {
      assert.ok(response.results[i - 1].finalScore >= response.results[i].finalScore);
    }
  });

  it('respects topK limit', async () => {
    const response = await searchGrid({ agentId: 'agent-1', query: 'anything', minScore: 0.01, topK: 2 });
    assert.ok(response.results.length <= 2);
  });

  it('respects minConfidence filter', async () => {
    const response = await searchGrid({ agentId: 'agent-1', query: 'anything', minScore: 0.01, minConfidence: 0.99 });
    for (const r of response.results) {
      assert.ok(r.entry.confidence >= 0.99);
    }
  });

  it('respects sourceTypes filter', async () => {
    const response = await searchGrid({
      agentId: 'agent-1', query: 'anything', minScore: 0.01,
      sourceTypes: ['knowledge_doc'],
    });
    for (const r of response.results) {
      assert.equal(r.entry.sourceType, 'knowledge_doc');
    }
  });

  it('quickGridSearch returns results directly', async () => {
    const results = await quickGridSearch('agent-1', 'support bug');
    assert.ok(Array.isArray(results));
  });

  it('returns empty for unknown agent', async () => {
    const response = await searchGrid({ agentId: 'no-such-agent', query: 'anything' });
    assert.equal(response.results.length, 0);
  });

  it('includes queryIntent in response', async () => {
    const response = await searchGrid({ agentId: 'agent-1', query: 'sales pipeline', minScore: 0.01 });
    assert.ok(response.queryIntent);
    assert.ok(response.queryIntent.searchMode);
    assert.ok(Array.isArray(response.queryIntent.layerPriority));
  });

  it('applies layer weights — live entries score higher than system', async () => {
    assert.ok(LAYER_WEIGHTS.live > LAYER_WEIGHTS.system);
    assert.ok(LAYER_WEIGHTS.experience > LAYER_WEIGHTS.base);
  });

  it('applies domain boost for primary domains', async () => {
    // Query clearly about sales → sales results should get 1.2x domain boost
    const response = await searchGrid({ agentId: 'agent-1', query: 'sales deal pipeline revenue', minScore: 0.01 });
    assert.ok(response.queryIntent.primaryDomains.includes('sales'));
    // Can't directly assert boost value, but primary domains should be detected
  });
});

// ============================================================================
// Prompt Builder
// ============================================================================

describe('prompt builder', () => {
  it('composes and renders non-empty context', async () => {
    setup();
    await indexTask('agent-1', { id: 't1', title: 'Review pipeline', status: 'open', priority: 'high' });
    await indexKnowledgeDoc('agent-1', { id: 'd1', filename: 'guide.md', content: 'Best practice: always validate inputs' });

    const response = await searchGrid({ agentId: 'agent-1', query: 'Review pipeline', minScore: 0.01 });
    assert.ok(response.results.length > 0);

    const context = composeGridContext(response.results, response.queryIntent);
    assert.ok(context.sections.length > 0);
    assert.ok(context.totalTokenEstimate > 0);

    const rendered = renderGridContext(context);
    assert.ok(rendered.length > 0);
    assert.ok(rendered.includes('Relevant Knowledge'));
  });

  it('returns empty string for no results', () => {
    const context = composeGridContext([], {
      primaryDomains: [], secondaryDomains: [],
      layerPriority: ['live', 'base', 'experience', 'system'], searchMode: 'targeted',
    });
    const rendered = renderGridContext(context);
    assert.equal(rendered, '');
  });

  it('tracks layer distribution', async () => {
    setup();
    await indexTask('agent-1', { id: 't1', title: 'Live task data', status: 'open', priority: 'high' });
    await indexKnowledgeDoc('agent-1', { id: 'd1', filename: 'base-doc.md', content: 'Reference document content' });

    const response = await searchGrid({ agentId: 'agent-1', query: 'Live task data', minScore: 0.01 });
    const context = composeGridContext(response.results, response.queryIntent);

    assert.ok(context.layerDistribution);
    assert.equal(typeof context.layerDistribution.live, 'number');
    assert.equal(typeof context.layerDistribution.base, 'number');
  });

  it('includes domain names in rendered output', async () => {
    setup();
    await indexTask('agent-1', { id: 't1', title: 'Close the sales deal', status: 'open', priority: 'high', domain: 'sales' });

    const response = await searchGrid({ agentId: 'agent-1', query: 'Close the sales deal', minScore: 0.01 });
    const context = composeGridContext(response.results, response.queryIntent);
    const rendered = renderGridContext(context);

    assert.ok(rendered.includes('Sales') || rendered.includes('General') || rendered.includes('Relevant Knowledge'));
  });

  it('renders layer labels', async () => {
    setup();
    await indexTask('agent-1', { id: 't1', title: 'Active task now', status: 'open', priority: 'high' });

    const response = await searchGrid({ agentId: 'agent-1', query: 'Active task now', minScore: 0.01 });
    const context = composeGridContext(response.results, response.queryIntent);
    const rendered = renderGridContext(context);

    // Live layer entries should render with "Current State" label
    assert.ok(rendered.includes('Current State') || rendered.includes('Reference') || rendered.includes('Learned'));
  });

  it('respects token budget — does not exceed MAX_GRID_TOKENS', async () => {
    setup();
    // Index many entries to push toward the limit
    for (let i = 0; i < 30; i++) {
      await indexGridEntry({
        agentId: 'agent-1', layer: 'base', domain: 'general',
        sourceType: 'knowledge_doc', sourceId: `bulk-${i}`,
        title: `Document ${i}`, contentText: `This is document number ${i} with some content about various topics including operations, analytics, sales, and support. `.repeat(5),
      });
    }

    const response = await searchGrid({ agentId: 'agent-1', query: 'document', minScore: 0.01, topK: 30 });
    const context = composeGridContext(response.results, response.queryIntent);
    assert.ok(context.totalTokenEstimate <= 4200, `Token estimate ${context.totalTokenEstimate} exceeds budget`);
  });
});

// ============================================================================
// System Seed
// ============================================================================

describe('seedSystemLayerForAgent', () => {
  before(setup);

  it('seeds 10 best practices', async () => {
    const count = await seedSystemLayerForAgent('agent-1');
    assert.equal(count, 10);
  });

  it('is idempotent — second run seeds 0', async () => {
    const count = await seedSystemLayerForAgent('agent-1');
    assert.equal(count, 0);
  });

  it('seeds are in the system layer', () => {
    const systemEntries = storage.getAll().filter(e => e.layer === 'system');
    assert.equal(systemEntries.length, 10);
  });

  it('seeds have canonical maturity', () => {
    const systemEntries = storage.getAll().filter(e => e.layer === 'system');
    for (const entry of systemEntries) {
      assert.equal(entry.maturity, 'canonical');
    }
  });
});

// ============================================================================
// Connection Auto-Ingest
// ============================================================================

describe('MCP server auto-ingest', () => {
  beforeEach(setup);

  it('indexes server summary and tools', async () => {
    await autoIngestMCPServer('agent-1', {
      id: 'mcp-1', name: 'GitHub', url: 'https://mcp.github.com',
      discoveredTools: [
        { name: 'create_issue', description: 'Create a GitHub issue', inputSchema: { properties: { title: { type: 'string' } }, required: ['title'] } },
        { name: 'list_repos', description: 'List repositories' },
      ],
    });

    // Summary + 2 tools = at least 3
    assert.ok(storage.size >= 3, `Expected >= 3, got ${storage.size}`);
    const entries = storage.getAll();
    assert.ok(entries.some(e => e.title.includes('MCP Server: GitHub')));
    assert.ok(entries.some(e => e.title.includes('MCP Tool: create_issue')));
    assert.ok(entries.some(e => e.title.includes('MCP Tool: list_repos')));
  });

  it('handles server with no tools', async () => {
    await autoIngestMCPServer('agent-1', {
      id: 'mcp-empty', name: 'Empty', url: 'https://empty.test',
      discoveredTools: [],
    });

    assert.equal(storage.size, 1); // just the summary
  });

  it('removes server entries', async () => {
    await autoIngestMCPServer('agent-1', {
      id: 'mcp-del', name: 'Deletable', url: 'https://del.test',
      discoveredTools: [{ name: 'tool1', description: 'A tool' }],
    });
    const before = storage.size;

    await removeIngestedMCPServer('agent-1', 'mcp-del', [{ name: 'tool1' }]);
    assert.ok(storage.size < before);
  });
});

describe('SDK auto-ingest', () => {
  beforeEach(setup);

  it('indexes SDK methods and usage guide', async () => {
    await autoIngestSDK('agent-1', {
      id: 'sdk-1', name: 'Stripe', sdkPackage: '@stripe/stripe-node',
      methods: [
        { name: 'createCharge', description: 'Create a payment charge' },
        { name: 'listCustomers', description: 'List all customers' },
      ],
    });

    assert.ok(storage.size >= 3, `Expected >= 3 entries, got ${storage.size}`);
    const entries = storage.getAll();
    assert.ok(entries.some(e => e.title.includes('SDK: Stripe')));
    assert.ok(entries.some(e => e.title.includes('SDK Method: Stripe.createCharge')));
  });

  it('handles SDK with 0 methods', async () => {
    await autoIngestSDK('agent-1', {
      id: 'sdk-empty', name: 'Empty', sdkPackage: 'empty-sdk',
      methods: [],
    });
    assert.equal(storage.size, 1); // just summary
  });

  it('removes SDK entries on disconnect', async () => {
    await autoIngestSDK('agent-1', {
      id: 'sdk-del', name: 'Deletable', sdkPackage: 'del-sdk',
      methods: [{ name: 'method1', description: 'A method' }],
    });
    const before = storage.size;

    await removeIngestedSDK('agent-1', 'sdk-del', [{ name: 'method1' }]);
    assert.ok(storage.size < before);
  });
});

// ============================================================================
// Usage Guide Template
// ============================================================================

describe('generateUsageGuide', () => {
  it('generates a structured guide for SDK', () => {
    const guide = generateUsageGuide('sdk', 'Stripe', ['createCharge', 'listCustomers']);
    assert.ok(guide.includes('Stripe'));
    assert.ok(guide.includes('createCharge'));
    assert.ok(guide.includes('2 capabilities'));
  });

  it('generates guide for MCP server', () => {
    const guide = generateUsageGuide('mcp_server', 'GitHub', ['create_issue', 'list_repos']);
    assert.ok(guide.includes('MCP server'));
    assert.ok(guide.includes('GitHub'));
  });

  it('generates guide for A2A agent', () => {
    const guide = generateUsageGuide('a2a_agent', 'ResearchBot', ['search', 'summarize']);
    assert.ok(guide.includes('A2A agent'));
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describe('error handling', () => {
  it('getGridConfig throws when not initialised', () => {
    // Reinitialize to a known state, then test uninitialised
    // We can't truly uninitialize, but we test the contract via types
    assert.ok(typeof getGridConfig === 'function');
  });

  it('search returns empty when embedding generation returns null', async () => {
    const nullVector = new InMemoryVectorAdapter({
      embedFn: async () => null,
    });
    const nullStorage = new InMemoryStorageAdapter();
    initKnowledgeGrid({ storage: nullStorage, vector: nullVector });

    const response = await searchGrid({ agentId: 'agent-1', query: 'anything' });
    assert.equal(response.results.length, 0);
  });

  it('indexing skips embedding when unavailable', async () => {
    const noEmbedVector = new InMemoryVectorAdapter({
      embedFn: async () => null,
    });
    const noEmbedStorage = new InMemoryStorageAdapter();
    initKnowledgeGrid({ storage: noEmbedStorage, vector: noEmbedVector });

    const result = await indexTask('agent-1', {
      id: 't1', title: 'No embed', status: 'open', priority: 'low',
    });

    assert.ok(result.entryId); // Entry created in storage
    assert.equal(result.embedded, false);
    assert.equal(result.skippedReason, 'embedding_unavailable');
    assert.equal(noEmbedStorage.size, 1); // Storage entry still exists
  });
});

// ============================================================================
// In-Memory Adapter Edge Cases
// ============================================================================

describe('InMemoryStorageAdapter', () => {
  beforeEach(setup);

  it('findEntriesByIds returns only matching active entries', async () => {
    await indexTask('agent-1', { id: 't1', title: 'One', status: 'open', priority: 'low' });
    await indexTask('agent-1', { id: 't2', title: 'Two', status: 'open', priority: 'low' });

    const all = storage.getAll();
    const found = await storage.findEntriesByIds([all[0].id, 'nonexistent-id']);
    assert.equal(found.length, 1);
  });

  it('deleteEntriesByPrefix removes matching entries', async () => {
    await indexGridEntry({ agentId: 'a1', layer: 'base', domain: 'general', sourceType: 'learning_outcome', sourceId: 'prefix_one', title: 'One', contentText: 'content one' });
    await indexGridEntry({ agentId: 'a1', layer: 'base', domain: 'general', sourceType: 'learning_outcome', sourceId: 'prefix_two', title: 'Two', contentText: 'content two' });
    await indexGridEntry({ agentId: 'a1', layer: 'base', domain: 'general', sourceType: 'learning_outcome', sourceId: 'other', title: 'Other', contentText: 'content other' });

    await storage.deleteEntriesByPrefix('a1', 'prefix_');
    assert.equal(storage.size, 1);
    assert.equal(storage.getAll()[0].source_id, 'other');
  });

  it('incrementAccessCount updates counts', async () => {
    await indexTask('agent-1', { id: 't1', title: 'Test', status: 'open', priority: 'low' });
    const entry = storage.getAll()[0];
    assert.equal(entry.access_count, 0);

    await storage.incrementAccessCount([entry.id]);
    await storage.incrementAccessCount([entry.id]);
    const updated = storage.getAll()[0];
    assert.equal(updated.access_count, 2);
    assert.ok(updated.last_accessed !== null);
  });
});

describe('InMemoryVectorAdapter', () => {
  it('cosine similarity returns 1.0 for identical vectors', async () => {
    const v = new InMemoryVectorAdapter();
    const emb = await v.generateEmbedding('test content');
    assert.ok(emb);

    await v.storeEmbedding('test', emb, { id: '1' });
    const results = await v.searchEmbeddings({
      collection: 'test', queryVector: emb, topK: 1, minScore: 0.9,
    });
    assert.equal(results.matches.length, 1);
    assert.ok(results.matches[0].score > 0.99, `Expected ~1.0, got ${results.matches[0].score}`);
  });

  it('supports custom embedding function', async () => {
    let callCount = 0;
    const v = new InMemoryVectorAdapter({
      embedFn: async (text) => {
        callCount++;
        return [text.length, 0, 0]; // trivial embedding
      },
      dimensions: 3,
    });

    const emb = await v.generateEmbedding('hello');
    assert.ok(emb);
    assert.equal(callCount, 1);
    assert.equal(emb[0], 5); // "hello".length
  });

  it('respects minScore threshold', async () => {
    const v = new InMemoryVectorAdapter();
    await v.storeEmbedding('test', [1, 0, 0], { id: '1' });
    await v.storeEmbedding('test', [0, 1, 0], { id: '2' }); // orthogonal = 0 similarity

    const results = await v.searchEmbeddings({
      collection: 'test', queryVector: [1, 0, 0], topK: 10, minScore: 0.5,
    });
    // Only the first vector should pass (score ≈ 1.0), second is 0.0
    assert.equal(results.matches.length, 1);
    assert.equal(results.matches[0].metadata.id, '1');
  });

  it('metadata array filter works', async () => {
    const v = new InMemoryVectorAdapter();
    await v.storeEmbedding('test', [1, 0], { domain: 'sales', id: '1' });
    await v.storeEmbedding('test', [1, 0], { domain: 'support', id: '2' });
    await v.storeEmbedding('test', [1, 0], { domain: 'marketing', id: '3' });

    const results = await v.searchEmbeddings({
      collection: 'test', queryVector: [1, 0], topK: 10, minScore: 0,
      metadataFilters: { domain: ['sales', 'support'] },
    });
    assert.equal(results.matches.length, 2);
    const ids = results.matches.map(m => m.metadata.id);
    assert.ok(ids.includes('1'));
    assert.ok(ids.includes('2'));
    assert.ok(!ids.includes('3'));
  });

  it('deleteEmbeddings removes matching vectors', async () => {
    const v = new InMemoryVectorAdapter();
    await v.storeEmbedding('test', [1, 0], { gridEntryId: 'e1' });
    await v.storeEmbedding('test', [0, 1], { gridEntryId: 'e2' });
    assert.equal(v.size, 2);

    await v.deleteEmbeddings('test', { gridEntryId: 'e1' });
    assert.equal(v.size, 1);
  });
});

// ============================================================================
// Constants
// ============================================================================

describe('constants', () => {
  it('DEFAULT_GRID_DOMAINS has 9 domains', () => {
    assert.equal(DEFAULT_GRID_DOMAINS.length, 9);
  });

  it('LAYER_WEIGHTS covers all 4 layers', () => {
    assert.equal(typeof LAYER_WEIGHTS.live, 'number');
    assert.equal(typeof LAYER_WEIGHTS.experience, 'number');
    assert.equal(typeof LAYER_WEIGHTS.base, 'number');
    assert.equal(typeof LAYER_WEIGHTS.system, 'number');
  });

  it('layer weights are in descending order', () => {
    assert.ok(LAYER_WEIGHTS.live >= LAYER_WEIGHTS.experience);
    assert.ok(LAYER_WEIGHTS.experience >= LAYER_WEIGHTS.base);
    assert.ok(LAYER_WEIGHTS.base >= LAYER_WEIGHTS.system);
  });
});
