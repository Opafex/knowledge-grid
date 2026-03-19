/**
 * System Layer Seed
 *
 * Seeds new agents with curated system-level best practices.
 * These represent collective intelligence — operational insights that are
 * true regardless of industry or specific agent configuration.
 *
 * @module @intelagent/knowledge-grid/system-layer-seed
 */

import { indexSystemBestPractice } from './indexing-pipeline';
import { getGridConfig } from './adapters';
import type { GridDomain } from './types';

interface SystemBestPractice {
  id: string;
  title: string;
  content: string;
  domain: GridDomain;
  tags: string[];
}

const SYSTEM_BEST_PRACTICES: SystemBestPractice[] = [
  {
    id: 'system_bp_api_auth_first',
    title: 'Validate API authentication before data operations',
    content: 'When integrating with external APIs, always validate authentication credentials before attempting data operations. Failed auth mid-workflow causes partial state and harder recovery. Check connection health early.',
    domain: 'integrations',
    tags: ['system', 'best-practice', 'integrations', 'api'],
  },
  {
    id: 'system_bp_workflow_size',
    title: 'Optimal workflow step count: 3-5 steps',
    content: 'Workflows with 3-5 steps have the highest completion rate. Break complex workflows into smaller sequential chains rather than one large workflow. Each chain should have a clear success/failure boundary.',
    domain: 'operations',
    tags: ['system', 'best-practice', 'workflow', 'operations'],
  },
  {
    id: 'system_bp_approval_threshold',
    title: 'Build trust through approval history before auto-execution',
    content: 'High-risk actions should be queued for human approval until the agent has 5+ successful precedents for that action type with zero rejections. Progressive trust prevents costly mistakes early in the relationship.',
    domain: 'operations',
    tags: ['system', 'best-practice', 'approval', 'trust'],
  },
  {
    id: 'system_bp_knowledge_context',
    title: 'Include relevant knowledge context in proposals',
    content: 'Proposals that reference specific knowledge sources (documents, past patterns, user preferences) have higher approval rates than generic proposals. Always retrieve and cite relevant context when generating actions.',
    domain: 'general',
    tags: ['system', 'best-practice', 'knowledge', 'proposals'],
  },
  {
    id: 'system_bp_error_recovery',
    title: 'Implement rollback for multi-step operations',
    content: 'Multi-step operations should log intermediate state so that failures at step N can roll back steps 1 through N-1. This is especially important for operations that modify external systems.',
    domain: 'operations',
    tags: ['system', 'best-practice', 'error-handling', 'rollback'],
  },
  {
    id: 'system_bp_data_freshness',
    title: 'Check data freshness before making decisions',
    content: 'Always verify that data used for decisions is current. Stale CRM data, outdated analytics, or cached API responses lead to incorrect actions. Prefer live queries over cached data for decision-critical operations.',
    domain: 'analytics',
    tags: ['system', 'best-practice', 'data', 'freshness'],
  },
  {
    id: 'system_bp_human_escalation',
    title: 'Escalate when confidence is below threshold',
    content: 'When agent confidence for an action is below 0.6, escalate to human review rather than proceeding. Low-confidence autonomous actions erode trust faster than delays from escalation.',
    domain: 'general',
    tags: ['system', 'best-practice', 'escalation', 'confidence'],
  },
  {
    id: 'system_bp_rate_limiting',
    title: 'Respect external API rate limits proactively',
    content: 'Track API rate limit headers and throttle requests proactively rather than waiting for 429 responses. Implement exponential backoff with jitter for retries.',
    domain: 'integrations',
    tags: ['system', 'best-practice', 'rate-limiting', 'api'],
  },
  {
    id: 'system_bp_context_window',
    title: 'Prioritize recent and relevant context over completeness',
    content: 'When context exceeds budget, prioritize recency and relevance over completeness. A focused 2000-token context outperforms a diluted 8000-token dump. Use domain relevance scoring to select what matters most.',
    domain: 'general',
    tags: ['system', 'best-practice', 'context', 'prompt'],
  },
  {
    id: 'system_bp_feedback_loop',
    title: 'Close the feedback loop on every action',
    content: 'Every agent action should have an observable outcome — approval, rejection, success, or failure. Unobserved actions create blind spots. Track outcomes to improve future decisions.',
    domain: 'general',
    tags: ['system', 'best-practice', 'feedback', 'learning'],
  },
];

/**
 * Seed system-level best practices for a new agent.
 * Idempotent — checks for existing entries before creating.
 */
export async function seedSystemLayerForAgent(agentId: string): Promise<number> {
  const { storage } = getGridConfig();
  let seeded = 0;

  for (const bp of SYSTEM_BEST_PRACTICES) {
    const existing = await storage.findEntry(agentId, 'system_best_practice', bp.id);
    if (existing) continue;

    const result = await indexSystemBestPractice(agentId, bp);
    if (result.entryId) seeded++;
  }

  return seeded;
}
