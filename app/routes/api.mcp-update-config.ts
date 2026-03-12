import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { MCPService, type MCPConfig } from '~/lib/services/mcpService';

const logger = createScopedLogger('api.mcp-update-config');

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  for (const item of cookieHeader.split(';')) {
    const [name, ...rest] = item.trim().split('=');

    if (name && rest.length > 0) {
      cookies[decodeURIComponent(name)] = decodeURIComponent(rest.join('='));
    }
  }

  return cookies;
}

function resolveTenantId(request: Request): string {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  return String(request.headers.get('x-tenant-id') || cookies.tenantId || cookies.userId || cookies.sessionId || 'public');
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const mcpConfig = (await request.json()) as MCPConfig;

    if (!mcpConfig || typeof mcpConfig !== 'object') {
      return Response.json({ error: 'Invalid MCP servers configuration' }, { status: 400 });
    }

    const mcpService = MCPService.getInstance();
    const tenantId = resolveTenantId(request);
    const serverTools = await mcpService.updateConfig(mcpConfig, tenantId);

    return Response.json(serverTools);
  } catch (error) {
    logger.error('Error updating MCP config:', error);
    return Response.json({ error: 'Failed to update MCP config' }, { status: 500 });
  }
}
