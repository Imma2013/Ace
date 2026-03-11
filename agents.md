# ACE Agents

## Active Roles
- T1 `codex`: orchestration, MCP routing, prompt and integration logic.
- T2 `ui`: layout quality constraints, model selector and MCP settings UX.
- T3 `auditor`: reliability checks, dependency/build validation, deployment risk review.
- T4 `runner`: local runtime checks (typecheck/build/playwright smoke).

## Routing / Model Mapping
- planner -> `astro-architect`
- ui -> `astro-ui`
- backend -> `astro-backend`
- security -> `astro-security`
- db -> `astro-db`

## Hand-off Notes
- Router scopes tools by role and request; only selected MCP tool names are passed to the active LLM turn.
- Playwright MCP research path is constrained to approved domains for frontend inspiration/docs.
- Electron removed in ACE; cloud/web deployment path remains primary.
