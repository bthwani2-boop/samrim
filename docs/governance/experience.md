# Experience and Design

ARTIFACT_CLASS: DURABLE_GOVERNANCE
SEMANTIC_OWNER: docs/governance/experience.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Experience and Interaction Policy

UX communicates canonical Product state, authority, available actions, feedback and recovery. User-facing experience is part of functional correctness, not end-stage polish.

This policy owns durable information-architecture, navigation, interaction, RTL/localization, accessibility, state/recovery and platform-adaptation invariants. Durable visual identity and design language are owned by `docs/governance/experience.md`.

### BThwani experience contract

BThwani maintains one recognizable cross-surface experience system with platform-native behavior. Unified identity does not mean identical information architecture, identical shells or pixel-identical UI across the four deployable surfaces: Client, Partner, Captain and Control Panel. No acquisition-agent surface or reward workflow is part of the target Product.

The durable BThwani experience must remain:

- Arabic-first and RTL-first for the currently admitted Arabic surfaces;
- fast to understand, clear, trustworthy, warm, modern and uncluttered;
- consistent in semantic hierarchy, feedback, state meaning and recovery where the same semantics apply;
- adapted to the actor's real job rather than forcing every app into one navigation model;
- adaptive to platform/device/window/input conventions rather than forcing one layout model everywhere.

Visual identity, color, typography, shape, iconography, imagery, elevation and motion language are governed by `docs/governance/experience.md` and implemented through the canonical reusable Design System where reuse is proven.

### Store interface presentation — one Client application

There is one customer-facing Client Expo application, with native mobile marketplace and Expo Web marketplace. The **same Store presentation components** support a compact Store view for eligible BTHWANI_PARTNER marketplace discovery on Android/iOS and Client Web, and a **full Store view opened via the Store's direct URL within the same Client Expo Web application** for either eligible published relation. This full view is not a new website product, Expo application, Store instance, database, checkout engine or Partner administration shell. The independent Store is not listed in the marketplace. Both views derive published Store content, offers, price and stock from canonical DSH; DSH/WLT/Identity enforce relation, publication, checkout eligibility and financing server-side independently of appearance or route.

Arabic Store forms call `relationModel` «طريقة عمل المتجر» (شريك بثواني / متجر مستقل), `commercialStoreTypeId` «نوع المتجر» (such as بقالة / صيدلية) and `primaryVerticalId` «المجال التجاري». UI labels do not create extra models or alter canonical IDs. Presentation differences use a bounded mode, not a separately managed application or unlimited design-policy switches.

### Effort-minimal experience at operational scale

**No avoidable technical or user-experience complexity.** Across Customer, Partner, Captain and Operator work, the default is the shortest clear, safe, recoverable path to the actor's real outcome. Thousands of Stores, products, records or daily actions must not turn routine work into repeated forms, navigation or technical troubleshooting. Simplicity means removing unnecessary work, not concealing missing functionality or weakening canonical controls.

- **Use plain Store labels.** Arabic Store onboarding and management call the DSH `relationModel` choice «طريقة عمل المتجر» (شريك بثواني or متجر مستقل) and the `commercialStoreTypeId` classification «نوع النشاط» (such as بقالة or صيدلية). The parent `primaryVerticalId` remains «المجال التجاري». These three distinct facts must never be conflated or represented by additional Store models, writers or required inputs.
- **Ask only for what is needed now.** Collect the minimum facts required for the current authorized transition; defer unrelated catalog, publication or operational setup to its actual owner and stage. An optional field or attachment never silently blocks progress. Use progressive disclosure instead of showing every future decision at intake.
- **Enter a fact once.** Reuse canonical verified facts and appropriate safe defaults; do not make actors re-enter saved data, repeat uploads or re-confirm the same unchanged decision. Allow short drafts, continuation and recovery from interrupted work without duplicate records or silent overwrites. Never prefill fabricated identities or unverified facts.
- **Keep the next action obvious.** Give each task a clear primary action, understandable requirements and immediate actionable feedback. Validate early where useful; preserve entered work and provide a straightforward retry or correction when a dependency fails. Hide technical versions, transport tokens and implementation vocabulary from normal workflows.
- **Support repeated work efficiently.** For materially growing collections, use the appropriate server-owned search, filtering, bounded results and compact in-context actions. Offer scanning, import, batch operations or keyboard-friendly editing only when they materially reduce real work, with explicit scope, permissions and per-record outcome when applicable; never manufacture bulk complexity for a small task.
- **Make complexity earn its place.** An added screen, approval, mandatory field, confirmation, service, state or abstraction requires a present, provable user, business, legal or safety need that a simpler existing path cannot satisfy. Remove obsolete paths after safe cutover; keep essential authorization, privacy, integrity, audit, financial and recovery guarantees enforced behind the experience.
- **Prove simplicity with real actors.** Verify the repeated end-to-end job (entry, save, submit, review, correction and next-owner readback as applicable) on representative data and actual interaction. When claiming a workflow is faster or simpler, compare meaningful steps, re-entry, failure/retry burden or task time against its previous behavior rather than relying only on screen count or appearance.

### Information architecture and application shell

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
- On data-dense desktop workspaces, a user-selectable compact navigation treatment may reclaim space for the current job. It must preserve every authorized destination, understandable names on focus and pointer interaction, keyboard access, selection/context, and a recoverable expanded view; reducing chrome never justifies hiding a real workflow. Smaller screens retain platform-fit navigation.

The Operator workspace presents **eight primary navigation groups**, subject to actual permission: Home; Operations; Stores; Catalog; Marketing & Design; Finance; Administration & Employees; Policies. Identity permissions and HR records are accessed under the Administration group through their own canonical owners; one Design Studio authoring entry is located in Marketing & Design. These are navigation groups, not service boundaries or eight competing registries. Design Studio is one authorized authoring workflow for platform presentation and Store-full-web templates, not a separate persistence, marketing or configuration owner. Its local-only drafts do not publish, and live publication must pass the canonical server owner and Identity permissions. Notifications, personal profile, appearance, session and security utilities belong to the shell instead of creating parallel work centers. Each center has one canonical primary work surface; only a materially distinct entity lifecycle, separate authorization or substantial batch workflow justifies a secondary destination. A state filter or routine action alone does not justify a new page or navigation tab. Stores and Catalog are distinct centers: Store lifecycle, owners, staff, relation, readiness, serviceability and Store-specific agreements are different work from central Product identities, categories, proposals and imports. The **one Stores management center** serves BTHWANI_PARTNER and INDEPENDENT_STORE through the same canonical DSH Store registry and record, with a server-driven relation filter and scoped actions. A relation filter does not create a second Store registry, onboarding writer, Product engine, Identity role or private Customer list; marketplace/direct eligibility stays DSH-controlled. Store-specific financial agreement details come from WLT readback, not a separate Operations financial writer. The merchant controls its own Store identity, catalog, and eligible merchant-authored content within Store-scoped authorization; private direct-order Customers will only be available through a separately admitted owner-scoped Direct Order path, never by reusing marketplace Customer lists or revealing PII from the Operator registry. The Catalog center owns operator-facing management of the shared catalog, including its categories, structured data definitions and import/review workflows. Quick Prices uses a fast operational grid on desktop and compact sequential price entry on mobile. In Arabic operator-facing central catalog experiences, use the term “الفئات” for this taxonomy, including its top-level and nested levels. Policies is the operator-facing home for cross-capability shared platform rules, including service geography and delivery fees; it does not own catalog taxonomy or product data definitions. Before and after Go-Live, the Partner workspace owns Store-local catalog preparation, product content, pricing and menu organization. Only authorized Merchant self-service or Operator Store commands write Store catalog facts. Finance provides operational Partner and Captain settlements. Binding historical financial obligations remain available for authorized WLT readback/reconciliation but never reappear as current acquisition or reward navigation. For each Store, Finance sees the proposed agreement, Partner acceptance, Finance approval and active version as explicit states; if a Store Type rate is shown, it is visibly a suggestion and cannot appear as active terms. Partner and Captain official-wallet intake may select a provider preference only; where available, the Identity-derived phone and official name are read-only, and stale Identity facts require reverification. Its growing payout and evidence resources use server-driven registries with server-owned search, filters, sorting, bounded paging, selection/actions where justified, and on-demand relationship details. Customer balance withdrawals remain a separately authorized exception queue: Operations records the request, Finance approves and executes it, and an independent operator reconciles it. Funding, COD remittance, beneficiary payouts and customer withdrawal exceptions remain distinct work queues because they have different sources, authority and state transitions. These centers organize administration and do not reassign canonical capability meaning, data or write ownership. A center is an information-architecture responsibility, not a new service or semantic owner.

#### Merchant management experience — one Expo app on mobile and web

The Partner/Merchant application serves authorized Stores of **either relation** through one canonical DSH/Identity/WLT capability and permission model. Its mobile and web information architecture starts with the Merchant's actual work: Store identity/status and required next action; Orders; catalog/price/stock; Store profile and operating modes; staff/affiliated Captains; commercial agreement and financial readback; reports; promotions, media/short videos and notifications; and **Design My Store** limited to the eligible full public Store web presentation. Present only implemented actions permitted by the current Store, actor and owner-backed eligibility, but never silently hide an admitted Store or imply that an unavailable action has completed.

One canonical eligibility/readback decision must drive navigation links, Store selectors, disabled/unavailable states and server mutation; separate web/mobile menu arrays are presentations, not independent commerce policy. A Merchant with several Stores can always identify the active Store, see which relation and publication/orderability gates apply and change Store safely without stale results, cached private records or pending responses from a previous actor/Store. Orders for a relation whose checkout has **not been released** may show a truthful unavailable or read-only state, not a forged empty Order list or an unrestricted action. Financial agreement display reads WLT's exact accepted/active version and charges for that Store; UI labels are not sources of terms.

On mobile, favor short actionable cards and minimal forms. On web, favor bounded server-filtered lists, keyboard/RTL and efficient bulk edit where appropriate, while reusing the same Store commands and validation. Preserve quick price editing, import/export, media and short-video lifecycle, Store staff/affiliated Captain delegation, reports, public links and recovery when refounding layouts. Check empty/loading/error states, offline retries, actor switch, multi-Store cross-access denial and actual browser/Android/iOS interaction as available. No second Merchant web backend, parallel Catalog/Order engine, cloned Design Studio or implicit marketplace privilege follows a different layout.

#### Operator Policies work center: one composition, canonical owners

The Operator Policies work center is one searchable, role-aware **administrative composition**, not another rule engine, policy database or blanket approval authority. Present the admitted settings grouped by the job: Store admission/publication; commercial terms and subscription plans; delivery/Captain coverage; Orders; payment/collection/refunds; promotions; coverage/operation; privacy/safety; feature admission; and change history. Groups are presentation, not separate services or justification to add speculative switches.

Each editable setting identifies its canonical owner, current effective value and scope, authorized editor/approver, source and version, supported options and constraints, effective-from behavior, and whether it changes only future Stores/Orders/agreements or an existing eligible state. Show policy-driven consequences **from owner-backed data**, not client guesses. A proposed change with absent backend support is labeled unavailable and cannot be saved as if active. Reuse the existing Policies workspace and canonical owner APIs. Changes must validate authority, dependencies and conflict/stale versions, include proportionate review/audit and safe retry/readback, and never silently rewrite historical agreements, permit unsafe collection, grant Identity rights or publish ineligible Stores. Offer an approved-default reset where the owning policy supports it, without deleting audit history.

#### Operator operations-at-scale contract

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

For repeated operator decisions, a row or equivalent record summary makes its authorized, decision-relevant identity, relationships, contact or location when needed, classification, distinct state dimensions, and available safe actions discoverable without serially opening unrelated pages. Do not overload every row with every field or hide decisive facts behind filters that merely select records. Compact icons may conserve space, but their action and status meaning must remain distinguishable without color, hover or prior memorization. The canonical owner supplies enough bounded summary data for the chosen task; rendering cannot invent or silently infer missing facts.

Collection state that materially affects repeated work must survive the interaction path by an appropriate mechanism. Filters, sort, page/position, visible columns, density or another relevant view preference may be persisted or made shareable when doing so materially reduces repeated setup. URL persistence is appropriate only for nonsensitive state with an unambiguous owning collection; sensitive values do not enter URLs merely for convenience. Repeated operational query configurations may become saved views when their recurrence and value are proven rather than speculatively prebuilt.

Selection scope is explicit. Page-local selection, loaded-result selection and an action over all canonical records matching a query are materially different states and must never be represented as interchangeable. A bulk action states the affected scope and consequence before execution and exposes busy/progress, partial failure or recovery, and final canonical outcome when those states are materially possible. Large or long-running multi-record execution semantics are owned by `docs/governance/safety.md`; presentation must not simulate a client-side loop as atomic platform success.

Detail presentation preserves collection context when operators repeatedly inspect or compare multiple records. A split panel, drawer, expandable detail or equivalent in-context presentation is appropriate only when that workflow is materially faster and clearer than repeated route changes. Complex editing, investigation or multi-step work uses a focused detail/workflow surface when a persistent side panel would constrain the task or duplicate the canonical object workspace.

An operational file, draft or case leads with recognizable identity, independently meaningful states, outstanding requirements, the next authorized action and direct relationships; supporting facts, evidence, history and rare administration follow in coherent sections. Routine review must not become a flat field dump or require repetitive route changes. Preserve list position, applied query, selection and unfinished edits when entering, leaving or switching detail as the workflow requires. Place frequent safe actions in context and disclose infrequent or high-risk actions deliberately, with the owner enforcing authorization, prerequisites, versioning and audit.

Concurrent or stale state never ends in silent overwrite or fake success. When a material conflict is detected, the experience makes the conflict understandable and provides a safe path to refresh, compare, retry or abandon before canonical readback. The UI does not expose transport concurrency tokens or backend implementation vocabulary as the normal explanation.

Routine reading and successful actions should converge automatically to the latest authorized canonical state, using the least costly mechanism appropriate to change rate, consequence and active visibility. Returning to a workspace, changed filters or completed mutations must not routinely require a manual refresh button. Deduplicate and bound refresh work, cancel obsolete reads, avoid unneeded polling and keep visible context and unsaved drafts stable. When automatic recovery fails, expose a clear exception-scoped retry and an honest stale/unknown state rather than silently showing old data as current. Automatic reading is not automatic mutation, approval or destructive action.

Tabular information uses native semantic table structure where possible. Adopt an interactive grid/spreadsheet interaction model only when cell navigation, editing, row/cell selection, copy/paste or similarly dense keyboard interaction is a material job; that choice carries the corresponding managed-focus and keyboard obligations. Visual resemblance to a spreadsheet alone is not sufficient reason to introduce grid semantics.

RTL remains correct under operational density and horizontal overflow. Logical start/end semantics, reading and focus order, sort/filter affordances, identifiers, phone numbers, dates, quantities and mixed Arabic/Latin values must remain understandable and copyable. Wide data surfaces may scroll when necessary, but orientation, record identity, materially required actions and accessible navigation must not become ambiguous.

Presentation patterns never reassign the underlying capability owner, writer, authorization boundary or canonical readback. Do not create duplicate list/detail routes, permanent side-by-side edit forms, client-filtered server-paginated truth or parallel presentation models that become shadow operational truth.

### Interaction and platform adaptation

The same BThwani semantic outcome may use platform-appropriate navigation, system controls, safe areas, gestures, keyboard/pointer behavior, dialogs/sheets, window sizes and platform chrome.

Familiar native interaction takes priority over decorative brand mimicry. Apple/Android/Web design guidance challenges interaction and platform fit; none of those external systems defines BThwani Product truth, information architecture or brand identity.

Interaction patterns with repeated semantics should converge when real consumers prove common need, including form submission, confirmation, destructive actions, search/filter, loading, retry, offline handling, authentication, checkout, order state and operational accept/reject flows.

Touch targets, focus order, keyboard reachability, gesture behavior and safe-area handling must remain usable under the actual platform/input model. Do not hide essential actions behind fragile gesture-only or hover-only affordances when the target surface requires another accessible path.

When image inspection is part of an authorized task, a small thumbnail or logo provides a usable full-image review on demand. Equivalent image-review needs reuse a coherent, keyboard-accessible treatment with contain-fit, dismiss/return focus, load-error recovery and correct privacy/permission boundaries. Case-only evidence or restricted media never becomes publicly available merely because the UI reuses a viewer.

### State, feedback, recovery and truth

Loading, empty, no-results, forbidden, conflict, offline, error, unknown, busy, disabled, selected, validation and recovery states are materially distinct when the capability exposes them.

A surface accounts for every applicable user-visible state and transition rather than implementing only the happy path. Missing applicable states are incomplete implementation, not future polish.

UI never claims success, eligibility, health, money or completion before canonical readback proves it. Material mutations expose busy/duplicate-prevention behavior, failure/recovery and post-action canonical readback as applicable.

Feedback must make consequence and next action clear without leaking raw internal identifiers, concurrency versions, backend enum vocabulary or transport representations into normal user-facing content.

### Arabic, RTL and localization

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

Partner and Captain mobile surfaces use the current Arabic-only RTL baseline unless a later explicit Product decision changes it. Control Panel is Arabic/RTL-first. Do not infer or prebuild runtime language switching without current Product need.

Directionality is a shared semantic foundation; apps do not invent competing RTL/LTR systems.

### Accessibility

- Web accessibility targets WCAG 2.2 AA where applicable; web interaction semantics use current WAI/ARIA guidance when relevant.
- Mobile uses equivalent platform semantics, scalable text, accessible names, focus/reading order, contrast and touch-target behavior.
- Important state and action meaning is not conveyed through color, position or animation alone.
- Long Arabic text, large text and constrained layouts must preserve required meaning and reachable actions.
- Reduced-motion behavior is respected when motion is material to the affected surface.
- Accessibility is designed and tested with the interaction, not added after visual completion.

### Evidence

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

External experience/design evidence, when actually curated, is indexed through `docs/reference/README.md`; absent evidence must not be fabricated. External references may challenge and improve BThwani interaction and platform fit, but never become Product, information-architecture or design authority by mere existence.

## Design and Visual Identity Policy

This policy owns BThwani's durable cross-surface visual identity and design-language invariants. It does not own Product capabilities, information architecture, navigation, interaction/recovery behavior, accessibility policy, implementation topology, or current rendered state.

```text
docs/governance/experience.md
→ durable visual identity / design language

docs/governance/experience.md
→ information architecture / shell / navigation / interaction / RTL / accessibility / recovery

docs/governance/engineering.md
→ material review and proof obligations

EXECUTABLE DESIGN SYSTEM
→ reusable implementation of admitted visual semantics

APP SURFACES
→ app-specific composition and rendering
```

No Markdown file in an implementation repository, app-local visual foundation, donor implementation, external Design System, or rendered screenshot becomes a parallel BThwani design authority.

### Visual character

BThwani is operational, familiar, trustworthy, warm, modern and uncluttered. Visual design makes the current context, primary action, state and recovery legible before decoration.

The recognizable signature is restrained deep-navy structure with controlled orange emphasis over quiet surfaces. Brand identity must remain distinctive without overwhelming content, status meaning or platform familiarity.

### Brand anchors and color semantics

The five approved compiled-default brand anchors are:

- structural royal navy `#102B4E`;
- vivid brand orange `#F36B21`;
- pure white `#FFFFFF`;
- light turquoise blue `#83DDF3`;
- burgundy / deer-blood accent `#7B1E3A`.

The light/dark semantic palettes, warm surfaces, accessible dark-orange actions, interaction feedback and gradients are derived from these defaults by the executable Design System. White text on vivid orange `#F36B21` is not WCAG AA for normal-sized text; use a validated contrast role such as `#C2410C` for white-text primary buttons.

These anchors are durable brand decisions until an explicit brand decision changes them. Derived ramps, interaction shades, contrast adaptations, opacity, component-level colors and theme-specific values belong to the executable Design System rather than being mirrored here as a second token registry.

Orange is intentional emphasis for brand and high-priority interaction, not decorative saturation across cards or chrome. Navy provides structure and identity, not a requirement to make every surface dark. Success, warning, danger and informational states use semantic state meaning and must not be overloaded with brand meaning.

Color alone never carries material state or action meaning.

#### Compiled defaults and governed Studio overrides

All four deployable surfaces retain these five compiled defaults, so their design does not depend on an API response, a persisted marketing configuration or connectivity. A later authorized Studio publication may replace **editable semantic presentation roles** with any validated color choices for light/dark and supported individual surfaces. Marketing and Content owns the editing entry point; its published theme state must have one lawful server owner, explicit Identity authorization, schema/version compatibility, preview separate from publication, audit, rollback, and safe restoration to compiled defaults. Per-operator appearance preference remains distinct from organization-wide published colors.

Studio publication changes presentation, not permanent code defaults or mutable Identity, commerce, dispatch or WLT financial state. New roles/colors are not published if they obscure safety or financial meaning, fail applicable WCAG 2.2 AA contrast, break a consumer, or expose arbitrary CSS/JS. A client with no valid or compatible publication must render its compiled defaults without a crash; existing installed applications only accept the supported schema. This policy approves the brand direction and safe override boundary, not evidence that runtime Studio publication is implemented.

### One Studio authoring workflow, one publication authority

The Studio offers a **bounded library of three to five accessible full-Store templates**, reusable approved sections and simple Store-scoped customization (approved palette/accent, logo/cover, banners, featured products and section order). Merchant editing follows choose → customize → preview phone/desktop → publish, always through DSH's **single** versioned draft and publisher. No arbitrary layout scripting, user-supplied executable CSS/JS or duplicate product data. The same central Studio model has separately authorized platform-wide presentation roles for Customer/Captain/Merchant apps and Operator web. A released theme/layout token may change without a new app build only if the installed consumer already supports the exact schema; new screen behavior requires a code release.

BThwani maintains **one** permission-scoped Design Studio authoring workflow, entered by authorized Operators from the Control Panel and by authorized Store owners/staff through **Design My Store** in the same Partner Expo app. The Partner entry is Store-bound: it edits only the full public Store presentation inside the existing Client Expo Web application for either approved Store relation, never the compact marketplace Store presentation, native Client marketplace, another Store or the global platform theme. The Control Panel may author only explicitly supported global/application presentation roles and templates; a UI menu item cannot grant an unimplemented publishable scope. There is no second Partner designer, custom HTML/CSS/JS builder, parallel theme registry, independent Store web app or cloned checkout.

DSH is the sole owner of supported appearance draft/publication state, effective version, Store scope, validation and readback; Identity governs who may edit or publish. A compiled design token set is a safe compatible default, not a competing runtime publisher; Tamagui/Expo and Ant Design consume derived semantic roles appropriate to their surfaces. Validate preview versus published content, accessibility/contrast, Arabic RTL, light/dark, store-owner isolation, version conflict, rollback, malformed schema, offline fallback and real rendered behavior before claiming any Studio scope finished. A merchant's chosen template neither publishes a Store nor authorizes price, offers, Orders, payments, wallet, captain dispatch or financial terms.

For material Expo UI work, assess existing Expo/React Native official platform components and packages for the **actual target platforms** before adding another icon, font, widget or adapter; prefer reusable Tamagui components where they meet the cross-platform contract. An iOS-only native control cannot silently become a web solution. Rebuild information architecture and user journeys before replacing widgets, and protect existing native media/map/conversation capabilities until their consumers and owners are cut over.

### Typography and numeric expression

Typography prioritizes Arabic readability, clear hierarchy, stable shaping, legible numerals and platform-quality rendering. Screen titles identify the current job or context; supporting text clarifies state, consequence and recovery without backend vocabulary.

No custom brand typeface is currently admitted as a durable visual-identity decision. If a custom typeface is proposed, admission requires proven Arabic shaping/RTL, weights, numerals, small-size legibility, Android/iOS/web rendering, text scaling, performance and licensing. The font mechanism currently used by any surface is implementation truth.

Exact font sizes, line heights, weights and platform mappings are executable Design System concerns unless a value itself becomes a durable brand decision.

### Spacing, density and hierarchy

Spacing establishes information groups and action priority rather than filling empty space mechanically. Density may differ by surface and input model while preserving the same hierarchy and state meaning.

Operational density means information efficiency, not visual crowding. Repeated comparison and high-volume work should expose enough identity, state and decisive comparable information to scan and act without unnecessary route changes or oversized containers. Secondary metadata and secondary actions remain visually quieter than the primary job.

Narrative, form and focused-detail content may use constrained readable widths. Operational registries, comparison surfaces and other wide data workspaces may consume materially more of the available viewport when an arbitrary global maximum width would reduce scanning, comparison or action efficiency. Exact breakpoints, dimensions and layout values remain executable Design System or app concerns rather than durable constants here.

Where multiple density modes materially improve sustained operator work, compact and comfortable treatments preserve the same semantics, reachability and accessibility rather than becoming different products. Density choice is not introduced without a real user or workflow need, and exact density tokens remain executable Design System concerns.

Important values, actions and statuses must remain readable under realistic Arabic copy, large text and constrained widths. Truncation must not hide materially required meaning.

### Shape, surfaces, elevation and depth

Shape language is cohesive and restrained. Controls, fields, cards, sheets and other surfaces use a consistent radius family through semantic Design System roles rather than local per-screen invention.

Cards contain one coherent responsibility; they are not giant click targets containing unrelated actions and are not the default layout primitive for large comparable record collections. Data-dense workspaces prefer clear alignment, spacing, borders or restrained tonal separation before decorative elevation. Borders and restrained elevation may separate work areas, but shadows do not substitute for hierarchy. Decorative gradients, excessive layering or visual effects that obscure state or delay an operational action are noncanonical.

Focus, busy, disabled, selected and error treatments should preserve understandable geometry while changing semantic treatment as appropriate.

### Iconography, imagery and media

Iconography uses a coherent family, consistent stroke/fill language and semantic meaning. Direction-sensitive symbols must remain compatible with the Arabic/RTL interaction contract owned by `docs/governance/experience.md`.

Images, illustrations and media support Product understanding or brand character; they do not fabricate Product truth or crowd out primary actions. Material visual assets require known provenance and compatible licensing. Donor or third-party assets are evidence/candidates only and are not adopted by existence.

### Motion

Motion communicates hierarchy, continuity, feedback or state change. Decorative motion that slows task completion, masks latency or competes with operational actions is noncanonical.

Exact durations, easing curves and platform implementations belong to the executable Design System. Accessibility and reduced-motion interaction behavior remain governed by `docs/governance/experience.md`.

### Light and dark appearance

Light and dark appearance preserve semantic hierarchy, action priority, state meaning and BThwani identity rather than becoming independent visual products. Theme adaptation uses semantic roles; screens do not fork business meaning or invent local theme systems.

The dark surface model may adapt navy/orange expression for contrast and legibility while preserving their brand relationship. Exact theme values remain executable Design System implementation.

### Cross-platform expression

BThwani has one recognizable visual identity, not one pixel-identical layout. Android, iOS and web may render components, chrome, density and interaction affordances differently when platform fit requires it. Platform conventions challenge implementation choices without becoming BThwani brand authority.

### Design-system boundary

The approved Expo component path is the **already present** central Tamagui configuration, consumed by Customer/Merchant/Captain Expo apps, while Operator Web uses Ant Design. Both consume **one canonical BThwani brand/semantic-token source** through derived configuration, never two manually editable competing token sets. The former shared design-system package may remain only for a traced migration of real consumers, including maps, chats, media and notifications that are not generic design primitives; transfer those responsibilities before safely retiring the superseded package. Reusing a stable platform-native component is valid when Tamagui does not meet the real platform requirement.



The reusable Design System implements domain-neutral visual semantics through the progression:

```text
BRAND / VISUAL INVARIANT
→ PRIMITIVE TOKEN
→ SEMANTIC TOKEN
→ REUSABLE PRIMITIVE / PATTERN WHEN PROVEN
→ PLATFORM-SPECIFIC RENDERING
```

A reusable token, primitive or pattern exists only when it has real current consumers and reduces whole-system inconsistency or complexity. Product/domain components begin with the consuming feature and move into the Design System only after domain-neutral multi-consumer need is proven.

No surface creates a competing foundation for color, typography, spacing, radius, elevation, iconography, motion, directionality or theme when the canonical Design System can own the same reusable meaning.

### Evidence and change control

A material visual change must distinguish:

```text
DURABLE BRAND / DESIGN DECISION
→ update this semantic owner when the durable meaning changes

EXECUTABLE TOKEN / COMPONENT TREATMENT
→ change the Design System and prove affected consumers

APP-SPECIFIC COMPOSITION
→ change the owning surface without promoting local composition into global design law
```

Rendered evidence is required for claims about actual appearance; source declarations alone do not prove visual quality. Interaction, accessibility, RTL, responsive/adaptive and state-transition proof remain governed by `docs/governance/experience.md` and `docs/governance/engineering.md`.

Donor implementations, OSS, Material, Apple guidance and other external design systems are challenge/evidence sources only. Preserve useful BThwani meaning, reject defects and obsolete architecture, and never copy external visual identity as authority.
