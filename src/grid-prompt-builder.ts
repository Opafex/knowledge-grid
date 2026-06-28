/**
 * Grid Prompt Builder
 *
 * Constructs grid-aware prompt sections from search results.
 * Organizes results into domain sections for injection into the system prompt.
 *
 * @module @opafex/knowledge-grid/grid-prompt-builder
 */

import type {
  GridDomain,
  GridLayer,
  GridSearchResult,
  GridContextSection,
  GridPromptContext,
  MaturationLevel,
  QueryIntent,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const CHARS_PER_TOKEN = 4;
const MAX_GRID_TOKENS = 4000;
const MAX_PRIMARY_SECTION_TOKENS = 1200;
const MAX_SECONDARY_SECTION_TOKENS = 400;
const MAX_ENTRY_CHARS = 500;
const MAX_TOOL_ENTRY_CHARS = 1000;
const MAX_LOCALE_SECTION_TOKENS = 400;

// ============================================================================
// Context Composition
// ============================================================================

/**
 * Build grid prompt context from search results.
 * Organizes results into domain sections with token budgeting.
 */
export function composeGridContext(
  results: GridSearchResult[],
  intent: QueryIntent,
  maturationLevels?: Record<string, MaturationLevel>,
): GridPromptContext {
  if (results.length === 0) {
    return {
      sections: [],
      totalTokenEstimate: 0,
      domainsIncluded: [],
      layerDistribution: { system: 0, base: 0, experience: 0, live: 0 },
    };
  }

  const localeResults = results.filter(r => r.entry.sourceType === 'locale_context');
  const domainResults = results.filter(r => r.entry.sourceType !== 'locale_context');

  const byDomain = new Map<GridDomain, GridSearchResult[]>();
  for (const result of domainResults) {
    const domain = result.entry.domain;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(result);
  }

  const sections: GridContextSection[] = [];
  let totalTokens = 0;

  if (localeResults.length > 0) {
    const localeSection = buildLocaleSection(localeResults);
    sections.push(localeSection);
    totalTokens += localeSection.tokenEstimate;
  }

  for (const domain of intent.primaryDomains) {
    if (totalTokens >= MAX_GRID_TOKENS) break;
    const dr = byDomain.get(domain);
    if (!dr || dr.length === 0) continue;

    const maxTokens = Math.min(MAX_PRIMARY_SECTION_TOKENS, MAX_GRID_TOKENS - totalTokens);
    const section = buildDomainSection(domain, dr, true, maturationLevels?.[domain] ?? 'novice', maxTokens);
    sections.push(section);
    totalTokens += section.tokenEstimate;
  }

  for (const domain of intent.secondaryDomains) {
    if (totalTokens >= MAX_GRID_TOKENS) break;
    const dr = byDomain.get(domain);
    if (!dr || dr.length === 0) continue;

    const maxTokens = Math.min(MAX_SECONDARY_SECTION_TOKENS, MAX_GRID_TOKENS - totalTokens);
    const section = buildDomainSection(domain, dr, false, maturationLevels?.[domain] ?? 'novice', maxTokens);
    sections.push(section);
    totalTokens += section.tokenEstimate;
  }

  const coveredDomains = new Set([...intent.primaryDomains, ...intent.secondaryDomains]);
  for (const [domain, dr] of byDomain) {
    if (coveredDomains.has(domain)) continue;
    if (totalTokens >= MAX_GRID_TOKENS) break;

    const maxTokens = Math.min(MAX_SECONDARY_SECTION_TOKENS, MAX_GRID_TOKENS - totalTokens);
    const section = buildDomainSection(domain, dr, false, maturationLevels?.[domain] ?? 'novice', maxTokens);
    sections.push(section);
    totalTokens += section.tokenEstimate;
  }

  const layerDistribution: Record<GridLayer, number> = { system: 0, base: 0, experience: 0, live: 0 };
  for (const section of sections) {
    for (const entry of section.entries) {
      layerDistribution[entry.layer]++;
    }
  }

  return {
    sections,
    totalTokenEstimate: totalTokens,
    domainsIncluded: sections.map(s => s.domain),
    layerDistribution,
  };
}

function buildLocaleSection(results: GridSearchResult[]): GridContextSection {
  const entries: GridContextSection['entries'] = [];
  let tokenEstimate = 15;

  for (const result of results) {
    const contentTruncated = result.entry.contentText.slice(0, MAX_ENTRY_CHARS);
    const entryTokens = Math.ceil((result.entry.title.length + contentTruncated.length + 20) / CHARS_PER_TOKEN);
    if (tokenEstimate + entryTokens > MAX_LOCALE_SECTION_TOKENS) break;

    entries.push({
      layer: result.entry.layer,
      title: result.entry.title,
      content: contentTruncated,
      sourceType: result.entry.sourceType,
      confidence: result.entry.confidence,
    });
    tokenEstimate += entryTokens;
  }

  return { domain: 'general', isPrimary: true, entries, maturationLevel: 'expert', tokenEstimate };
}

function buildDomainSection(
  domain: GridDomain,
  results: GridSearchResult[],
  isPrimary: boolean,
  maturationLevel: MaturationLevel,
  maxTokens: number,
): GridContextSection {
  const entries: GridContextSection['entries'] = [];
  let tokenEstimate = 10;

  const sorted = [...results].sort((a, b) => b.finalScore - a.finalScore);

  for (const result of sorted) {
    const charLimit = result.entry.sourceType === 'tool_capability' ? MAX_TOOL_ENTRY_CHARS : MAX_ENTRY_CHARS;
    const contentTruncated = result.entry.contentText.slice(0, charLimit);
    const entryTokens = Math.ceil((result.entry.title.length + contentTruncated.length + 20) / CHARS_PER_TOKEN);
    if (tokenEstimate + entryTokens > maxTokens) break;

    entries.push({
      layer: result.entry.layer,
      title: result.entry.title,
      content: contentTruncated,
      sourceType: result.entry.sourceType,
      confidence: result.entry.confidence,
    });
    tokenEstimate += entryTokens;
  }

  return { domain, isPrimary, entries, maturationLevel, tokenEstimate };
}

// ============================================================================
// Prompt Rendering
// ============================================================================

/**
 * Render grid context into a string for injection into the system prompt.
 */
export function renderGridContext(context: GridPromptContext): string {
  if (context.sections.length === 0) return '';

  const parts: string[] = [];

  const localeSections = context.sections.filter(s =>
    s.entries.some(e => e.sourceType === 'locale_context'),
  );
  const domainSections = context.sections.filter(s =>
    !s.entries.some(e => e.sourceType === 'locale_context'),
  );

  if (localeSections.length > 0) {
    parts.push('## Language Context');
    for (const section of localeSections) {
      for (const entry of section.entries) {
        parts.push(`- [locale_context] ${entry.title}: ${entry.content}`);
      }
    }
    parts.push('');
  }

  if (domainSections.length > 0) {
    parts.push('## Relevant Knowledge');

    for (const section of domainSections) {
      if (section.entries.length === 0) continue;

      const depthLabel = section.isPrimary ? '' : ' (supplementary)';
      parts.push(`\n### ${formatDomainName(section.domain)}${depthLabel}`);

      const byLayer = groupByLayer(section.entries);
      for (const [layer, entries] of byLayer) {
        if (entries.length === 0) continue;
        parts.push(`\n**${formatLayerName(layer)}:**`);
        for (const entry of entries) {
          parts.push(`- [${entry.sourceType}] ${entry.title}: ${entry.content}`);
        }
      }
    }
  }

  return parts.join('\n');
}

// ============================================================================
// Helpers
// ============================================================================

function formatDomainName(domain: GridDomain): string {
  const names: Record<string, string> = {
    sales: 'Sales', marketing: 'Marketing', support: 'Support',
    analytics: 'Analytics', operations: 'Operations', social: 'Social',
    general: 'General', platform: 'Platform', integrations: 'Integrations',
  };
  return names[domain] ?? domain;
}

function formatLayerName(layer: GridLayer): string {
  const names: Record<string, string> = {
    system: 'Platform Knowledge', base: 'Reference',
    experience: 'Learned', live: 'Current State',
  };
  return names[layer] ?? layer;
}

function groupByLayer(
  entries: GridContextSection['entries'],
): Map<GridLayer, GridContextSection['entries']> {
  const map = new Map<GridLayer, GridContextSection['entries']>();
  const layerOrder: GridLayer[] = ['live', 'experience', 'base', 'system'];

  for (const layer of layerOrder) {
    const layerEntries = entries.filter(e => e.layer === layer);
    if (layerEntries.length > 0) map.set(layer, layerEntries);
  }

  return map;
}
