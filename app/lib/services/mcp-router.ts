export type AstroRole = 'planner' | 'ui' | 'backend' | 'db' | 'security' | 'router' | 'final';

export type McpToolMeta = {
  toolName: string;
  description?: string;
  serverName?: string;
};

type McpServerKind = 'webflow' | 'playwright' | 'design-inspiration' | 'generic';

const MAX_DTO_BYTES = 8000;

function detectServerKind(meta: McpToolMeta): McpServerKind {
  const key = `${meta.serverName || ''} ${meta.toolName}`.toLowerCase();

  if (key.includes('webflow') || key.includes('designer') || key.includes('collection') || key.includes('cms')) {
    return 'webflow';
  }

  if (key.includes('playwright') || key.includes('browser') || key.includes('navigate') || key.includes('screenshot')) {
    return 'playwright';
  }

  if (key.includes('21st') || key.includes('magic') || key.includes('inspiration') || key.includes('component gallery')) {
    return 'design-inspiration';
  }

  return 'generic';
}

function roleAllowlist(role: AstroRole): Array<(meta: McpToolMeta) => boolean> {
  const webflowTool = (meta: McpToolMeta) => detectServerKind(meta) === 'webflow';
  const playwrightTool = (meta: McpToolMeta) => detectServerKind(meta) === 'playwright';
  const inspirationTool = (meta: McpToolMeta) => detectServerKind(meta) === 'design-inspiration';
  const readLikeTool = (meta: McpToolMeta) =>
    /(get|list|read|fetch|query|search|navigate|extract|inspect)/i.test(meta.toolName);
  const mutateLikeTool = (meta: McpToolMeta) => /(create|update|delete|publish|write|push)/i.test(meta.toolName);

  if (role === 'ui') {
    return [
      (meta) => webflowTool(meta) && readLikeTool(meta),
      (meta) => playwrightTool(meta) && readLikeTool(meta),
      (meta) => inspirationTool(meta) && readLikeTool(meta),
    ];
  }

  if (role === 'backend' || role === 'db' || role === 'security') {
    return [(meta) => playwrightTool(meta) && readLikeTool(meta), (meta) => webflowTool(meta) && readLikeTool(meta)];
  }

  if (role === 'planner' || role === 'router' || role === 'final') {
    return [(meta) => readLikeTool(meta) && !mutateLikeTool(meta)];
  }

  return [readLikeTool];
}

export function selectMcpToolsForRole(args: {
  role: AstroRole;
  userRequest: string;
  tools: McpToolMeta[];
  maxTools?: number;
  publicDesignMode?: boolean;
}): McpToolMeta[] {
  const { role, tools, userRequest, maxTools = 6, publicDesignMode = false } = args;
  const allowRules = roleAllowlist(role);
  const q = userRequest.toLowerCase();

  const filtered = tools.filter((tool) => {
    if (publicDesignMode && detectServerKind(tool) === 'webflow') {
      return false;
    }

    return allowRules.some((rule) => rule(tool));
  });

  const scored = filtered
    .map((tool) => {
      const key = `${tool.toolName} ${tool.description || ''} ${tool.serverName || ''}`.toLowerCase();
      let score = 0;

      if (q.includes('webflow') && detectServerKind(tool) === 'webflow') {
        score += 4;
      }
      if ((q.includes('21st') || q.includes('magic')) && detectServerKind(tool) === 'design-inspiration') {
        score += 4;
      }
      if ((q.includes('search') || q.includes('docs') || q.includes('web')) && detectServerKind(tool) === 'playwright') {
        score += 4;
      }
      if (
        /(design|ui|layout|animation|interaction|frontend|landing|hero)/i.test(q) &&
        (detectServerKind(tool) === 'webflow' || detectServerKind(tool) === 'design-inspiration')
      ) {
        score += 3;
      }
      if (/(backend|api|auth|security|database|schema|deploy)/i.test(q) && detectServerKind(tool) === 'playwright') {
        score += 2;
      }
      if (/(get|list|read|fetch|search|navigate|extract)/i.test(tool.toolName)) {
        score += 1;
      }
      if (key.includes('schema') || key.includes('full')) {
        score -= 1;
      }

      return { tool, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.tool);

  return scored.slice(0, maxTools);
}

export function formatMcpToolPlan(role: AstroRole, tools: McpToolMeta[]): string {
  if (tools.length === 0) {
    return 'No MCP tools selected for this role.';
  }

  const lines = tools.map((tool) => `- ${tool.toolName} (${tool.serverName || 'unknown-server'})`);
  return `Role: ${role}\nAllowed MCP tools:\n${lines.join('\n')}`;
}

function trimString(input: string, max = 500): string {
  return input.length > max ? `${input.slice(0, max)}...` : input;
}

function pickWebflowDto(value: unknown): unknown {
  if (value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => pickWebflowDto(item));
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keep = ['id', 'name', 'slug', 'url', 'type', 'nodeId', 'collectionId', 'fields', 'items', 'status', 'title'];

    for (const key of keep) {
      if (key in obj) {
        const v = obj[key];
        out[key] = typeof v === 'string' ? trimString(v, 300) : pickWebflowDto(v);
      }
    }

    return out;
  }

  return typeof value === 'string' ? trimString(value, 300) : value;
}

function pickPlaywrightDto(value: unknown): unknown {
  if (value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => pickPlaywrightDto(item));
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keep = ['url', 'title', 'text', 'content', 'markdown', 'links', 'headings', 'summary', 'status'];

    for (const key of keep) {
      if (key in obj) {
        const v = obj[key];
        out[key] = typeof v === 'string' ? trimString(v, 800) : pickPlaywrightDto(v);
      }
    }

    return out;
  }

  return typeof value === 'string' ? trimString(value, 800) : value;
}

function enforceDtoSize(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= MAX_DTO_BYTES) {
      return value;
    }

    return {
      truncated: true,
      size: serialized.length,
      preview: serialized.slice(0, MAX_DTO_BYTES),
    };
  } catch {
    return { truncated: true, preview: String(value).slice(0, 1000) };
  }
}

export function transformMcpToolResult(meta: McpToolMeta, result: unknown): unknown {
  const kind = detectServerKind(meta);

  if (kind === 'webflow') {
    return enforceDtoSize({
      source: 'webflow',
      tool: meta.toolName,
      dto: pickWebflowDto(result),
    });
  }

  if (kind === 'playwright') {
    return enforceDtoSize({
      source: 'playwright',
      tool: meta.toolName,
      dto: pickPlaywrightDto(result),
    });
  }

  return enforceDtoSize(result);
}
