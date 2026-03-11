# ACE Context

## Date
- 2026-03-11

## Workspace
- Root: `C:\Users\Admin\Downloads\Apollo\ace_fresh`
- Base: fork target from `https://github.com/stackblitz-labs/bolt.diy`

## Task Summary
- Migrated Apollo custom MCP/LLM routing into ACE.
- Enforced scoped MCP tool exposure per role and turn.
- Added always-on Playwright-based web research path constrained to Webflow + 21st.dev (+ official docs).
- Removed Electron runtime/build path from ACE.

## Changed Files
- `app/lib/.server/llm/astro-orchestrator.ts`
- `app/lib/services/mcp-router.ts`
- `app/lib/services/mcpService.ts`
- `app/routes/api.chat.ts`
- `app/lib/common/prompts/astro-webflow-profile.ts`
- `app/lib/common/prompts/prompts.ts`
- `app/lib/common/prompts/optimized.ts`
- `app/lib/common/prompts/new-prompt.ts`
- `app/lib/modules/llm/astro-agents.ts`
- `app/components/chat/ModelSelector.tsx`
- `app/components/@settings/tabs/mcp/McpTab.tsx`
- `app/lib/stores/mcp.ts`
- `app/utils/markdown.ts`
- `functions/[[path]].ts`
- `vite.config.ts`
- `app/lib/shims/util-types.ts`
- `app/lib/shims/undici.ts`
- `scripts/playwright-mcp-smoke.mjs`
- `app/components/@settings/tabs/providers/cloud/CloudProvidersTab.tsx`
- `tsconfig.json`
- `package.json`
- removed `electron/**` and `scripts/electron-dev.mjs`

## Validation
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run smoke:playwright-mcp` passed and captured Webflow/21st/Next.js/Supabase pages.

## Next Steps
- Set `origin` to `https://github.com/Imma2013/Ace.git`.
- Commit and push `main`.
- Optionally prune all non-main remote branches.
