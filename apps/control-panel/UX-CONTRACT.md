# Control Panel UX Contract

## Product context

- Audience: Authenticated BThwani operators.
- Primary jobs: Monitor operations, move partner onboarding forward, maintain catalog resources, manage finance/marketing workspaces and administer platform access.
- Target market(s): BThwani operations in Yemen; approved durable domain policy is routed by `../../docs/governance/README.md`.
- Active locales: Arabic RTL for the current web surface.
- Language/content register: Direct operator language; no raw backend identifiers in normal UI copy.
- Timezone/calendar policy: Feature-owned API values remain canonical; display formatting follows existing feature contracts.
- Accessibility target: WCAG 2.2 AA.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Operator information architecture | `../../docs/governance/policies/experience.md` | Local approved policy | 2026-09-22 |
| Partner onboarding and field admission | `../../docs/governance/product/capabilities/partner/partner-onboarding-store-publication.md` | Local approved capability | 2026-09-22 |
| Captain operations | `../../docs/governance/product/capabilities/fulfillment/captain-dispatch.md` | Local approved capability | 2026-09-22 |
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
| High-cardinality registries and lookups | Domain feature over its existing bounded server API | Owning API contract | Server search/filter/sort/cursor; no unbounded option list; URL carries applied query and current cursor | Boundary-sized API/E2E plus rendered recovery states |
| Product registry summary | Existing DSH product-registry response | DSH count and page from one database snapshot, with one shared filter definition | Complete filtered total, current-page count and UTC measurement time; absent total remains unknown; the adjacent registry is the drilldown | Isolated persisted count/filter/page proof and BFF/browser readback |
| Operator notification inbox | DSH notifications through the authenticated Control Panel BFF | DSH notification cursor and complete unread count | Bounded cursor pages in the URL; server unread count is global, card groups and page counts describe the current page | Cursor/readback E2E and browser back/forward |
| Operator account directory | Identity role search through the authenticated Control Panel BFF | Identity actor role and permission grants | Search, enabled state, permission coverage, stable sort, and cursor are filtered by Identity before page limiting; enabled permission count is part of the bounded result | Identity database filter/count test and Control Panel query E2E |
| Table selection | `src/features/finance/use-page-selection.ts` | This contract | Visible page only; bulk operations submit only selected canonical record IDs | Keyboard + E2E |
| CRUD | Owning route and feature service | API contract | Return to owning list after create; stay on detail for review | Full-flow E2E |
| Finance evidence upload | Finance feature upload control and authenticated Next BFF → DSH → WLT | WLT evidence document | One receipt per transfer; one statement per period/batch | Authorization + type/size + download + reconciliation |

## Navigation and responsive behavior

- Route document title policy: Each route owns localized server-side Next Metadata in its page or route-segment layout (for client pages); the root layout supplies the product fallback and title template. Titles use the established page/product pattern and never contain secrets.
- Route error / 403 page behavior: Keep shell navigation reachable; show a clear recovery action without exposing raw backend payloads.
- Breadcrumb/tab/route-state policy: Breadcrumbs represent route hierarchy. Independent destinations use links, not in-page tabs. Non-sensitive filters, sort and public catalog cursors use the URL. Identity/Field searches and cursors can contain phone data and stay in tab history state; the URL carries only a page marker. Back/forward and reload restore that tab state. A bookmark without private state starts the first page. Never put private searches or encoded identity cursors in the URL.
- Center navigation: All centers share the current-only child sidebar from `workspace-registry.ts`. Center links are not repeated as a second route-tab strip; object/work-queue views remain contextual. `PageHeader` owns the one page title/action row.
- Center roots with no operational overview redirect to their first resource from the same registry. Do not duplicate destination links in the work area. Reference lists use read-only rows with a single explicit inline editor, capped at 320px, and creation disclosed in a compact form capped at 480px. Keyboard Enter saves, Escape cancels, and focus returns to the row action. Loading/error never implies an empty reference registry.
- Small complete reference lists support immediate local name/status filtering and a clear reset; their counts describe the visible subset of the authoritative loaded list. These transient reference filters do not create server pagination or capacity claims. Keep the selected wallet editor visible while refreshing a conflict, disable filter changes during editing, and restore focus to the search if a saved rename leaves the current filter. Reference column widths remain stable when an editor opens.
- Presentation ownership: `app/globals.css` is the only application stylesheet, imported once by the root layout. New screens compose shared semantic primitives; no page CSS/modules or inline presentation alternatives. The shared Design System owns generated tokens/native controls.
- Sidebar/drawer/bottom-sheet transformation: Persistent sidebar on desktop; focus-managed overlay drawer below 820px; Escape and backdrop close; trigger regains focus.
- Responsive table strategy: Shared table wrappers and paged card lists have a maximum height of 70dvh and deliberate overflow. Table headings stay visible as a group, including multi-row filters; native table rows must not become flex/grid containers. Constrain grid tracks so wide tables never expand the shell. Field and joining tables retain their pinned identity/actions; printing removes the viewport bound. Focused controls remain reachable below sticky surfaces.
- High-cardinality data policy: Read records through bounded server pages, normally at most 50 per request. Search and filter on the owning API; do not download full registries into the browser or native selects. Keep a selected lookup value visible when search results change. Say whether a count is the current page, a loaded subset or a server-reported total; never infer total population from the visible rows.
- Truncation/full-value access: Wrap instructional text; ellipsize only route/current values where the full page remains reachable.
- Focus restoration and sticky-obstruction policy: Route changes focus `#workspace-main`; drawer close restores its trigger; focus rings remain visible and sticky surfaces do not cover the target.

## Overlays and feedback

- Dialog primitive: App-owned feature dialog where a flow needs a modal; no browser-native alert/confirm/prompt.
- Destructive confirmation levels: Explicit object and consequence for irreversible or permission-changing actions; routine navigation does not prompt.
- Toast placement/duration/deduplication: Feature-owned status/live regions follow existing shared patterns; critical recovery remains inline.
- Alert/banner scope and persistence: Inline errors stay with the field/resource; session or service outages use a page alert with retry.
- Tooltip delay/dismissal: Tooltips are optional enhancement; visible labels remain the primary affordance.
- Unsaved-changes behavior: Preserve entered values and guard only flows that can actually lose user work.
- Product editing recovery: A failed detail read remains a retryable read rather than a creation form. Version conflicts retain the draft and selected upload; explicitly loading the current version discards them. Unchanged save/upload retries retain their idempotency key. Upload success updates canonical media/version without replacing unsaved product fields; save success follows a fresh detail read.
- Product image review: The optional gallery and default table use the same registry query. Review uses the selected product's canonical media order in a native modal dialog, with image navigation, load failure/retry, bounded viewport, keyboard isolation, Escape and trigger focus restoration.
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
- Current resource navigation: Finance and Marketing destinations and child routes are owned by `src/navigation/workspace-registry.ts`.
- Finance settlements: `/finance/beneficiary-settlement/partners`, `/captains`, and `/field` are actor-scoped registries over the shared settlement workspace. Query state preserves the selected registry page, batch, batch filter, execution view, and reconciliation view. Beneficiary rows use bounded server pages; batch execution and statement reconciliation remain on demand. WLT remains authoritative for amounts, destinations, evidence, and transitions.
- Partner commission receivables: `/finance/partner-commission-receivables` is a server-driven registry of open partner commission balances, with bounded cursor pages, actor search and sort, and a selected partner detail loaded on demand. A remittance is recorded only after the operator verifies receipt; WLT owns the balance and idempotent transition.
- Customer withdrawal review: Operations registers the rare, evidence-backed customer request at `/operations/customer-withdrawals`; its success action opens the created request in `/finance/customer-withdrawals`. Finance owns destination preparation/verification, acceptance or rejection, payout hold preparation/approval, and handoff to the shared settlement batch workspace. No balance changes before the WLT acceptance transition.
- Finance upload: receipt evidence is mandatory per transfer; an official wallet statement is uploaded once per period/batch and normalized rows are linked to reconciled transfers. Evidence is private, encrypted at rest by WLT, and accessed through finance-authorized routes only.
- Legacy finance routes: partner/field earnings routes redirect to the actor-scoped settlement workspace; commission receivable/remittance remains separately named because it is money owed to BThwani, not beneficiary payout. The unqualified settlement route resolves to the partner registry.
- Rollout/rollback and removal gates: rollback is a single route-registry/feature revert only before any new transfer evidence is written; schema migrations preserve legacy references for historical records and enforce document-backed new execution records.

## Verification

- Required static commands: `pnpm --filter @bthwani/control-panel typecheck`, `pnpm exec biome lint apps/control-panel --diagnostic-level=error`, `pnpm theme:verify`.
- Browser/device/locale/theme matrix: Arabic RTL, desktop and 390px mobile, light and dark themes, reduced motion, drawer keyboard/Escape path.
- Accessibility checks: Semantic links/lists, visible focus, drawer inert background, focus restoration, one main landmark and route breadcrumbs.
- Component-state/visual regression coverage: Targeted Playwright route, nested navigation and theme assertions; rendered screenshots/inspection at representative viewports when runtime is available.
- Canonical sibling flow used for comparison: Existing workspace shell, catalog overview and partner onboarding pages.
