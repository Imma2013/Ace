import { type ActionFunctionArgs } from '@remix-run/node';
import { createDataStream, generateId } from 'ai';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS, type FileMap } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import type { IProviderSetting } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';
import { getFilePaths, selectContext } from '~/lib/.server/llm/select-context';
import type { ContextAnnotation, ProgressAnnotation } from '~/types/context';
import { WORK_DIR } from '~/utils/constants';
import { createSummary } from '~/lib/.server/llm/create-summary';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import type { DesignScheme } from '~/types/design-scheme';
import { MCPService } from '~/lib/services/mcpService';
import { StreamRecoveryManager } from '~/lib/.server/llm/stream-recovery';
import { buildAstroOrchestrationContext } from '~/lib/.server/llm/astro-orchestrator';

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

const logger = createScopedLogger('api.chat');

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest) {
      const decodedName = decodeURIComponent(name.trim());
      const decodedValue = decodeURIComponent(rest.join('=').trim());
      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

function getLastUserMessageText(messages: any[]): string {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');

  if (!lastUser) {
    return '';
  }

  const content: any = lastUser.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part?.type === 'text')
      .map((part: any) => part?.text || '')
      .join('\n');
  }

  return '';
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : null;
}

const DESIGN_REFERENCE_URLS = ['https://webflow.com/made-in-webflow', 'https://21st.dev/magic'];
const CODE_SUPPORT_DOC_URLS = {
  core: ['https://nextjs.org/docs', 'https://supabase.com/docs'],
  stripe: 'https://docs.stripe.com',
  vercel: 'https://vercel.com/docs',
};
const ALLOWED_RESEARCH_HOSTS = ['webflow.com', '21st.dev', 'nextjs.org', 'supabase.com', 'docs.stripe.com', 'vercel.com'];

function getCodeSupportDocUrls(text: string): string[] {
  const urls = [...CODE_SUPPORT_DOC_URLS.core];
  const q = text.toLowerCase();

  if (/(stripe|payment|checkout|webhook|billing)/i.test(q)) {
    urls.push(CODE_SUPPORT_DOC_URLS.stripe);
  }

  if (/(vercel|deploy|deployment|hosting|edge)/i.test(q)) {
    urls.push(CODE_SUPPORT_DOC_URLS.vercel);
  }

  return urls;
}

function isAllowedResearchUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOWED_RESEARCH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function buildPlaywrightNavigateArgs(url: string): Record<string, unknown> {
  return { url };
}

async function runBackgroundWebResearch(args: {
  mcpService: MCPService;
  messages: any[];
  maxCalls: number;
}): Promise<string | undefined> {
  const { mcpService, messages, maxCalls } = args;
  const callBudget = Math.max(1, Math.min(8, maxCalls));
  let callsUsed = 0;
  const catalog = mcpService.getToolCatalog();
  const playwrightTools = catalog.filter((tool) => (tool.serverName || '').toLowerCase().includes('playwright'));

  if (playwrightTools.length === 0) {
    return undefined;
  }

  const text = getLastUserMessageText(messages);
  const url = extractFirstUrl(text);
  const shouldIncludeDesignRefs = true;
  const allowedUserUrl = url && isAllowedResearchUrl(url) ? url : null;
  const targetUrls = Array.from(
    new Set([
      ...(shouldIncludeDesignRefs ? DESIGN_REFERENCE_URLS : []),
      ...getCodeSupportDocUrls(text),
      ...(allowedUserUrl ? [allowedUserUrl] : []),
    ]),
  );
  const navigateTool = playwrightTools.find((tool) => /(goto|navigate|open)/i.test(tool.toolName));
  const snapshotTool = playwrightTools.find((tool) =>
    /(snapshot|extract|markdown|text|content|eval|get_page_content|get_text|read)/i.test(tool.toolName),
  );
  const results: string[] = [];

  try {
    if (navigateTool && targetUrls.length > 0) {
      for (const targetUrl of targetUrls) {
        if (callsUsed >= callBudget) {
          break;
        }
        const navigateResult = await mcpService.executeTool(
          navigateTool.toolName,
          buildPlaywrightNavigateArgs(targetUrl),
          messages,
        );
        callsUsed += 1;
        results.push(`Navigate(${targetUrl}) via ${navigateTool.toolName}: ${JSON.stringify(navigateResult).slice(0, 2200)}`);
      }
    }

    if (snapshotTool && callsUsed < callBudget) {
      const snapshotResult = await mcpService.executeTool(snapshotTool.toolName, {}, messages);
      callsUsed += 1;
      results.push(`Snapshot(${snapshotTool.toolName}): ${JSON.stringify(snapshotResult).slice(0, 3600)}`);
    }
  } catch (error) {
    results.push(`Background research warning: ${String(error)}`);
  }

  if (results.length === 0) {
    return undefined;
  }

  return `[AUTO_WEB_RESEARCH]\n${results.join('\n\n')}\n[/AUTO_WEB_RESEARCH]`;
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const streamRecovery = new StreamRecoveryManager({
    timeout: 45000,
    maxRetries: 2,
    onTimeout: () => {
      logger.warn('Stream timeout - attempting recovery');
    },
  });

  const {
    messages,
    files,
    promptId,
    contextOptimization,
    supabase,
    chatMode,
    designScheme,
    maxLLMSteps,
    publicDesignMode,
    alwaysOnBackgroundWebResearch,
    maxToolsPerRole,
    maxMcpCallsPerTurn,
  } =
    await request.json<{
      messages: Messages;
      files: any;
      promptId?: string;
      contextOptimization: boolean;
      chatMode: 'discuss' | 'build';
      designScheme?: DesignScheme;
      publicDesignMode?: boolean;
      alwaysOnBackgroundWebResearch?: boolean;
      maxToolsPerRole?: number;
      maxMcpCallsPerTurn?: number;
      supabase?: {
        isConnected: boolean;
        hasSelectedProject: boolean;
        credentials?: {
          anonKey?: string;
          supabaseUrl?: string;
        };
      };
      maxLLMSteps: number;
    }>();

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = JSON.parse(parseCookies(cookieHeader || '').apiKeys || '{}');
  const providerSettings: Record<string, IProviderSetting> = JSON.parse(
    parseCookies(cookieHeader || '').providers || '{}',
  );

  const stream = new SwitchableStream();

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
  };
  const encoder: TextEncoder = new TextEncoder();
  let progressCounter: number = 1;

  try {
    const mcpService = MCPService.getInstance();
    const totalMessageContent = messages.reduce((acc, message) => acc + message.content, '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length}, words`);

    let lastChunk: string | undefined = undefined;

    const dataStream = createDataStream({
      async execute(dataStream) {
        streamRecovery.startMonitoring();

        const filePaths = getFilePaths(files || {});
        let filteredFiles: FileMap | undefined = undefined;
        let summary: string | undefined = undefined;
        let messageSliceId = 0;
        let scopedTools = mcpService.toolsWithoutExecute;

        const toolBudget = {
          maxCallsPerTurn: Math.max(1, Math.min(40, maxMcpCallsPerTurn || 12)),
          callsUsed: 0,
        };

        let processedMessages = await mcpService.processToolInvocations(messages, dataStream, toolBudget);

        if (processedMessages.length > 3) {
          messageSliceId = processedMessages.length - 3;
        }

        if (filePaths.length > 0 && contextOptimization) {
          logger.debug('Generating Chat Summary');
          dataStream.writeData({
            type: 'progress',
            label: 'summary',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Analysing Request',
          } satisfies ProgressAnnotation);

          // Create a summary of the chat
          console.log(`Messages count: ${processedMessages.length}`);

          summary = await createSummary({
            messages: [...processedMessages],
            env: context.cloudflare?.env,
            apiKeys,
            providerSettings,
            promptId,
            contextOptimization,
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('createSummary token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          });
          dataStream.writeData({
            type: 'progress',
            label: 'summary',
            status: 'complete',
            order: progressCounter++,
            message: 'Analysis Complete',
          } satisfies ProgressAnnotation);

          dataStream.writeMessageAnnotation({
            type: 'chatSummary',
            summary,
            chatId: processedMessages.slice(-1)?.[0]?.id,
          } as ContextAnnotation);

          // Update context buffer
          logger.debug('Updating Context Buffer');
          dataStream.writeData({
            type: 'progress',
            label: 'context',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Determining Files to Read',
          } satisfies ProgressAnnotation);

          // Select context files
          console.log(`Messages count: ${processedMessages.length}`);
          filteredFiles = await selectContext({
            messages: [...processedMessages],
            env: context.cloudflare?.env,
            apiKeys,
            files,
            providerSettings,
            promptId,
            contextOptimization,
            summary,
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('selectContext token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          });

          if (filteredFiles) {
            logger.debug(`files in context : ${JSON.stringify(Object.keys(filteredFiles))}`);
          }

          dataStream.writeMessageAnnotation({
            type: 'codeContext',
            files: Object.keys(filteredFiles).map((key) => {
              let path = key;

              if (path.startsWith(WORK_DIR)) {
                path = path.replace(WORK_DIR, '');
              }

              return path;
            }),
          } as ContextAnnotation);

          dataStream.writeData({
            type: 'progress',
            label: 'context',
            status: 'complete',
            order: progressCounter++,
            message: 'Code Files Selected',
          } satisfies ProgressAnnotation);

          // logger.debug('Code Files Selected');
        }

        const shouldRunBackgroundResearch = alwaysOnBackgroundWebResearch !== false;
        if (shouldRunBackgroundResearch) {
          const researchContext = await runBackgroundWebResearch({
            mcpService,
            messages: processedMessages,
            maxCalls: Math.max(1, Math.min(6, toolBudget.maxCallsPerTurn - toolBudget.callsUsed)),
          });

          if (researchContext) {
            processedMessages = [
              ...processedMessages,
              {
                id: generateId(),
                role: 'assistant',
                content: researchContext,
              },
            ];
          }
        }

        if (chatMode === 'build') {
          try {
            dataStream.writeData({
              type: 'progress',
              label: 'planner',
              status: 'in-progress',
              order: progressCounter++,
              message: 'Running Astro Router + Specialists',
            } satisfies ProgressAnnotation);

            const orchestration = await buildAstroOrchestrationContext({
              messages: processedMessages,
              contextFiles: filteredFiles,
              mcpTools: mcpService.getToolCatalog(),
              publicDesignMode,
              maxToolsPerRole,
              apiKeys,
              providerSettings,
              env: context.cloudflare?.env,
            });

            const orchestrationContext = orchestration.context;

            if (orchestration.allowedToolNames.length > 0) {
              scopedTools = mcpService.getToolsWithoutExecuteByNames(orchestration.allowedToolNames);
            }

            if (orchestrationContext) {
              processedMessages = [
                ...processedMessages,
                {
                  id: generateId(),
                  role: 'assistant',
                  content: orchestrationContext,
                },
              ];
            }

            dataStream.writeData({
              type: 'progress',
              label: 'planner',
              status: 'complete',
              order: progressCounter++,
              message: 'Orchestration Context Ready',
            } satisfies ProgressAnnotation);
          } catch (error) {
            logger.warn(`Astro orchestration failed; continuing without orchestration context: ${error}`);
          }
        }

        const options: StreamingOptions = {
          supabaseConnection: supabase,
          toolChoice: 'auto',
          tools: scopedTools,
          maxSteps: maxLLMSteps,
          onStepFinish: ({ toolCalls }) => {
            // add tool call annotations for frontend processing
            toolCalls.forEach((toolCall) => {
              mcpService.processToolCall(toolCall, dataStream);
            });
          },
          onFinish: async ({ text: content, finishReason, usage }) => {
            logger.debug('usage', JSON.stringify(usage));

            if (usage) {
              cumulativeUsage.completionTokens += usage.completionTokens || 0;
              cumulativeUsage.promptTokens += usage.promptTokens || 0;
              cumulativeUsage.totalTokens += usage.totalTokens || 0;
            }

            if (finishReason !== 'length') {
              dataStream.writeMessageAnnotation({
                type: 'usage',
                value: {
                  completionTokens: cumulativeUsage.completionTokens,
                  promptTokens: cumulativeUsage.promptTokens,
                  totalTokens: cumulativeUsage.totalTokens,
                },
              });
              dataStream.writeData({
                type: 'progress',
                label: 'response',
                status: 'complete',
                order: progressCounter++,
                message: 'Response Generated',
              } satisfies ProgressAnnotation);
              await new Promise((resolve) => setTimeout(resolve, 0));

              // stream.close();
              return;
            }

            if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
              throw Error('Cannot continue message: Maximum segments reached');
            }

            const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

            logger.info(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

            const lastUserMessage = processedMessages.filter((x) => x.role == 'user').slice(-1)[0];
            const { model, provider } = extractPropertiesFromMessage(lastUserMessage);
            processedMessages.push({ id: generateId(), role: 'assistant', content });
            processedMessages.push({
              id: generateId(),
              role: 'user',
              content: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${CONTINUE_PROMPT}`,
            });

            const result = await streamText({
              messages: [...processedMessages],
              env: context.cloudflare?.env,
              options,
              apiKeys,
              files,
              providerSettings,
              promptId,
              contextOptimization,
              contextFiles: filteredFiles,
              chatMode,
              designScheme,
              summary,
              messageSliceId,
            });

            result.mergeIntoDataStream(dataStream);

            (async () => {
              for await (const part of result.fullStream) {
                if (part.type === 'error') {
                  const error: any = part.error;
                  logger.error(`${error}`);

                  return;
                }
              }
            })();

            return;
          },
        };

        dataStream.writeData({
          type: 'progress',
          label: 'response',
          status: 'in-progress',
          order: progressCounter++,
          message: 'Generating Response',
        } satisfies ProgressAnnotation);

        const result = await streamText({
          messages: [...processedMessages],
          env: context.cloudflare?.env,
          options,
          apiKeys,
          files,
          providerSettings,
          promptId,
          contextOptimization,
          contextFiles: filteredFiles,
          chatMode,
          designScheme,
          summary,
          messageSliceId,
        });

        (async () => {
          for await (const part of result.fullStream) {
            streamRecovery.updateActivity();

            if (part.type === 'error') {
              const error: any = part.error;
              logger.error('Streaming error:', error);
              streamRecovery.stop();

              // Enhanced error handling for common streaming issues
              if (error.message?.includes('Invalid JSON response')) {
                logger.error('Invalid JSON response detected - likely malformed API response');
              } else if (error.message?.includes('token')) {
                logger.error('Token-related error detected - possible token limit exceeded');
              }

              return;
            }
          }
          streamRecovery.stop();
        })();
        result.mergeIntoDataStream(dataStream);
      },
      onError: (error: any) => {
        // Provide more specific error messages for common issues
        const errorMessage = error.message || 'Unknown error';

        if (errorMessage.includes('model') && errorMessage.includes('not found')) {
          return 'Custom error: Invalid model selected. Please check that the model name is correct and available.';
        }

        if (errorMessage.includes('Invalid JSON response')) {
          return 'Custom error: The AI service returned an invalid response. This may be due to an invalid model name, API rate limiting, or server issues. Try selecting a different model or check your API key.';
        }

        if (
          errorMessage.includes('API key') ||
          errorMessage.includes('unauthorized') ||
          errorMessage.includes('authentication')
        ) {
          return 'Custom error: Invalid or missing API key. Please check your API key configuration.';
        }

        if (errorMessage.includes('token') && errorMessage.includes('limit')) {
          return 'Custom error: Token limit exceeded. The conversation is too long for the selected model. Try using a model with larger context window or start a new conversation.';
        }

        if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
          return 'Custom error: API rate limit exceeded. Please wait a moment before trying again.';
        }

        if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
          return 'Custom error: Network error. Please check your internet connection and try again.';
        }

        return `Custom error: ${errorMessage}`;
      },
    }).pipeThrough(
      new TransformStream({
        transform: (chunk, controller) => {
          if (!lastChunk) {
            lastChunk = ' ';
          }

          if (typeof chunk === 'string') {
            if (chunk.startsWith('g') && !lastChunk.startsWith('g')) {
              controller.enqueue(encoder.encode(`0: "<div class=\\"__boltThought__\\">"\n`));
            }

            if (lastChunk.startsWith('g') && !chunk.startsWith('g')) {
              controller.enqueue(encoder.encode(`0: "</div>\\n"\n`));
            }
          }

          lastChunk = chunk;

          let transformedChunk = chunk;

          if (typeof chunk === 'string' && chunk.startsWith('g')) {
            let content = chunk.split(':').slice(1).join(':');

            if (content.endsWith('\n')) {
              content = content.slice(0, content.length - 1);
            }

            transformedChunk = `0:${content}\n`;
          }

          // Convert the string stream to a byte stream
          const str = typeof transformedChunk === 'string' ? transformedChunk : JSON.stringify(transformedChunk);
          controller.enqueue(encoder.encode(str));
        },
      }),
    );

    return new Response(dataStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
        'Text-Encoding': 'chunked',
      },
    });
  } catch (error: any) {
    logger.error(error);

    const errorResponse = {
      error: true,
      message: error.message || 'An unexpected error occurred',
      statusCode: error.statusCode || 500,
      isRetryable: error.isRetryable !== false, // Default to retryable unless explicitly false
      provider: error.provider || 'unknown',
    };

    if (error.message?.includes('API key')) {
      return new Response(
        JSON.stringify({
          ...errorResponse,
          message: 'Invalid or missing API key',
          statusCode: 401,
          isRetryable: false,
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          statusText: 'Unauthorized',
        },
      );
    }

    return new Response(JSON.stringify(errorResponse), {
      status: errorResponse.statusCode,
      headers: { 'Content-Type': 'application/json' },
      statusText: 'Error',
    });
  }
}
