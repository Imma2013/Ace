import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { MCPService } from '~/lib/services/mcpService';

const logger = createScopedLogger('api.mcp-check');

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

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const mcpService = MCPService.getInstance();
    const tenantId = resolveTenantId(request);
    const serverTools = await mcpService.checkServersAvailabilities(tenantId);

    return Response.json(serverTools);
  } catch (error) {
    logger.error('Error checking MCP servers:', error);
    return Response.json({ error: 'Failed to check MCP servers' }, { status: 500 });
  }
}
