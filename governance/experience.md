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
