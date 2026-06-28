/**
 * Domain Inference
 *
 * Keyword-based heuristic to classify text content into grid domains.
 * No LLM call — fast, deterministic, and cheap. Falls back to 'general'.
 *
 * @module @opafex/knowledge-grid/domain-inference
 */

import type { GridDomain } from './types';
import { DEFAULT_GRID_DOMAINS } from './types';

// ============================================================================
// Domain Keyword Maps
// ============================================================================

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  sales: [
    'sales', 'lead', 'leads', 'prospect', 'pipeline', 'deal', 'deals',
    'revenue', 'quota', 'forecast', 'close', 'closing', 'opportunity',
    'commission', 'contract', 'proposal', 'pitch', 'outreach', 'cold call',
    'follow up', 'follow-up', 'negotiation', 'crm', 'hubspot', 'salesforce',
    'conversion', 'upsell', 'cross-sell', 'account executive', 'sdr', 'bdr',
    'demo', 'discovery call', 'objection', 'win rate', 'aro', 'arv', 'mrr',
    'arr', 'customer acquisition', 'funnel', 'b2b', 'b2c',
  ],
  marketing: [
    'marketing', 'campaign', 'campaigns', 'brand', 'branding', 'seo',
    'content', 'social media', 'email marketing', 'newsletter', 'blog',
    'advertising', 'ad', 'ads', 'ppc', 'impression', 'click-through',
    'ctr', 'engagement', 'audience', 'segment', 'persona', 'targeting',
    'creative', 'copy', 'copywriting', 'landing page', 'conversion rate',
    'a/b test', 'ab test', 'analytics', 'mailchimp', 'sendgrid',
    'influencer', 'affiliate', 'pr', 'public relations', 'launch',
    'product launch', 'go-to-market', 'gtm',
  ],
  support: [
    'support', 'ticket', 'tickets', 'help desk', 'helpdesk', 'customer service',
    'issue', 'bug', 'complaint', 'resolution', 'sla', 'response time',
    'escalation', 'escalate', 'triage', 'knowledge base', 'faq', 'troubleshoot',
    'troubleshooting', 'incident', 'outage', 'downtime', 'status page',
    'zendesk', 'freshdesk', 'intercom', 'live chat', 'chatbot',
    'customer satisfaction', 'csat', 'nps', 'feedback', 'refund', 'return',
  ],
  analytics: [
    'analytics', 'report', 'reports', 'reporting', 'dashboard', 'metric',
    'metrics', 'kpi', 'kpis', 'data', 'insight', 'insights', 'trend',
    'trends', 'forecast', 'forecasting', 'visualization', 'chart', 'graph',
    'benchmark', 'performance', 'roi', 'measurement', 'tracking', 'cohort',
    'segment', 'attribution', 'google analytics', 'mixpanel', 'amplitude',
    'looker', 'tableau', 'power bi', 'bi', 'business intelligence',
  ],
  operations: [
    'operations', 'ops', 'workflow', 'workflows', 'process', 'automation',
    'automate', 'schedule', 'scheduling', 'inventory', 'logistics',
    'supply chain', 'procurement', 'vendor', 'compliance', 'audit',
    'quality', 'qa', 'efficiency', 'optimization', 'resource', 'capacity',
    'project management', 'task management', 'sprint', 'kanban', 'agile',
    'jira', 'asana', 'monday', 'trello', 'notion', 'confluence',
  ],
  social: [
    'social', 'twitter', 'x.com', 'facebook', 'instagram', 'linkedin',
    'tiktok', 'youtube', 'pinterest', 'reddit', 'post', 'posting',
    'share', 'like', 'comment', 'follower', 'followers', 'hashtag',
    'viral', 'reach', 'engagement rate', 'social listening', 'mention',
    'mentions', 'dm', 'direct message', 'story', 'stories', 'reel', 'reels',
    'thread', 'community', 'community management', 'influencer',
  ],
  platform: [
    'platform', 'tool', 'tools', 'skill', 'skills', 'capability',
    'feature', 'config', 'configuration', 'settings', 'preference',
    'dashboard', 'widget', 'tab', 'navigation', 'agent', 'system',
    'api', 'webhook', 'integration', 'setup', 'onboarding',
  ],
  integrations: [
    'integration', 'integrations', 'connector', 'connect', 'connected',
    'sync', 'syncing', 'oauth', 'api key', 'webhook', 'webhooks',
    'third party', 'third-party', 'external', 'import', 'export',
    'migration', 'stripe', 'slack', 'zapier', 'make',
    'api', 'endpoint', 'mcp', 'a2a', 'delegate', 'capability',
    'parameter', 'schema', 'tool',
  ],
  general: [],
};

// ============================================================================
// Scoring
// ============================================================================

/**
 * Infer the most likely domain(s) from text content using keyword matching.
 *
 * Returns domains sorted by score (highest first).
 * The first result is the primary domain. If no keywords match, returns ['general'].
 */
export function inferDomains(
  text: string,
  customDomains?: Record<string, string[]>,
): GridDomain[] {
  if (!text || text.trim().length === 0) return ['general'];

  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (domain === 'general') continue;
    const score = scoreKeywords(lower, keywords);
    if (score > 0) scores[domain] = score;
  }

  if (customDomains) {
    for (const [domain, keywords] of Object.entries(customDomains)) {
      if ((DEFAULT_GRID_DOMAINS as readonly string[]).includes(domain)) continue;
      const score = scoreKeywords(lower, keywords);
      if (score > 0) scores[domain] = score;
    }
  }

  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([domain]) => domain as GridDomain);

  return sorted.length > 0 ? sorted : ['general'];
}

/** Score text against a keyword list */
function scoreKeywords(lower: string, keywords: string[]): number {
  let score = 0;
  for (const keyword of keywords) {
    if (keyword.length <= 3) {
      const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'gi');
      const matches: string[] = lower.match(regex) || [];
      score += matches.length;
    } else {
      let idx = 0;
      while ((idx = lower.indexOf(keyword, idx)) !== -1) {
        score++;
        idx += keyword.length;
      }
    }
  }
  return score;
}

/**
 * Infer a single primary domain. Convenience wrapper around inferDomains().
 */
export function inferPrimaryDomain(
  text: string,
  customDomains?: Record<string, string[]>,
): GridDomain {
  return inferDomains(text, customDomains)[0];
}

// ============================================================================
// Helpers
// ============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
