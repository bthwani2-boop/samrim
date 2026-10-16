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

## Operational workbench acceptance (cross-center target)

These are acceptance rules for **materially affected** operator registries, queues, files and drafts across Operations, Partners/Field, Catalog, Marketing, Finance, HR, Policies and Access. They do not assert the features already exist or require every surface to use the same table, panel, number of columns or update cadence. The durable behavioral owner is `docs/governance/policies/experience.md`; this section specifies Control Panel composition and executable proof.

- **Record-first rows:** Put the canonical record identity and any materially decisive authorized owner/relationship, contact, concise location with map action, main domain and business type, distinct account/publication/readiness states, and frequent safe actions where the operator can scan them. Fit fields to the job: do not manufacture unavailable addresses, contact data, store type names or status; the owning service must extend its bounded summary contract when the job needs those facts. Catalog product categories are not commercial Store Types. Use compact, comfortable views only when both materially improve use; keep essential data reachable in each.
- **High-volume truth:** Search, filtering, sorting, counting and paging operate on the server's canonical result set with stable identity and deterministic order, including across sources when presented as a single sortable list. Do not pretend a stores-then-storeless-partners scan is one globally ordered list. State whether counts cover the page, filtered total or unknown. Prove thousands of representative rows without client download, N+1 identity/media calls, misleading gaps, skipped/duplicated pages or leaked private query/cursor data. Choose fixed first/next pages, keysets or a richer grid only as actual workload warrants.
- **Contextual control:** Use icon-sized affordances such as a labeled eye for quick preview when recognizable, preserving accessible hit targets and keyboard focus. The primary safe action remains obvious; a compact secondary-action menu holds infrequent operations. Mutation visibility depends on permission, canonical state and owner-enforced validation; risky transitions require appropriate confirmation/audit. Bulk selections specify exact scope and per-item outcomes, including partial failure. No fake client-side writes.
- **Files, cases and drafts:** Open repeated reviews in a context-preserving inspector/drawer/split view when it makes the job faster. Full object/workflow routes remain available for multi-step editing and deep links. Start with identity/media, separate states, missing prerequisites, next action and direct entity relationships, then coherent expandable evidence/history/secondary configuration. Keep navigation, filters, selection, scroll/return focus and unsaved draft input intact. A flat facts grid or an extra route for every simple field does not meet this contract.
- **Media review:** Clicking an authorized thumbnail/logo opens the same proven product-image viewer pattern or a single legitimately reusable equivalent, with contain-fit, responsive bounds, keyboard/Escape dismissal, focus restoration, and broken/missing-image feedback. Internal onboarding evidence remains protected; never leak signed/restricted media into public previews.
- **Automatic read freshness:** Do not place routine reload/re-read buttons in the normal work path when canonical data can be invalidated or revalidated automatically. Revalidate appropriately on entry/return, material query change, successful mutation and important external changes; avoid blind perpetual polling. Preserve editing/selection context, distinguish stale/unknown from confirmed state, and retain exception-only retry for failure or reconciliation. Background refresh never approves, saves, publishes or discards drafts by itself.
- **Space-efficient shell:** Desktop navigation offers a clearly reversible icon-only compact state alongside expanded labels when useful for wide data work. Every authorized destination (including Field work) remains reachable, named on focus, and keyboard accessible; store the preference without making mobile drawer behavior worse. Wide registries use available viewport, pinned context/actions or purposeful overflow without flattening semantic table rows.
- **State meaning and accessibility:** Publication, account activation, readiness, operational availability and pending approval are different facts. Use restrained icon + accessible text/label/tooltips, not color or a single ambiguous “active” indicator. Verify Arabic RTL and mixed-direction phones/addresses, small screens, light/dark, screen reader, keyboard and reduced motion.
- **Compact record indicators:** Repeated account/publication/delivery facts use distinct shapes with canonical Arabic accessible names and meanings available on hover/focus. A visible grouped legend sits beside collection pagination and remains available when no pagination is needed. CSV exports retain full text. The partner/store directory uses the same bounded query, selection and state for desktop semantic rows and mobile record cards; essential states/actions remain visible without horizontal scrolling. Store inspection opens beside the list, supports previous/next stores within the loaded page, preserves the original return target and offers retry only on failed reads.

### Platform policy administration

- **One discoverable manifest:** `src/features/policies/policy-capabilities.ts` owns the UI-visible family ID/name, Store Type versus vertical scope, owner, supported canonical preview source and additional UI permission. `policy-editors.ts` only binds these IDs to the existing owning editors; `src/navigation/workspace-registry.ts` reuses the manifest, not a duplicate policy list. Adding a genuinely supported policy family requires owner-consumed behavior/contract, one capability entry, one editor adapter and focused verification—not another navigation/workspace system or a parallel policy writer.
- **One work surface:** `/policies` is the canonical operator workspace. Its rows hold the source-backed essentials and an accessible eye preview anchored without list reflow; a pencil opens the approved editor directly when authorized. The top-level `إدارة سياسة` chooser handles create/edit without reselecting an already chosen family. Old policy subroutes have been deleted after repointing internal consumers: deep-link queries to `/policies` open the authorized editor, never a competing route. Never fabricate policy totals, lifecycle states, history or actor names in a row or preview.
- **BThwani Captain minimum balance:** `captain-minimum-balance` is one WLT-owned, globally versioned *positive* YER available-balance threshold. It applies only to `BTHWANI_CAPTAIN` offer selection and acceptance for wallet, cash and mixed payment; independent cash-exposure collateral remains enforced. Before an operator configures the first version, preserve existing dispatch rules. An unavailable WLT policy read is an outage (fail closed), not an implicit zero. Partner-managed Store Captain assignments do not inherit this policy. Read actual WLT policy values/actor/reason/history, not UI copies. Do not invent a default threshold or auto-activate it during migration.
- **Rich policy previews and change history:** The row must show an actual owner-backed value, scope and status or an explicit missing/error state. DSH joins WLT active financial rule values with current DSH city/Store Type names for display only; no new storage or business logic. Eye preview reads bounded, authorized audit trails from DSH and WLT; the pencil is the only direct edit affordance, and the shared management action is the only general create/edit entry. The old summary drawer, redundant edit button inside the eye and generic five-name search are not part of the finished design. Actor IDs are not person names; never infer either.
- **Field acquisition reward scope is the commercial Store Type (`STORE_TYPE` + commercial Store Type ID), never the commerce vertical**. A vertical selector may help the operator locate Store Types only; it must not enter the reward policy scope or define the reward for every Store in that vertical.
- Present only owner-backed lifecycle states, effective scope and provenance. The current WLT active version has version, created-at and acting actor ID; it is not by itself a complete event timeline, a friendly actor name, or proof of retroactive application. Do not fabricate history/actor labels from client-side state. Financial mutations require reason, version checks, idempotency, role validation and canonical readback.

### Partner/store workbench integration

- The partner's Identity actor and each DSH Store remain distinct canonical entities; one Partner may have zero, one or many Stores. The operator sees an actionable relationship: each Store has a store row linked to its owning Partner, and a Partner without a Store remains discoverable, never hidden behind a second routine directory.
- The same authorized Store identity/media and owner relationship appear in registry, quick preview, joining-case review and Store/Partner file; the same business name is not pointlessly duplicated within a single row. Display true contact, city/address/map, vertical and commercial Store Type where the owning summary supplies them; do not infer them from joining history when later Store facts can change.
- Joining approval, Partner-role activation, Store-access grant, Store publication and current orderability are independent state machines and must remain distinguishable. A user can move between the owning cases/files and take authorized actions without guessing which similarly named page to visit.
- Preserve valid `/partners/stores` and object deep-link transitions, including applied nonsensitive filters; avoid a separate accounts registry as the routine primary path once the unified directory is proven. Return users to their originating collection context rather than its unfiltered first page.

### Proof before declaring an operator UX slice closed

Exercise a realistic repeated-task flow at representative collection size: search/filter/sort, understand a dense row, preview image and record, open draft/full file, act with a permitted role, observe canonical readback, return to the exact working context, receive an external update and recover from stale/conflict/network failure without losing a draft. Verify negative permissions, forbidden media, responsive/theme/RTL/focus and accessible icon meaning. Measure relevant query cost, payload, request fan-out, DOM/memory and interaction latency against the claimed capacity, not merely 10 mocked rows or updated screenshots. Fix affected source/API/index/migration/feature ownership and eliminate losing paths before claiming the workflow is complete; use the canonical Quality and Scalability policies for the proportional evidence model.

## Navigation and responsive behavior

- Route document title policy: Each route owns localized server-side Next Metadata in its page or route-segment layout (for client pages); the root layout supplies the product fallback and title template. Titles use the established page/product pattern and never contain secrets.
- Route error / 403 page behavior: Keep shell navigation reachable; show a clear recovery action without exposing raw backend payloads.
- Breadcrumb/tab/route-state policy: Breadcrumbs represent route hierarchy. Independent destinations use links, not in-page tabs. Non-sensitive filters, sort and public catalog cursors use the URL. Identity/Field searches and cursors can contain phone data and stay in tab history state; the URL carries only a page marker. Back/forward and reload restore that tab state. A bookmark without private state starts the first page. Never put private searches or encoded identity cursors in the URL.
- Center navigation: All centers share the current-only child sidebar from `workspace-registry.ts`. Center links are not repeated as a second route-tab strip; object/work-queue views remain contextual. `PageHeader` owns the one page title/action row. Partners has three visible child destinations: the single partner/store directory at /partners, joining/access approvals at /partners/joining, and the existing field-agent workspace at /fields. The directory displays a store row per store and an account-only row only after a bounded DSH store-presence read confirms no non-deleted store. Canonical data remains in DSH (stores, media, publication) and Identity (accounts, roles). The BFF has bounded 10-row keyset pages, a scoped two-phase cursor (stores then storeless partners), at most five bounded identity-presence batches per account-only page, and one Identity role batch per store page. It never downloads an entire roster or performs per-row HTTP reads. A page with zero matching rows and a continuation cursor is not a global empty state. Search, service city, publication state, sort and mode are applied by the server; fields that require a store exclude storeless accounts. Phone searches use same-origin POST and tab-held filter state; Identity cursor markers appear in the URL only as page numbers, with their actual values retained in tab history. The old /partners?view=accounts remains only for preexisting bookmarks and is not an additional visible directory. Existing /partners/stores links redirect to /partners with public store filters preserved. Approval workflows remain distinct, and search indexes the root once, not twice.
- Center roots with no operational overview redirect to their first resource from the same registry. Do not duplicate destination links in the work area. Reference lists use read-only rows with a single explicit inline editor, capped at 320px, and creation disclosed in a compact form capped at 480px. Keyboard Enter saves, Escape cancels, and focus returns to the row action. Loading/error never implies an empty reference registry.
- Small complete reference lists support immediate local name/status filtering and a clear reset; their counts describe the visible subset of the authoritative loaded list. These transient reference filters do not create server pagination or capacity claims. Keep the selected wallet editor visible while refreshing a conflict, disable filter changes during editing, and restore focus to the search if a saved rename leaves the current filter. Reference column widths remain stable when an editor opens.
- Presentation ownership: `app/globals.css` is the only application stylesheet, imported once by the root layout. New screens compose shared semantic primitives; no page CSS/modules or inline presentation alternatives. The shared Design System owns generated tokens/native controls.
- Sidebar/drawer/bottom-sheet transformation: Persistent sidebar on desktop; focus-managed overlay drawer below 820px; Escape and backdrop close; trigger regains focus.
- Responsive table strategy: Shared table wrappers and paged card lists have a maximum height of 70dvh and deliberate overflow. Table headings stay visible as a group, including multi-row filters; native table rows must not become flex/grid containers. Constrain grid tracks so wide tables never expand the shell. Field and joining tables retain their pinned identity/actions; printing removes the viewport bound. Focused controls remain reachable below sticky surfaces.
- High-cardinality data policy: Read records through bounded server pages, normally at most 50 per request. Search and filter on the owning API; do not download full registries into the browser or native selects. Keep a selected lookup value visible when search results change. Say whether a count is the current page, a loaded subset or a server-reported total; never infer total population from the visible rows.
- Home overview: Show permission-scoped, owner-filtered queues as separate bounded previews, not as one falsely ordered feed. Empty copy describes the current previews only; each queue opens its canonical list, while record rows open their canonical detail. Notifications display the authoritative global unread count separately from up to four visible unread items; each item opens its related record when the relationship is known, otherwise the inbox. Returning refresh keeps current rows visible with a refresh status, principal changes clear prior-principal data before reading, and failed reads stay recoverable. Preview length never becomes a collection total.
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
- Store inspection: The registry opens a read-only, nonmodal region on demand from the existing publication/readiness owner. Loading, forbidden, invalid response and retry remain distinct from readiness. Escape/close restores the originating control. The shared cursor pagination and whitelisted query context preserve search, publication filter, sort, page and selected inspection across reload and the full store file return; no alternate publication writer is introduced.
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
- Finance settlements: One finance sidebar destination `/finance/beneficiary-settlement` opens “المستحقات والتسويات”; its inline beneficiary-scope navigation selects the existing `/finance/beneficiary-settlement/partners`, `/captains`, and `/field` routes. These remain actor-scoped registries over the shared settlement workspace; old deep links and finance identities are preserved. Query state preserves the selected registry page, batch, batch filter, execution view, and reconciliation view. Beneficiary rows use bounded server pages; batch execution and statement reconciliation remain on demand. WLT remains authoritative for amounts, destinations, evidence, and transitions.
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
