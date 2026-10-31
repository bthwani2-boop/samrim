# Control Panel design

Arabic RTL operations console. The approved refoundation replaces the previous presentation system across the application. Domain services, permissions, financial invariants and persisted data retain their canonical owners.

## Ownership

- `packages/design-system/src/tokens` owns semantic colors, themes and foundational tokens; generated `theme.css` is consumed rather than copied.
- `app/globals.css` is the **only Control Panel stylesheet**, imported only by `app/layout.tsx`. `web.css` supplies shared native controls used by other applications too.
- `src/shell/page-header.tsx` owns page titles/actions. `workspace-icon.tsx` owns the shell's stroke icon family.
- `src/navigation/workspace-registry.ts` owns destination names, hierarchy and search. Every center uses the same contextual sidebar. Only the current center's children are expanded. Object tabs stay with their object; distinct work modes may use contextual tabs inside one canonical workspace when the workflow needs them. A second competing center menu is forbidden.
- Resource-only center roots open their first canonical resource directly. Never repeat the sidebar as a grid of destination cards in the work area. Small reference registries show readable rows; creation is disclosed and only one selected record is edited at a time, using a compact form.
- Compact operational indicators share the shell's stroke icon family through `workspace-icon.tsx` and the repeated record treatment in `features/shared/record-indicator.tsx`. Account and publication remain separate, delivery uses one shape per mode, and legends use full Arabic labels. Desktop record inspection uses a resizable split with minimum widths of 510px for the list and 440px for details; its 30–60% preferred range is bounded by those widths and the available workspace, and the keyboard separator exposes the effective range. When that split does not fit, the record becomes a full-width file. Phone lists show concise record cards without transforming native table rows into layout containers. Compact sidebar children use recognizable destination icons instead of identical dots.
- `UX-CONTRACT.md` owns observable behavior. Domain services remain the authorization/query/state owners.

## Visual direction

Quiet, compact work surfaces; clear scan lines and restrained action emphasis. Light mode uses shared muted/base surfaces, navy text and accessible orange actions. Dark mode consumes the same semantic roles. No theme values copied into page code, gradients, hero sections or giant heading panels.

Typography uses the shared Arabic system font; titles 24px (21px on phone), section titles 17px, text 14px/1.6, labels and tables 13px. Numerical values use tabular figures and correct bidirectional isolation. Buttons fit their action; full-width is an explicit task choice rather than a global default.

The header is 64px on desktop. A 224px right orientation rail gives way to a focus-managed drawer below 820px. Content uses 24px desktop and 12px phone inline padding. Work sections use 16px gaps, thin boundaries and modest 7–12px radii. Controls are 40px; actions are at least 36px on desktop and 44px on touch layouts. Compact does not mean inaccessible text or crowded targets.

## Composition

- **Registry:** `PageHeader`, `registry-toolbar`, active filters/selection scope, `table-wrap` with a semantic table, then `pagination`. Tables and paged card lists use at most 70dvh with internal scrolling; table headings stick as a group. Tables compare essential facts and next safe actions. Growing collections use canonical server query/paging; page-local controls must name their scope. Secondary record actions and relationship lists open on demand.
- **Object:** `PageHeader`, current state/next safe action, `facts-grid` and relevant object tabs/sections. Avoid stacks of cards inside cards. Preserve registry context through the existing query/back path.
- **Form:** `form-section` and `form-grid`, visible labels, validation and a concise `action-row`. Related independent facts can share two columns on desktop; phone is one column. Only the facts required at the current stage block completion.
- **Home:** real actionable queues linking to their canonical workspaces. Never manufacture summary numbers or claim collection-wide absence from a bounded sample. Keep Home focused on three action-oriented operational indicators and canonical task queues. A collapsed seven-day order trend and a preview of at most three unread notifications may use the existing owner-backed APIs, while full analytics, alert review and navigation stay in their canonical centers. Show counts and measurement times only when sourced from their authoritative responses. Show manual refresh only as error recovery.
- **Public identity:** the same controls, an isolated constrained authentication composition. It cannot resize workspace actions.

The Studio preview canvas alone may project validated, authored CSS color variables through a scoped style prop for live editing; they never modify the authenticated operator shell, canonical tokens, published configuration or unrelated pages. Local editor drafts must be explicitly labeled unsubmitted. Use standard elements first. Introduce a shared React primitive only where repeated semantics require one. Do not create screen-local styles, duplicate controls, route-specific tokens or a separate UI framework. Existing domain class names can remain as interaction/test hooks; all visual rules live in the sole stylesheet's base, shell, components and composition layers.

## Content and states

No introductory essays, decorative eyebrows, source-service vocabulary, transport versions or opaque IDs in ordinary operator tasks. Keep concise labels, units, necessary constraints, error/recovery, authorization and consequential confirmation. Required meaning must not be deleted to shorten a page.

Loading/unknown differs from zero/empty. Native `[hidden]` remains hidden irrespective of display rules. No success, balance or readiness claim before canonical readback. Theme, hover, focus, disabled/busy, selected, reduced motion, keyboard, Arabic/RTL and mobile are part of the component contract.

The document owns scrolling. Navigation and wide data tables have deliberate bounded overflow; page ancestors never crop long forms. Forms retain native accessibility and associated descriptions. Data surfaces stay within the page, including on phone and at increased text size.

## Verification

`tests/presentation-contract.spec.ts` guards single stylesheet ownership, contextual navigation, route-order stability, hidden states and responsive geometry. Existing workflow tests own permission, action, validation and recovery regressions. Render representative real authenticated screens in both supported themes; source/typechecks and mocked UI proofs do not prove real persistent workflows or thousands-record performance.

The presentation contract also rejects inline presentation and competing style engines; the taxonomy owner's numeric `--tree-depth` is the sole data-driven exception. Four approved visual baselines cover the shared operational registry at desktop/mobile sizes in light/dark themes, using Chromium with reduced motion and isolated read fixtures. Baselines are platform-specific because system fonts differ; update only intentional reviewed changes with Playwright's explicit `--update-snapshots` command. The existing `control-panel:e2e` dependency of `browser-live-proof` runs these checks inside the required `repository-backend-integration` gate; no additional CI service or design registry is introduced.

External interaction references: Shopify App Design layout/navigation guidelines and Carbon data-table usage. References inform patterns; they do not assign BThwani domain ownership or authorize new business features.
