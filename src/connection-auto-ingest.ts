/**
 * Connection Auto-Ingest (Template-Based)
 *
 * Indexes MCP server tools, A2A agent skills, and SDK methods into the
 * knowledge grid when connections are established.
 *
 * Uses template-based usage guides (no LLM calls).
 * LLM-powered research is an Intelligence-tier feature.
 *
 * @module @opafex/knowledge-grid/connection-auto-ingest
 */

import { indexGridEntry, removeGridEntry } from './indexing-pipeline.js';
import { getGridConfig } from './adapters.js';

type ConnectionType = 'mcp_server' | 'a2a_agent' | 'integration' | 'custom_integration' | 'sdk';

// ============================================================================
// Template-Based Usage Guide
// ============================================================================

/**
 * Generate a structured usage guide from metadata (no LLM call).
 */
export function generateUsageGuide(type: ConnectionType, name: string, capabilities: string[]): string {
  const typeLabel = type === 'mcp_server' ? 'MCP server'
    : type === 'a2a_agent' ? 'A2A agent'
    : type === 'sdk' ? 'SDK'
    : type === 'custom_integration' ? 'custom integration'
    : 'integration';

  return [
    `Usage Guide: ${name} (${typeLabel})`,
    '',
    `Available capabilities: ${capabilities.join(', ')}`,
    '',
    `This ${typeLabel} provides ${capabilities.length} capabilities.`,
    `Use this connection when you need to: ${capabilities.slice(0, 5).join(', ')}.`,
  ].join('\n');
}

// ============================================================================
// MCP Server Auto-Ingest
// ============================================================================

export interface MCPToolInput {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export async function autoIngestMCPServer(
  agentId: string,
  server: { id: string; name: string; url: string; discoveredTools: MCPToolInput[] },
): Promise<void> {
  try {
    const tools = server.discoveredTools || [];
    const toolNames = tools.map(t => t.name);

    const serverContent = [
      `MCP Server: ${server.name}`,
      `URL: ${server.url}`,
      `Tool count: ${tools.length}`,
      tools.length > 0 ? `Tools: ${toolNames.join(', ')}` : 'No tools discovered',
    ].join('\n');

    await indexGridEntry({
      agentId,
      layer: 'base',
      domain: 'integrations',
      sourceType: 'tool_capability',
      sourceId: `mcp_server_${server.id}`,
      title: `MCP Server: ${server.name}`,
      contentText: serverContent,
      metadata: { serverUrl: server.url, toolCount: tools.length, toolNames },
      tags: ['mcp', 'server', ...toolNames],
    });

    for (const tool of tools) {
      const properties = tool.inputSchema?.properties || {};
      const required = tool.inputSchema?.required || [];
      const propNames = Object.keys(properties);

      const toolContent = [
        `MCP Tool: ${tool.name}`,
        tool.description ? `Description: ${tool.description}` : '',
        propNames.length > 0 ? `Parameters: ${propNames.join(', ')}` : 'No parameters',
        required.length > 0 ? `Required: ${required.join(', ')}` : '',
      ].filter(Boolean).join('\n');

      await indexGridEntry({
        agentId,
        layer: 'base',
        domain: 'integrations',
        sourceType: 'tool_capability',
        sourceId: `mcp_tool_${server.id}_${tool.name}`,
        title: `MCP Tool: ${tool.name}`,
        contentText: toolContent,
        metadata: { serverId: server.id, serverName: server.name, inputSchema: tool.inputSchema },
        tags: ['mcp', 'tool', tool.name],
      });
    }

    // Template-based usage guide
    if (tools.length > 0) {
      const guide = generateUsageGuide('mcp_server', server.name, toolNames);
      indexGridEntry({
        agentId,
        layer: 'base',
        domain: 'integrations',
        sourceType: 'learning_outcome',
        sourceId: `research_guide_mcp_server_${server.id}`,
        title: `Usage Guide: ${server.name}`,
        contentText: guide,
        confidence: 0.7,
        tags: ['mcp', 'guide'],
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[KnowledgeGrid] MCP server auto-ingest failed:', err);
  }
}

// ============================================================================
// SDK Auto-Ingest
// ============================================================================

export interface SDKMethodInput {
  name: string;
  description: string;
  parameters?: { name: string; type: string; description?: string }[];
  category?: string;
}

export async function autoIngestSDK(
  agentId: string,
  sdk: {
    id: string;
    name: string;
    sdkPackage: string;
    sdkVersion?: string;
    methods: SDKMethodInput[];
  },
): Promise<void> {
  try {
    const methods = sdk.methods || [];
    const methodNames = methods.map(m => m.name);

    const summaryContent = [
      `SDK: ${sdk.name}`,
      `Package: ${sdk.sdkPackage}${sdk.sdkVersion ? `@${sdk.sdkVersion}` : ''}`,
      `Method count: ${methods.length}`,
      methods.length > 0 ? `Methods: ${methodNames.join(', ')}` : 'No methods discovered',
    ].join('\n');

    await indexGridEntry({
      agentId,
      layer: 'base',
      domain: 'integrations',
      sourceType: 'tool_capability',
      sourceId: `sdk_${sdk.id}`,
      title: `SDK: ${sdk.name}`,
      contentText: summaryContent,
      metadata: { sdkPackage: sdk.sdkPackage, methodCount: methods.length, methodNames },
      tags: ['sdk', sdk.sdkPackage, ...methodNames],
    });

    for (const method of methods) {
      const params = method.parameters || [];
      const paramNames = params.map(p => p.name);

      const methodContent = [
        `SDK Method: ${method.name}`,
        method.description ? `Description: ${method.description}` : '',
        paramNames.length > 0 ? `Parameters: ${paramNames.join(', ')}` : 'No parameters',
        method.category ? `Category: ${method.category}` : '',
      ].filter(Boolean).join('\n');

      await indexGridEntry({
        agentId,
        layer: 'base',
        domain: 'integrations',
        sourceType: 'tool_capability',
        sourceId: `sdk_method_${sdk.id}_${method.name}`,
        title: `SDK Method: ${sdk.name}.${method.name}`,
        contentText: methodContent,
        metadata: { sdkId: sdk.id, sdkName: sdk.name, sdkPackage: sdk.sdkPackage, parameters: params },
        tags: ['sdk', 'method', method.name, method.category || 'core'],
      });
    }

    // Template-based usage guide
    if (methods.length > 0) {
      const guide = generateUsageGuide('sdk', sdk.name, methodNames);
      indexGridEntry({
        agentId,
        layer: 'base',
        domain: 'integrations',
        sourceType: 'learning_outcome',
        sourceId: `research_guide_sdk_${sdk.id}`,
        title: `Usage Guide: ${sdk.name}`,
        contentText: guide,
        confidence: 0.7,
        tags: ['sdk', 'guide', sdk.sdkPackage],
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[KnowledgeGrid] SDK auto-ingest failed:', err);
    throw err;
  }
}

// ============================================================================
// Removal
// ============================================================================

export async function removeIngestedMCPServer(
  agentId: string,
  serverId: string,
  tools: { name: string }[],
): Promise<void> {
  try {
    await removeGridEntry(agentId, 'tool_capability', `mcp_server_${serverId}`);
    for (const tool of tools) {
      await removeGridEntry(agentId, 'tool_capability', `mcp_tool_${serverId}_${tool.name}`);
    }
    await removeGridEntry(agentId, 'learning_outcome', `research_guide_mcp_server_${serverId}`);
    const { storage } = getGridConfig();
    await storage.deleteEntriesByPrefix(agentId, `deep_research_mcp_server_${serverId}`);
  } catch (err) {
    console.error('[KnowledgeGrid] MCP server removal failed:', err);
  }
}

export async function removeIngestedSDK(
  agentId: string,
  sdkId: string,
  methods: { name: string }[],
): Promise<void> {
  try {
    await removeGridEntry(agentId, 'tool_capability', `sdk_${sdkId}`);
    await removeGridEntry(agentId, 'learning_outcome', `research_guide_sdk_${sdkId}`);
    for (const method of methods) {
      await removeGridEntry(agentId, 'tool_capability', `sdk_method_${sdkId}_${method.name}`);
    }
  } catch (err) {
    console.warn('[KnowledgeGrid] SDK removal failed:', err instanceof Error ? err.message : err);
  }
}
