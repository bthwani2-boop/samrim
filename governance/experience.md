# BThwani — Unified Visual and Interaction Experience

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/experience.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Surface and design foundation
Customer, Merchant and Captain are **Expo/React Native** surfaces with **Tamagui as the primary established cross-platform component foundation**; reuse the existing `packages/tamagui-config` and `packages/design-system` responsibilities after a semantic audit, not a wholesale copy of old components or creation of another theme engine.

The Operator Control Panel currently uses Next.js with Ant Design and its approved server-side access/SSR/CSP requirements. It need not be migrated to Tamagui merely for uniform names. Brand colors, semantic tokens, typography, motion intent and light/dark behavior have one approved source; Tamagui and Ant Design integrate as renderer-specific consumers, not competing authoring authorities.

## Arabic, readability and accessible behavior
- Arabic is the first-class product language, with genuine RTL layout, appropriate left/right navigation, numeric/date/currency formatting for Yemen and real Arabic copy; no mirrored financial meanings or corrupted Unicode/Mojibake.
- Provide both dark and light themes; one canonical token intent, tested contrast, focus styles, hit targets, loading/failure/empty states and reduced-motion behavior. Do not claim 'pixel-perfect' from source lint alone.
- Minimize taps and mandatory fields for first Store registration, catalogue entry, checkout, Captain assignment and support recovery. Progressive disclosure is preferable to forcing Operators/Merchants through every possible financial option at once.
- Correctly scope mobile safe areas, keyboard behavior, gestures and deep links across Web/Android; iOS behavior needs actual iOS proof before a PASS.

## Operator Policies experience
The single Operator Policies workspace is a coherent management surface for DSH and WLT **owner-backed** settings. For each editable policy show in understandable Arabic:
1. Exact scope (global, Store relation, service city, Store exception when authorized), current effective value and source.
2. Whether the selected choice is **available, disabled until readiness, pending legal acceptance or not applicable**, with a concrete reason.
3. What prospective Store/Order population the change affects, new effective date, version and actor audit; never pretend historical Orders were recalculated.
4. The smallest required controls, explicit save intent, validation/failure feedback, read-only recovery when the commit outcome is uncertain and last confirmed owner readback.

Do not build duplicate policy editors on Store profile, Finance and Settings pages. Other screens may link into the one Policies editor or display an authorized read-only projection. A policy's UI preview, theme variant or cached list is **not** an authoritative policy engine or financial decision.

## Merchant and Store presentation
Merchant is the human actor managing multiple DSH Stores. A Store's relation `MARKETPLACE`/`DIRECT` affects eligible channel and public presentation, not a separate Store navigation/brand/catalogue. The **same Customer Expo Web application** hosts the full public Store page for either eligible relation; marketplace has additional compact discovery/view. A Store link must remain stable and privacy-safe across governed relation transitions.

The Store onboarding journey asks the merchant to pick the relation first, presents actual available fulfillment and fee/collection terms from DSH/WLT and requests only necessary consent. Defaults are suggestions for future agreements, not hidden automatic subscription charges. Business content and pricing do not come from the client theme.

## One Studio, one publication authority
Operator design authoring, banners, content layout, media transformations and publish/review flows must route through existing legally owned content/media/publication owners and one approved Studio workflow if admitted. A design editor is not an alternate marketplace publisher, Offer writer or price engine; approvals remain meaningful even when assets change. Preserve actual live brand/logo/reference links and media rights without assuming archived design screenshots are current truth.

## Evidence
For meaningful changes test real rendered Arabic/RTL, light/dark, keyboard/touch/focus, viewport sizes, empty/error/retry, screen reader labels, Store-scoped content, deep links, session switches and representative genuine browser/Android journeys. Ant Design and Tamagui may differ in components while preserving one semantic outcome. Design lint and visual snapshots supplement functional evidence; they do not prove authorization, orders, settlement or iOS.

## Approved brand and Operator information architecture retained

The present approved compiled-default brand anchor values are navy `#102B4E`, orange `#F36B21`, white `#FFFFFF`, turquoise `#83DDF3` and burgundy `#7B1E3A`. They are **semantic reference anchors**, not a duplicate set of component token variables. The existing executable Design System derives accessible light/dark roles. White text on vivid `#F36B21` is not automatically adequate for normal-sized action labels; a contrast-valid role is required. A later authorized Studio may publish validated semantic theme overrides without mutating commerce, identity or WLT. Invalid/incompatible theme publication falls back to compiled defaults; no arbitrary CSS/JS authority.

The Operator workspace's admitted navigation groups are **Home; Operations; Stores; Catalog; Marketing & Design; Finance; Administration & Employees; Policies**. These are navigation groupings, not services. Keep one Stores management center for both relations, one Catalog center for shared product identities, one authorized Studio authoring entry under Marketing & Design and one policy management UX. Store-scoped agreements remain readback from WLT; bulk financial operations and policy changes must not become unrelated shadow screens.

An app's shell and information architecture should derive from that actor's actually admitted tasks before styling isolated screens. Dense Operator tables require server-owned pagination/filtering when large; compact navigation cannot hide authorized actions or keyboard focus. Merchant Store quick-entry and quick prices must avoid repeatedly asking for saved information or requiring unrelated catalog/financial setup at first registration. Protected screenshots, operator design previews and local drafts are not proof of published business content.

## Accessible and efficient Operator work at scale — retained acceptance detail

The approved Web accessibility target is **WCAG 2.2 AA where applicable**, with current WAI-ARIA interaction semantics; Mobile uses equivalent platform accessibility conventions. Verify keyboard-only reachability, logical focus/reading order and focus visibility after a dialog/sheet, long Arabic text and font scaling, screen-reader action and state labels, non-obscured focus/touch targets, correct RTL navigation/icons/gesture direction, meaningful color contrast and reduced-motion behavior. Material action, error, pending and urgency meanings cannot depend on color or animation alone. Real rendered Web and applicable Android/iOS interaction is required; CI lint, a screenshot or mocked Owner responses do not prove accessibility.

A scalable Operator resource registry defaults to **owner-side search/filter/sort/total/count and bounded paging** when the authoritative result may grow. Do not sort a currently loaded page and label it as the full query; do not turn a decorative dashboard into an unbounded financial or Order registry. A priority queue, true hierarchy, activity feed, focused inspector or compact image gallery is used instead of a table only where that shape fits the **real job and canonical resource**. A matching count/drilldown must use consistent scope, time window, permission and data source. The Operator dashboard must link actionable anomalies to the exact authorized canonical work view.

For repeated work, preserve meaningful non-sensitive **filter, sort, page/position, active resource, selected row, scroll/focus and safe draft context** across back/forward, reload, detail inspection and recoverable conflicts when feasible. A Store or account switch invalidates cached sensitive records; neither Customer phone, private Order address, bearer token nor provider-secret appears in a shareable URL, logs or broad query. Saved views, user-customizable columns, command palette, favorites and global search are **optional candidates**, not automatically admitted modules; demonstrate repeated-job benefit and correct owner-scoped query semantics first. Page-local selection versus all-results selection and bulk actions must be visibly distinguished and reauthorized at commit.

Show a clear primary action and separate contextual action; minimal mandatory fields, reachable failure/empty/loading/forbidden/conflict and confirmation states. Retain one full route for complex forms but use bounded inline/side-panel inspection for common record comparisons where beneficial; preserve dirty-form/selected-record context safely. Shell compacting, density, focus and mobile adaptation must not hide permitted destinations. A category grid or Store catalog gallery reads the **same canonical query** as the default resource table, never an alternate Product/Offer database.

## Visual hierarchy and brand restraint

Semantic typography prioritizes Arabic shaping, mixed numeric/currency direction and reliable readability with text scaling. No particular custom font is adopted solely by its appearance; any new font needs verified licensing and Web/Android/iOS shaping. Exact sizes/weights are design-system concerns. Related controls use one cohesive radius/spacing family, restrained surfaces and meaningful hierarchy; wide data workspaces may use available width while prose/forms retain readable lines. Compact and comfortable density preserve the **same** accessible capabilities, not independent screens.

Iconography uses a consistent semantic family and properly mirrored direction-sensitive back/forward symbols. Cards group one responsibility and are **not** the default primitive for large comparison tables; ornamental gradients, excessive shadows, motion or enlarged empty containers cannot obscure states or slow operations. Store/customer brand imagery and historical benchmark assets need source/licensing approval; copying competitor design is never automatic. All light/dark changes and Studio publications retain one approved brand-token source and contrast-valid semantic action colors.
