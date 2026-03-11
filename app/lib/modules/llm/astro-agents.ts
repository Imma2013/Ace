import type { ModelInfo } from './types';

export type AstroAgentName = 'astro-architect' | 'astro-ui' | 'astro-backend' | 'astro-security' | 'astro-db';

export interface AstroAgentMapping {
  agent: AstroAgentName;
  role: string;
  provider: string;
  model: string;
  fallbackModels: string[];
}

export const ASTRO_AGENT_MODE_ENABLED = true;

export const ASTRO_AGENT_MAPPINGS: AstroAgentMapping[] = [
  {
    agent: 'astro-architect',
    role: 'Planner',
    provider: 'Anthropic',
    model: 'claude-opus-4-6',
    fallbackModels: ['claude-opus-4-20250514'],
  },
  {
    agent: 'astro-ui',
    role: 'Frontend',
    provider: 'Google',
    model: 'gemini-3.1-flash-lite-preview',
    fallbackModels: ['gemini-1.5-flash'],
  },
  {
    agent: 'astro-backend',
    role: 'Backend',
    provider: 'Anthropic',
    model: 'claude-sonnet-4-6',
    fallbackModels: ['claude-sonnet-4-5-20250929'],
  },
  {
    agent: 'astro-security',
    role: 'Security',
    provider: 'Google',
    model: 'gemini-3.1-pro-preview',
    fallbackModels: ['gemini-1.5-pro'],
  },
  {
    agent: 'astro-db',
    role: 'Database',
    provider: 'OpenAI',
    model: 'gpt-5.2-codex',
    fallbackModels: ['claude-sonnet-4-5-20250929'],
  },
];

const getMappingByModel = (modelName: string) =>
  ASTRO_AGENT_MAPPINGS.find((mapping) => [mapping.model, ...mapping.fallbackModels].includes(modelName));

export const getAstroDisplayLabelForModel = (modelName: string) => {
  if (!ASTRO_AGENT_MODE_ENABLED) {
    return undefined;
  }

  const mapping = getMappingByModel(modelName);

  return mapping ? `${mapping.agent} (${mapping.role})` : undefined;
};

export const filterModelsForAstroAgents = (models: ModelInfo[], providerName?: string): ModelInfo[] => {
  if (!ASTRO_AGENT_MODE_ENABLED) {
    return models;
  }

  const allowedModels = new Set(
    ASTRO_AGENT_MAPPINGS.filter((mapping) => !providerName || mapping.provider === providerName).flatMap((mapping) => [
      mapping.model,
      ...mapping.fallbackModels,
    ]),
  );

  return models.filter((model) => allowedModels.has(model.name));
};
