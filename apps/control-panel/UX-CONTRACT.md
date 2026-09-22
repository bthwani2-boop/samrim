# Control Panel UX Contract

## Product context

- Audience: Authenticated BThwani operators.
- Primary jobs: Monitor operations, move partner onboarding forward, maintain catalog resources, manage finance/marketing workspaces and administer platform access.
- Target market(s): BThwani operations in Yemen; domain policy remains in the pinned Governance repository.
- Active locales: Arabic RTL for the current web surface.
- Language/content register: Direct operator language; no raw backend identifiers in normal UI copy.
- Timezone/calendar policy: Feature-owned API values remain canonical; display formatting follows existing feature contracts.
- Accessibility target: WCAG 2.2 AA.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Operator information architecture | `knowledge.sources.json` → Governance `governance/policy/EXPERIENCE.md` | Pinned policy | 2026-09-22 |
| Partner onboarding and field admission | `governance/product/capabilities/partner/partner-onboarding-store-publication.md` | Pinned capability policy | 2026-09-22 |
| Captain operations | `governance/product/capabilities/fulfillment/captain-dispatch.md` | Pinned capability policy | 2026-09-22 |
| Permission model | `services/identity` session contract and `src/session/session-provider.tsx` | Runtime/API evidence | 2026-09-22 |
| Catalog lifecycle | `services/dsh/contracts/openapi` and `src/features/central-catalog` | API/implementation evidence | 2026-09-22 |

## Visual contract

- Project `DESIGN.md`: `apps/control-panel/DESIGN.md`.
- Token ownership model: Existing runtime canonical.
- Runtime design-system/token source: `packages/design-system/src/tokens` → generated `packages/design-system/theme.css`.
- Mapping/export/adapters: `apps/control-panel/app/globals.css` imports `@bthwani/design-system/theme.css`; no screen-local color registry is allowed.
- Token drift gate: `pnpm theme:verify` and `pnpm theme:check`.
- Supported themes: Light and dark, with semantic hierarchy preserved.
- Design-context owner/review policy: Control Panel owns shell composition; the shared Design System owns reusable domain-neutral tokens/primitives.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | Native HTML select | `premium-ui.json` + browser platform contract | Native popup | Keyboard + rendered popup check |
| Date | Native browser date/time input | `premium-ui.json` + browser platform contract | Native picker | Locale + keyboard + E2E |
| Scrollbar | Global application stylesheet | `DESIGN.md` + generated theme | Default app surface | Computed style + rendered browser check |
| Form | Feature-owned semantic form and API adapter | Feature contract/API | Create / edit | Targeted E2E |
| CRUD | Owning route and feature service | API contract | Return to owning list after create; stay on detail for review | Full-flow E2E |

## Navigation and responsive behavior

- Route document title policy: Each route owns a localized Next metadata/title; titles use the established page/product pattern and never contain secrets.
- Route error / 403 page behavior: Keep shell navigation reachable; show a clear recovery action without exposing raw backend payloads.
- Breadcrumb/tab/route-state policy: Breadcrumbs represent route hierarchy. Independent destinations use links, not in-page tabs. Child route state is bookmarkable in the URL.
- Sidebar/drawer/bottom-sheet transformation: Persistent sidebar on desktop; focus-managed overlay drawer below 820px; Escape and backdrop close; trigger regains focus.
- Responsive table strategy: Preserve comparison tables through the owning feature’s deliberate overflow or detail strategy; never clip the page shell.
- Truncation/full-value access: Wrap instructional text; ellipsize only route/current values where the full page remains reachable.
- Focus restoration and sticky-obstruction policy: Route changes focus `#workspace-main`; drawer close restores its trigger; focus rings remain visible and sticky surfaces do not cover the target.

## Overlays and feedback

- Dialog primitive: App-owned feature dialog where a flow needs a modal; no browser-native alert/confirm/prompt.
- Destructive confirmation levels: Explicit object and consequence for irreversible or permission-changing actions; routine navigation does not prompt.
- Toast placement/duration/deduplication: Feature-owned status/live regions follow existing shared patterns; critical recovery remains inline.
- Alert/banner scope and persistence: Inline errors stay with the field/resource; session or service outages use a page alert with retry.
- Tooltip delay/dismissal: Tooltips are optional enhancement; visible labels remain the primary affordance.
- Unsaved-changes behavior: Preserve entered values and guard only flows that can actually lose user work.
- Layer/z-index contract: Drawer/overlay above shell; account menu below modal overlays; tokens come from the shared z-index scale.

## Async and resilience

- Mutation default: Existing feature mutation behavior remains canonical; navigation changes do not manufacture optimistic state.
- Idempotency and duplicate-submit policy: Feature APIs own idempotency; busy controls preserve dimensions and block duplicate submits.
- Auto-save/draft recovery: Not introduced by this navigation slice.
- Offline/read-stale/write behavior: Feature contract decides; shell remains navigable when a resource fails.
- Retry/backoff/timeout behavior: Use the existing feature owner and expose a bounded retry action.
- Version conflict and multi-tab behavior: Feature/API contract remains canonical.
- Session expiry/re-authentication: Session provider returns through the identity surface and preserves safe shell recovery.
- Long-running progress and return path: Feature-owned progress with a stable status region.
- Stale-request cancellation/invalidation and pending-state ownership: Feature-owned data hooks/services remain the source of truth.
- Dialog/form preservation and retry after mutation failure: Preserve form state where the existing feature supports it; do not reset user input merely to show an error.

## Migration status

- Migration ledger location: This change is tracked by the route/registry diff and the control-panel E2E navigation assertions; no parallel tracker is introduced.
- Canonical primitives and owners: `src/navigation/workspace-registry.ts` owns destinations, child route labels and catalog resources; `layout.tsx` owns shell composition.
- Current risk-prioritized slices: Workspace navigation and its nested Partner/Catalog consumers are the first slice; Finance and Marketing remain single real routes until their resource pages exist.
- Legacy import/token enforcement: The former partner subnavigation component and screen-local catalog resource registry are removed. New route consumers import the central registry.
- Rollout/rollback and removal gates: Existing route paths remain unchanged; rollback is a single route-registry/layout revert if browser proof identifies a regression.

## Verification

- Required static commands: `pnpm --filter @bthwani/control-panel typecheck`, `pnpm exec biome lint apps/control-panel --diagnostic-level=error`, `pnpm theme:verify`.
- Browser/device/locale/theme matrix: Arabic RTL, desktop and 390px mobile, light and dark themes, reduced motion, drawer keyboard/Escape path.
- Accessibility checks: Semantic links/lists, visible focus, drawer inert background, focus restoration, one main landmark and route breadcrumbs.
- Component-state/visual regression coverage: Targeted Playwright route, nested navigation and theme assertions; rendered screenshots/inspection at representative viewports when runtime is available.
- Canonical sibling flow used for comparison: Existing workspace shell, catalog overview and partner onboarding pages.
