export const ASTRO_WEBFLOW_STYLE_REFERENCES = [
  {
    name: 'AllianceNav',
    madeInWebflow: 'https://webflow.com/made-in-webflow/website/alliancenav',
    liveSite: 'https://alliancenav.webflow.io/',
  },
  {
    name: 'Pause',
    madeInWebflow: 'https://webflow.com/made-in-webflow/website/pause-48e09e',
    liveSite: 'https://www.hitpause.co.nz/',
  },
  {
    name: 'Flowfest',
    madeInWebflow: 'https://webflow.com/made-in-webflow/website/flowfest-2025-c5e8db',
    liveSite: 'https://www.flowfest.co.uk/',
  },
  {
    name: 'Finera',
    madeInWebflow: 'https://webflow.com/made-in-webflow/website/finera-dev',
    liveSite: 'https://www.finera.com/',
  },
];

export const ASTRO_21ST_DEV_REFERENCES = [
  {
    name: '21st.dev',
    liveSite: 'https://21st.dev/',
  },
  {
    name: '21st.dev Magic',
    liveSite: 'https://21st.dev/magic',
  },
];

export const ASTRO_WEBFLOW_STYLE_PROFILE = `
Webflow-inspired style profile (high-polish, non-generic):

1. Layout grammar
- Hero-first storytelling with one dominant focal element.
- Asymmetric sections with deliberate whitespace and visual anchors.
- Modular banding: alternate dense and calm sections for rhythm.

2. Typography system
- Strong display/headline contrast with concise body copy.
- Tight headline tracking, larger optical sizes, clear hierarchy.
- Type scale should be explicit and reusable across sections.

3. Color and surfaces
- Controlled palette with one accent family and disciplined neutrals.
- High-contrast CTA treatment and purposeful color blocking.
- Surfaces should feel designed, not default framework blocks.

4. Motion and interactions
- Motion should guide attention, never distract.
- Use staged reveals, staggered entrances, and subtle parallax depth.
- Prefer transform/opacity animations and keep durations/easings consistent.
- Respect reduced-motion preferences and keep content complete when motion is disabled.

5. Component behavior
- Navigation should feel intentional (sticky, compact, clear active states).
- Cards and panels should use meaningful hover/focus transitions.
- Buttons need tactile feedback and clear visual affordances.

6. Performance and accessibility
- Budgets: LCP <= 2.5s, CLS <= 0.1, INP <= 200ms.
- Lazy-load non-critical assets/components.
- Avoid heavy animation on large DOM trees.
- Ensure WCAG-friendly contrast and keyboard/focus visibility.

7. Anti-slop constraints
- No stock template section order.
- No placeholder copy.
- No generic "saas gradient card grid" outputs unless user explicitly asks.
- Never mimic Base44/Replit default aesthetics (plain cards, generic dashboard scaffolds, low-intent typography).
- Approved design inspiration sources are limited to Webflow Made-in-Webflow and 21st.dev/Magic.
`.trim();
