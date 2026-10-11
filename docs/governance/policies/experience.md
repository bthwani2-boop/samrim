# Experience and Interaction Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/experience.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

UX communicates canonical Product state, authority, available actions, feedback and recovery. User-facing experience is part of functional correctness, not end-stage polish.

This policy owns durable information-architecture, navigation, interaction, RTL/localization, accessibility, state/recovery and platform-adaptation invariants. Durable visual identity and design language are owned by `docs/governance/policies/design.md`.

## BThwani experience contract

BThwani maintains one recognizable cross-surface experience system with platform-native behavior. Unified identity does not mean identical information architecture, identical shells or pixel-identical UI across Client, Partner, Captain, Field and Control Panel.

The durable BThwani experience must remain:

- Arabic-first and RTL-first for the currently admitted Arabic surfaces;
- fast to understand, clear, trustworthy, warm, modern and uncluttered;
- consistent in semantic hierarchy, feedback, state meaning and recovery where the same semantics apply;
- adapted to the actor's real job rather than forcing every app into one navigation model;
- adaptive to platform/device/window/input conventions rather than forcing one layout model everywhere.

Visual identity, color, typography, shape, iconography, imagery, elevation and motion language are governed by `docs/governance/policies/design.md` and implemented through the canonical reusable Design System where reuse is proven.

## Effort-minimal experience at operational scale

**No avoidable technical or user-experience complexity.** Across Customer, Partner, Captain, Field and Operator work, the default is the shortest clear, safe, recoverable path to the actor's real outcome. Thousands of Stores, products, records or daily actions must not turn routine work into repeated forms, navigation or technical troubleshooting. Simplicity means removing unnecessary work, not concealing missing functionality or weakening canonical controls.

- **Ask only for what is needed now.** Collect the minimum facts required for the current authorized transition; defer unrelated catalog, publication or operational setup to its actual owner and stage. An optional field or attachment never silently blocks progress. Use progressive disclosure instead of showing every future decision at intake.
- **Enter a fact once.** Reuse canonical verified facts and appropriate safe defaults; do not make actors re-enter saved data, repeat uploads or re-confirm the same unchanged decision. Allow short drafts, continuation and recovery from interrupted work without duplicate records or silent overwrites. Never prefill fabricated identities or unverified facts.
- **Keep the next action obvious.** Give each task a clear primary action, understandable requirements and immediate actionable feedback. Validate early where useful; preserve entered work and provide a straightforward retry or correction when a dependency fails. Hide technical versions, transport tokens and implementation vocabulary from normal workflows.
- **Support repeated work efficiently.** For materially growing collections, use the appropriate server-owned search, filtering, bounded results and compact in-context actions. Offer scanning, import, batch operations or keyboard-friendly editing only when they materially reduce real work, with explicit scope, permissions and per-record outcome when applicable; never manufacture bulk complexity for a small task.
- **Make complexity earn its place.** An added screen, approval, mandatory field, confirmation, service, state or abstraction requires a present, provable user, business, legal or safety need that a simpler existing path cannot satisfy. Remove obsolete paths after safe cutover; keep essential authorization, privacy, integrity, audit, financial and recovery guarantees enforced behind the experience.
- **Prove simplicity with real actors.** Verify the repeated end-to-end job (entry, save, submit, review, correction and next-owner readback as applicable) on representative data and actual interaction. When claiming a workflow is faster or simpler, compare meaningful steps, re-entry, failure/retry burden or task time against its previous behavior rather than relying only on screen count or appearance.

## Information architecture and application shell

A materially developed surface requires a coherent information architecture before isolated page styling or feature depth.

```text
ACTOR / USER OUTCOME
→ CURRENT CAPABILITY SET
→ INFORMATION ARCHITECTURE
→ APP / WORKSPACE SHELL
→ NAVIGATION MODEL
→ SCREEN HIERARCHY
→ INTERACTION + STATE MODEL
→ FEATURE PRESENTATION
```

- Derive each app's shell and navigation from that actor's admitted jobs and frequency/criticality of use; do not clone one app's tabs, headers or chrome into another merely for visual consistency.
- Establish the simplest complete canonical shell/navigation model for the materially affected scope before deepening screens that depend on it.
- Persistent/global actions and local/contextual actions must be distinguishable. The user must be able to understand where they are, what the primary action is, how to move to another admitted job, and how to return or recover.
- Navigation structure must not invent future capabilities, empty destinations or speculative placeholders to make an app appear complete.
- A route or screen is composition, not durable Product truth. Presentation follows the capability and service owners rather than becoming a competing business model.
- A missing or materially wrong shell, navigation hierarchy or screen relationship is incomplete implementation even when each isolated screen renders and its API calls work.

For the Operator workspace, the durable top-level information architecture is organized around eight centers: Leadership; Operations; Partners; Catalog; Marketing and Content; Finance; Policies; Access and Permissions. Partners and Catalog are separate centers because partner lifecycle, field acquisition, serviceability and store readiness are distinct from central product identities, their categories, proposals and imports. The Catalog center owns operator-facing management of the shared catalog, including its categories, structured data definitions and import/review workflows. Quick Prices uses a fast operational grid on desktop and compact sequential price entry on mobile. In Arabic operator-facing central catalog experiences, use the term “الفئات” for this taxonomy, including its top-level and nested levels. Policies is the operator-facing home for cross-capability shared platform rules, including service geography, delivery fees and field rewards; it does not own catalog taxonomy or product data definitions. After Go-Live, ongoing Store-local catalog content and menu organization remain in the Partner workspace with the Store owner. Before Go-Live, the assigned Field gets only authorized initial catalog entry for that joining Store through DSH. Finance provides one operational workspace for “مستحقات وتسويات الشركاء والكباتن والميدان” with distinct Partner, BThwani Captain and Field sections and a shared execution/reconciliation workbench. For each Store, Finance sees the proposed agreement, Partner acceptance, Finance approval and active version as explicit states; if a Store Type rate is shown, it is visibly a suggestion and cannot appear as active terms. Partner, Captain and Field official-wallet intake may select a provider preference only; where available, the Identity-derived phone and official name are read-only, and stale Identity facts require reverification. Its growing payout and evidence resources use server-driven registries with server-owned search, filters, sorting, bounded paging, selection/actions where justified, and on-demand relationship details. Customer balance withdrawals remain a separately authorized exception queue: Operations records the request, Finance approves and executes it, and an independent operator reconciles it. Funding, COD remittance, beneficiary payouts and customer withdrawal exceptions remain distinct work queues because they have different sources, authority and state transitions. These centers organize administration and do not reassign canonical capability meaning, data or write ownership. Personal profile, appearance, own-session and security utilities remain shell/account utilities rather than a ninth business center. A center is an information-architecture responsibility, not a new service or semantic owner.

### Operator operations-at-scale contract

The Control Panel is an operations console for sustained work at scale, not a decorative dashboard. Operator presentation starts from the job, resource semantics and expected scale rather than a preferred component.

```text
OPERATOR JOB
→ RESOURCE / WORK SEMANTICS
→ EXPECTED SCALE + CHANGE RATE
→ PRESENTATION PATTERN
→ CANONICAL QUERY / STATE
→ SAFE ACTION
→ FEEDBACK / RECOVERY
→ CANONICAL READBACK
```

An Operator resource that can materially grow and whose primary job is to find, filter, sort, compare, select or act on records uses a server-driven operational registry by default. Server-owned search, filtering, sorting, aggregation/counting and bounded paging or incremental retrieval operate over the canonical result set represented by the query; the UI must not present filtering or sorting over only a loaded page/subset as if it were full-collection truth. Small, bounded collections whose complete authoritative result can be safely and efficiently loaded may use simpler client-side collection processing when doing so does not weaken correctness, permissions, freshness or expected scale.

The registry default is not universal. Use a queue for work ordered by operational attention, SLA, priority or state; a tree or nested-resource presentation for genuine hierarchy; a feed for chronological/event consumption; and a focused object/detail workspace when one entity and its relationships are the primary task. Cards are appropriate when the collection is small or materially visual/non-columnar; they are not the default replacement for a comparable growing operational collection. A dashboard summarizes high-signal status, anomalies, trends or work requiring attention and links into the owning operational workspace; it must not become a card-based substitute for managing a large collection.

A materially capable operational registry exposes only the controls that improve the real operator job, selected from search, structured filters, sort, result count, column/view preferences, selection, contextual or bulk actions, bounded navigation and on-demand detail. Controls are not added to satisfy a checklist. Identity, status, decisive comparable attributes and next safe actions remain scannable before secondary metadata.

Collection state that materially affects repeated work must survive the interaction path by an appropriate mechanism. Filters, sort, page/position, visible columns, density or another relevant view preference may be persisted or made shareable when doing so materially reduces repeated setup. URL persistence is appropriate only for nonsensitive state with an unambiguous owning collection; sensitive values do not enter URLs merely for convenience. Repeated operational query configurations may become saved views when their recurrence and value are proven rather than speculatively prebuilt.

Selection scope is explicit. Page-local selection, loaded-result selection and an action over all canonical records matching a query are materially different states and must never be represented as interchangeable. A bulk action states the affected scope and consequence before execution and exposes busy/progress, partial failure or recovery, and final canonical outcome when those states are materially possible. Large or long-running multi-record execution semantics are owned by `docs/governance/policies/reliability.md`; presentation must not simulate a client-side loop as atomic platform success.

Detail presentation preserves collection context when operators repeatedly inspect or compare multiple records. A split panel, drawer, expandable detail or equivalent in-context presentation is appropriate only when that workflow is materially faster and clearer than repeated route changes. Complex editing, investigation or multi-step work uses a focused detail/workflow surface when a persistent side panel would constrain the task or duplicate the canonical object workspace.

Concurrent or stale state never ends in silent overwrite or fake success. When a material conflict is detected, the experience makes the conflict understandable and provides a safe path to refresh, compare, retry or abandon before canonical readback. The UI does not expose transport concurrency tokens or backend implementation vocabulary as the normal explanation.

Tabular information uses native semantic table structure where possible. Adopt an interactive grid/spreadsheet interaction model only when cell navigation, editing, row/cell selection, copy/paste or similarly dense keyboard interaction is a material job; that choice carries the corresponding managed-focus and keyboard obligations. Visual resemblance to a spreadsheet alone is not sufficient reason to introduce grid semantics.

RTL remains correct under operational density and horizontal overflow. Logical start/end semantics, reading and focus order, sort/filter affordances, identifiers, phone numbers, dates, quantities and mixed Arabic/Latin values must remain understandable and copyable. Wide data surfaces may scroll when necessary, but orientation, record identity, materially required actions and accessible navigation must not become ambiguous.

Presentation patterns never reassign the underlying capability owner, writer, authorization boundary or canonical readback. Do not create duplicate list/detail routes, permanent side-by-side edit forms, client-filtered server-paginated truth or parallel presentation models that become shadow operational truth.

## Interaction and platform adaptation

The same BThwani semantic outcome may use platform-appropriate navigation, system controls, safe areas, gestures, keyboard/pointer behavior, dialogs/sheets, window sizes and platform chrome.

Familiar native interaction takes priority over decorative brand mimicry. Apple/Android/Web design guidance challenges interaction and platform fit; none of those external systems defines BThwani Product truth, information architecture or brand identity.

Interaction patterns with repeated semantics should converge when real consumers prove common need, including form submission, confirmation, destructive actions, search/filter, loading, retry, offline handling, authentication, checkout, order state and operational accept/reject flows.

Touch targets, focus order, keyboard reachability, gesture behavior and safe-area handling must remain usable under the actual platform/input model. Do not hide essential actions behind fragile gesture-only or hover-only affordances when the target surface requires another accessible path.

## State, feedback, recovery and truth

Loading, empty, no-results, forbidden, conflict, offline, error, unknown, busy, disabled, selected, validation and recovery states are materially distinct when the capability exposes them.

A surface accounts for every applicable user-visible state and transition rather than implementing only the happy path. Missing applicable states are incomplete implementation, not future polish.

UI never claims success, eligibility, health, money or completion before canonical readback proves it. Material mutations expose busy/duplicate-prevention behavior, failure/recovery and post-action canonical readback as applicable.

Feedback must make consequence and next action clear without leaking raw internal identifiers, concurrency versions, backend enum vocabulary or transport representations into normal user-facing content.

## Arabic, RTL and localization

Arabic/RTL is an end-to-end interaction invariant, not a `textAlign: right` treatment.

As applicable, prove:

- layout/order and reading order;
- text alignment and Arabic shaping;
- direction-sensitive icons, back/forward semantics and navigation transitions;
- scrolling and carousel direction;
- forms, keyboard behavior and focus movement;
- mixed-direction phone numbers, quantities, codes and machine-shaped values;
- headers, tabs, lists, sheets and dialogs;
- gesture/animation direction when it communicates navigation or hierarchy.

Partner, Captain and Field mobile surfaces use the current Arabic-only RTL baseline unless a later explicit Product decision changes it. Control Panel is Arabic/RTL-first. Do not infer or prebuild runtime language switching without current Product need.

Directionality is a shared semantic foundation; apps do not invent competing RTL/LTR systems.

## Accessibility

- Web accessibility targets WCAG 2.2 AA where applicable; web interaction semantics use current WAI/ARIA guidance when relevant.
- Mobile uses equivalent platform semantics, scalable text, accessible names, focus/reading order, contrast and touch-target behavior.
- Important state and action meaning is not conveyed through color, position or animation alone.
- Long Arabic text, large text and constrained layouts must preserve required meaning and reachable actions.
- Reduced-motion behavior is respected when motion is material to the affected surface.
- Accessibility is designed and tested with the interaction, not added after visual completion.

## Evidence

A material user-facing change proves, as applicable:

```text
PRODUCT SEMANTICS
→ INFORMATION ARCHITECTURE / CONTENT
→ SHELL / NAVIGATION
→ INTERACTION MODEL
→ APPLICABLE USER-VISIBLE STATES
→ DESIGN-SYSTEM ROLES
→ PLATFORM CONVENTIONS
→ ACCESSIBILITY / RTL / TEXT SCALING
→ RESPONSIVE / ADAPTIVE BEHAVIOR
→ LIGHT / DARK + MATERIAL STATES
→ ERROR / OFFLINE / RECOVERY
→ RENDERED + INTERACTION EVIDENCE
→ CANONICAL OUTCOME READBACK
```

Rendered claims require interaction/accessibility/device/runtime evidence appropriate to the affected surface. A screenshot alone is not cross-surface or end-to-end proof. Static type/source checks do not override a visibly, structurally or interactively defective surface.

Visual regression can prove stability of a rendered contract when that contract is mature and materially valuable, but it does not replace behavioral, accessibility, RTL or canonical-readback proof.

Use `docs/reference/experience.md` for current external Experience/Design evidence. External references may challenge and improve BThwani interaction and platform fit; they never become BThwani Product, information-architecture or design authority by existence.
