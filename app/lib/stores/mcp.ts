import { create } from 'zustand';
import type { MCPConfig, MCPServerTools } from '~/lib/services/mcpService';

const MCP_SETTINGS_KEY = 'mcp_settings';
const isBrowser = typeof window !== 'undefined';

type MCPSettings = {
  mcpConfig: MCPConfig;
  maxLLMSteps: number;
  publicDesignMode: boolean;
  alwaysOnBackgroundWebResearch: boolean;
  maxToolsPerRole: number;
  maxMcpCallsPerTurn: number;
};

const defaultSettings = {
  maxLLMSteps: 5,
  publicDesignMode: true,
  alwaysOnBackgroundWebResearch: true,
  maxToolsPerRole: 6,
  maxMcpCallsPerTurn: 12,
  mcpConfig: {
    mcpServers: {
      webflow: {
        type: 'streamable-http',
        url: 'https://mcp.webflow.com/mcp',
      },
      playwright: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest', '--headless'],
      },
    },
  },
} satisfies MCPSettings;

function ensureDefaultMcpServers(settings: MCPSettings): MCPSettings {
  const currentServers = settings.mcpConfig?.mcpServers || {};
  const mergedServers = {
    ...defaultSettings.mcpConfig.mcpServers,
    ...currentServers,
  };

  return {
    ...settings,
    publicDesignMode: settings.publicDesignMode ?? defaultSettings.publicDesignMode,
    alwaysOnBackgroundWebResearch:
      settings.alwaysOnBackgroundWebResearch ?? defaultSettings.alwaysOnBackgroundWebResearch,
    maxToolsPerRole: settings.maxToolsPerRole ?? defaultSettings.maxToolsPerRole,
    maxMcpCallsPerTurn: settings.maxMcpCallsPerTurn ?? defaultSettings.maxMcpCallsPerTurn,
    mcpConfig: {
      mcpServers: mergedServers,
    },
  };
}

type Store = {
  isInitialized: boolean;
  settings: MCPSettings;
  serverTools: MCPServerTools;
  error: string | null;
  isUpdatingConfig: boolean;
};

type Actions = {
  initialize: () => Promise<void>;
  updateSettings: (settings: MCPSettings) => Promise<void>;
  checkServersAvailabilities: () => Promise<void>;
};

export const useMCPStore = create<Store & Actions>((set, get) => ({
  isInitialized: false,
  settings: defaultSettings,
  serverTools: {},
  error: null,
  isUpdatingConfig: false,
  initialize: async () => {
    if (get().isInitialized) {
      return;
    }

    if (isBrowser) {
      const savedConfig = localStorage.getItem(MCP_SETTINGS_KEY);

      if (savedConfig) {
        try {
          const rawSettings = JSON.parse(savedConfig) as MCPSettings;
          const settings = ensureDefaultMcpServers(rawSettings);
          const serverTools = await updateServerConfig(settings.mcpConfig);

          if (isBrowser) {
            localStorage.setItem(MCP_SETTINGS_KEY, JSON.stringify(settings));
          }

          set(() => ({ settings, serverTools }));
        } catch (error) {
          console.error('Error parsing saved mcp config:', error);
          set(() => ({
            error: `Error parsing saved mcp config: ${error instanceof Error ? error.message : String(error)}`,
          }));
        }
      } else {
        localStorage.setItem(MCP_SETTINGS_KEY, JSON.stringify(ensureDefaultMcpServers(defaultSettings)));
      }
    }

    set(() => ({ isInitialized: true }));
  },
  updateSettings: async (newSettings: MCPSettings) => {
    if (get().isUpdatingConfig) {
      return;
    }

    try {
      set(() => ({ isUpdatingConfig: true }));

      const serverTools = await updateServerConfig(newSettings.mcpConfig);

      if (isBrowser) {
        localStorage.setItem(MCP_SETTINGS_KEY, JSON.stringify(newSettings));
      }

      set(() => ({ settings: newSettings, serverTools }));
    } catch (error) {
      throw error;
    } finally {
      set(() => ({ isUpdatingConfig: false }));
    }
  },
  checkServersAvailabilities: async () => {
    const response = await fetch('/api/mcp-check', {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
    }

    const serverTools = (await response.json()) as MCPServerTools;

    set(() => ({ serverTools }));
  },
}));

async function updateServerConfig(config: MCPConfig) {
  const response = await fetch('/api/mcp-update-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as MCPServerTools;

  return data;
}
