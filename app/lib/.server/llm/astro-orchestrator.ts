import { generateText } from 'ai';
import type { FileMap } from './constants';
import { PROVIDER_LIST } from '~/utils/constants';
import type { IProviderSetting } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';
import type { Messages } from './stream-text';
import {
  ASTRO_21ST_DEV_REFERENCES,
  ASTRO_WEBFLOW_STYLE_PROFILE,
  ASTRO_WEBFLOW_STYLE_REFERENCES,
} from '~/lib/common/prompts/astro-webflow-profile';
import { formatMcpToolPlan, selectMcpToolsForRole, type McpToolMeta } from '~/lib/services/mcp-router';

const logger = createScopedLogger('astro-orchestrator');

type SpecialistTask = 'planner' | 'ui' | 'backend' | 'db' | 'security';
type AstroAgentKey = 'router' | SpecialistTask | 'final';

type AgentConfig = {
  provider: string;
  primaryModel: string;
  fallbackModels: string[];
};

const ASTRO_AGENT_MODELS: Record<AstroAgentKey, AgentConfig> = {
  router: {
    provider: 'Google',
    primaryModel: 'gemini-3.1-flash-lite-preview',
    fallbackModels: ['gemini-1.5-flash'],
  },
  planner: {
    provider: 'Anthropic',
    primaryModel: 'claude-opus-4-6',
    fallbackModels: ['claude-opus-4-20250514'],
  },
  ui: {
    provider: 'Google',
    primaryModel: 'gemini-3.1-flash-lite-preview',
    fallbackModels: ['gemini-1.5-flash'],
  },
  backend: {
    provider: 'Anthropic',
    primaryModel: 'claude-sonnet-4-6',
    fallbackModels: ['claude-sonnet-4-5-20250929'],
  },
  security: {
    provider: 'Google',
    primaryModel: 'gemini-3.1-pro-preview',
    fallbackModels: ['gemini-1.5-pro'],
  },
  db: {
    provider: 'OpenAI',
    primaryModel: 'gpt-5.2-codex',
    fallbackModels: ['claude-sonnet-4-5-20250929'],
  },
  final: {
    provider: 'Google',
    primaryModel: 'gemini-3.1-pro-preview',
    fallbackModels: ['gemini-1.5-pro'],
  },
};

type CallAgentArgs = {
  agent: AstroAgentKey;
  prompt: string;
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, IProviderSetting>;
  env?: Env;
  maxOutputTokens?: number;
};

type RouterPlan = {
  taskOrder: SpecialistTask[];
  constraints: string[];
  contracts: Partial<Record<SpecialistTask, string[]>>;
};

type ModuleStatus = 'pending' | 'running' | 'completed' | 'failed' | 'human_review_required';

type ModuleExecutionState = {
  status: ModuleStatus;
  attempts: number;
  modelUsed?: string;
  error?: string;
};

type AstroExecutionState = {
  version: string;
  request: string;
  taskOrder: SpecialistTask[];
  modules: Record<SpecialistTask, ModuleExecutionState>;
  constraints: string[];
  contracts: Partial<Record<SpecialistTask, string[]>>;
};

const MAX_SPECIALIST_RETRIES = 3;

function toPlainText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return (content as any[])
      .filter((part) => part?.type === 'text')
      .map((part) => part?.text || '')
      .join('\n');
  }

  return '';
}

function getProviderByName(name: string) {
  return PROVIDER_LIST.find((provider) => provider.name === name);
}

function normalizeTaskOrder(input: unknown): SpecialistTask[] {
  const allowed = new Set<SpecialistTask>(['planner', 'ui', 'backend', 'db', 'security']);
  const values = Array.isArray(input) ? input : [];
  const ordered = values.filter((value): value is SpecialistTask => allowed.has(value));

  return ordered.length > 0 ? ordered : ['planner', 'ui', 'backend', 'db', 'security'];
}

function keywordTaskFallback(userRequest: string): SpecialistTask[] {
  const q = userRequest.toLowerCase();
  const tasks: SpecialistTask[] = [];

  if (q.includes('plan') || q.includes('architecture') || q.includes('clone')) {
    tasks.push('planner');
  }
  if (q.includes('ui') || q.includes('design') || q.includes('layout') || q.includes('landing')) {
    tasks.push('ui');
  }
  if (q.includes('api') || q.includes('backend') || q.includes('server') || q.includes('webhook')) {
    tasks.push('backend');
  }
  if (q.includes('db') || q.includes('database') || q.includes('schema') || q.includes('supabase') || q.includes('sql')) {
    tasks.push('db');
  }
  if (q.includes('security') || q.includes('auth') || q.includes('deploy') || q.includes('vercel')) {
    tasks.push('security');
  }

  return tasks.length > 0 ? tasks : ['planner', 'ui', 'backend', 'db', 'security'];
}

function pickRoleContext(role: SpecialistTask, contextFiles?: FileMap): string {
  if (!contextFiles) {
    return 'No scoped project file context available.';
  }

  const roleHints: Record<SpecialistTask, string[]> = {
    planner: ['README', 'PROJECT', 'package.json', 'architecture', 'context'],
    ui: ['app/components', 'app/routes', 'styles', '.scss', '.css', '.tsx'],
    backend: ['app/routes/api', 'services', 'lib/.server', 'lib/modules/llm', '.ts'],
    db: ['supabase', 'migrations', 'schema.sql', 'database', '.sql'],
    security: ['auth', 'security', 'api', 'middleware', 'vercel', '.env'],
  };

  const matched = Object.entries(contextFiles)
    .filter(([, value]) => value?.type === 'file')
    .filter(([path]) => roleHints[role].some((hint) => path.toLowerCase().includes(hint.toLowerCase())))
    .slice(0, 6)
    .map(([path, value]) => {
      const fileValue = value as any;
      const relativePath = path.replace('/home/project/', '');
      const content = `${fileValue?.content || ''}`.slice(0, 2200);
      return `FILE: ${relativePath}\n${content}`;
    });

  if (matched.length > 0) {
    return matched.join('\n\n---\n\n');
  }

  const fallback = Object.entries(contextFiles)
    .filter(([, value]) => value?.type === 'file')
    .slice(0, 3)
    .map(([path, value]) => {
      const fileValue = value as any;
      const relativePath = path.replace('/home/project/', '');
      return `FILE: ${relativePath}\n${`${fileValue?.content || ''}`.slice(0, 1200)}`;
    });

  return fallback.length > 0 ? fallback.join('\n\n---\n\n') : 'No scoped project file context available.';
}

async function callAgentWithFallback(args: CallAgentArgs): Promise<string> {
  const config = ASTRO_AGENT_MODELS[args.agent];
  const provider = getProviderByName(config.provider);

  if (!provider) {
    throw new Error(`Provider ${config.provider} not found for ${args.agent}`);
  }

  const modelCandidates = [config.primaryModel, ...config.fallbackModels];
  let lastError: unknown = undefined;

  for (const modelName of modelCandidates) {
    try {
      const result = await generateText({
        model: provider.getModelInstance({
          model: modelName,
          serverEnv: args.env,
          apiKeys: args.apiKeys,
          providerSettings: args.providerSettings,
        }),
        prompt: args.prompt,
        maxTokens: args.maxOutputTokens ?? 1200,
        temperature: 0.2,
      });

      return result.text?.trim() || '';
    } catch (error) {
      lastError = error;
      logger.warn(`${args.agent} failed with model ${modelName}: ${error}`);
    }
  }

  throw new Error(`${args.agent} failed with all candidates: ${String(lastError)}`);
}

async function callSpecialistWithCircuitBreaker(args: {
  task: SpecialistTask;
  prompt: string;
  state: AstroExecutionState;
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, IProviderSetting>;
  env?: Env;
  maxOutputTokens?: number;
}): Promise<string> {
  const moduleState = args.state.modules[args.task];
  moduleState.status = 'running';

  let lastError: unknown = undefined;
  const config = ASTRO_AGENT_MODELS[args.task];
  const provider = getProviderByName(config.provider);

  if (!provider) {
    moduleState.status = 'human_review_required';
    moduleState.error = `Missing provider ${config.provider}`;
    return `[HUMAN_REVIEW_REQUIRED] ${args.task}: provider ${config.provider} not available`;
  }

  for (let attempt = 1; attempt <= MAX_SPECIALIST_RETRIES; attempt++) {
    moduleState.attempts = attempt;

    for (const modelName of [config.primaryModel, ...config.fallbackModels]) {
      try {
        const result = await generateText({
          model: provider.getModelInstance({
            model: modelName,
            serverEnv: args.env,
            apiKeys: args.apiKeys,
            providerSettings: args.providerSettings,
          }),
          prompt: args.prompt,
          maxTokens: args.maxOutputTokens ?? 1100,
          temperature: 0.2,
        });

        moduleState.status = 'completed';
        moduleState.modelUsed = modelName;
        moduleState.error = undefined;
        return result.text?.trim() || '';
      } catch (error) {
        lastError = error;
        logger.warn(`${args.task} attempt ${attempt} failed with ${modelName}: ${error}`);
      }
    }
  }

  moduleState.status = 'human_review_required';
  moduleState.error = String(lastError);
  return `[HUMAN_REVIEW_REQUIRED] ${args.task}: exceeded ${MAX_SPECIALIST_RETRIES} retries. Last error: ${String(lastError)}`;
}

function parseRouterPlan(raw: string, userRequest: string): RouterPlan {
  const fallbackOrder = keywordTaskFallback(userRequest);
  const fallback: RouterPlan = {
    taskOrder: fallbackOrder,
    constraints: ['Keep specialist execution isolated and scoped.'],
    contracts: {},
  };

  try {
    const parsed = JSON.parse(raw) as Partial<RouterPlan>;
    return {
      taskOrder: normalizeTaskOrder(parsed.taskOrder || fallback.taskOrder),
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints.slice(0, 12) : fallback.constraints,
      contracts: parsed.contracts && typeof parsed.contracts === 'object' ? parsed.contracts : {},
    };
  } catch {
    return fallback;
  }
}

function getRoleChecklist(task: SpecialistTask): string {
  if (task === 'planner') {
    return [
      '- Produce architecture phases and milestone order.',
      '- Include deployment checkpoints and rollback notes.',
      '- Include web verification checklist for backend/db/auth/security docs.',
      '- Ensure generated code updates both context.md and agents.md at project root.',
    ].join('\n');
  }

  if (task === 'ui') {
    return [
      '- Enforce anti-AI-slop layout grammar and typographic scale.',
      '- Specify motion tokens and reduced-motion behavior.',
      '- Keep Webflow-inspired polish without cloning exact visual identity.',
      '- Pull design inspiration from Webflow and 21st.dev/Magic when available.',
      '- Never emulate Base44/Replit default visual patterns.',
    ].join('\n');
  }

  if (task === 'backend') {
    return [
      '- Define API/server action contracts and auth/session flow.',
      '- Define integration boundaries and failure handling.',
      '- Require official-doc verification before implementation.',
    ].join('\n');
  }

  if (task === 'db') {
    return [
      '- Define normalized schema, migrations, indexes, and RLS matrix.',
      '- Define query contracts expected by backend/frontend.',
      '- Require official Supabase docs verification before implementation.',
    ].join('\n');
  }

  return [
    '- Define threat checks, security controls, and secret handling.',
    '- Enforce LCP/INP/CLS and accessibility guardrails.',
    '- Require official-source verification for security/deploy assertions.',
  ].join('\n');
}

export async function buildAstroOrchestrationContext(args: {
  messages: Messages;
  contextFiles?: FileMap;
  mcpTools?: McpToolMeta[];
  publicDesignMode?: boolean;
  maxToolsPerRole?: number;
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, IProviderSetting>;
  env?: Env;
}): Promise<{ context?: string; allowedToolNames: string[] }> {
  const userMessages = args.messages.filter((message) => message.role === 'user');
  const lastUserMessage = userMessages[userMessages.length - 1];

  if (!lastUserMessage) {
    return { context: undefined, allowedToolNames: [] };
  }

  const userRequest = toPlainText(lastUserMessage.content).trim();

  if (!userRequest) {
    return { context: undefined, allowedToolNames: [] };
  }

  const routerPrompt = `
You are astro-router.
Route the request into a strict hub-and-spoke plan.
Golden rule: no specialist can communicate with another specialist directly.

Request:
${userRequest}

Output ONLY valid JSON:
{
  "taskOrder": ["planner","ui","backend","db","security"],
  "constraints": ["..."],
  "contracts": {
    "planner": ["..."],
    "ui": ["..."],
    "backend": ["..."],
    "db": ["..."],
    "security": ["..."]
  }
}
`;

  const routerRaw = await callAgentWithFallback({
    agent: 'router',
    prompt: routerPrompt,
    apiKeys: args.apiKeys,
    providerSettings: args.providerSettings,
    env: args.env,
    maxOutputTokens: 700,
  });

  const routerPlan = parseRouterPlan(routerRaw, userRequest);
  const specialistOutputs: Partial<Record<SpecialistTask, string>> = {};
  const allowedToolNames = new Set<string>();
  const executionState: AstroExecutionState = {
    version: '1.0',
    request: userRequest,
    taskOrder: routerPlan.taskOrder,
    constraints: routerPlan.constraints,
    contracts: routerPlan.contracts,
    modules: {
      planner: { status: 'pending', attempts: 0 },
      ui: { status: 'pending', attempts: 0 },
      backend: { status: 'pending', attempts: 0 },
      db: { status: 'pending', attempts: 0 },
      security: { status: 'pending', attempts: 0 },
    },
  };

  for (const task of routerPlan.taskOrder) {
    const scopedContext = pickRoleContext(task, args.contextFiles);
    const taskContracts = Array.isArray(routerPlan.contracts[task]) ? routerPlan.contracts[task]!.slice(0, 8) : [];
    const selectedMcpTools = selectMcpToolsForRole({
      role: task,
      userRequest,
      tools: args.mcpTools || [],
      maxTools: Math.max(1, Math.min(12, args.maxToolsPerRole || (task === 'planner' ? 4 : 6))),
      publicDesignMode: args.publicDesignMode,
    });
    selectedMcpTools.forEach((tool) => allowedToolNames.add(tool.toolName));
    const mcpToolPlan = formatMcpToolPlan(task, selectedMcpTools);

    const prompt = `
You are astro-${task}.
Rules:
- No direct communication with other specialist models.
- Use only this request, router directives, and scoped context.
- Return concise implementation guidance only for your role.

Request:
${userRequest}

Global constraints:
${routerPlan.constraints.join('\n') || '- Keep outputs production-grade and coherent.'}

Task contracts:
${taskContracts.join('\n') || '- No additional task contracts provided.'}

Scoped context:
${scopedContext}

MCP tool plan:
${mcpToolPlan}

Role checklist:
${getRoleChecklist(task)}
`;

    specialistOutputs[task] = await callSpecialistWithCircuitBreaker({
      task,
      prompt,
      state: executionState,
      apiKeys: args.apiKeys,
      providerSettings: args.providerSettings,
      env: args.env,
      maxOutputTokens: task === 'planner' ? 1800 : 1100,
    });
  }

  const finalAuthorityPrompt = `
You are astro-final (Google Gemini final authority).
Integrate and validate specialist outputs.
Flag inconsistencies. Do not fabricate missing specialist results.

Request:
${userRequest}

Style profile:
${ASTRO_WEBFLOW_STYLE_PROFILE}

Reference sites:
${ASTRO_WEBFLOW_STYLE_REFERENCES.map((ref) => `- ${ref.name}: ${ref.liveSite} | ${ref.madeInWebflow}`).join('\n')}
${ASTRO_21ST_DEV_REFERENCES.map((ref) => `- ${ref.name}: ${ref.liveSite}`).join('\n')}

Router constraints:
${routerPlan.constraints.join('\n') || '- None'}

Execution state JSON:
${JSON.stringify(executionState, null, 2)}

Specialist outputs:
Planner:
${specialistOutputs.planner || 'N/A'}

UI:
${specialistOutputs.ui || 'N/A'}

Backend:
${specialistOutputs.backend || 'N/A'}

Database:
${specialistOutputs.db || 'N/A'}

Security:
${specialistOutputs.security || 'N/A'}

Return sections:
1) Unified execution plan
2) Contract consistency matrix (UI/API/DB/Auth)
3) Risk/conflict list
4) Final implementation directives
`;

  const finalAuthority = await callAgentWithFallback({
    agent: 'final',
    prompt: finalAuthorityPrompt,
    apiKeys: args.apiKeys,
    providerSettings: args.providerSettings,
    env: args.env,
    maxOutputTokens: 2200,
  });

  return {
    context: `
[ASTRO_ORCHESTRATION_CONTEXT]
Routing:
${routerRaw}

Execution State:
${JSON.stringify(executionState, null, 2)}

Planner:
${specialistOutputs.planner || 'N/A'}

UI:
${specialistOutputs.ui || 'N/A'}

Backend:
${specialistOutputs.backend || 'N/A'}

Database:
${specialistOutputs.db || 'N/A'}

Security:
${specialistOutputs.security || 'N/A'}

Final Authority (Gemini):
${finalAuthority}
[/ASTRO_ORCHESTRATION_CONTEXT]
`.trim(),
    allowedToolNames: Array.from(allowedToolNames),
  };
}
