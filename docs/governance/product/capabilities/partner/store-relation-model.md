# Store Relation Model

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/partner/store-relation-model.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: STORE_RELATION_MODEL

## Outcome

A Partner may own multiple Stores. Each Store retains one canonical identity, catalog, public link, and storefront across relationship changes and has exactly one effective commercial relationship: BTHWANI_PARTNER (BThwani marketplace) or INDEPENDENT_STORE (merchant-direct web storefront). Transitioning preserves Store and catalog identifiers, merchant content, existing public links and historical Orders. The Store relationship never derives from its vertical, Store Type, category, client navigation, or query string.

## Shared Store presentation contract

A published Store has one canonical identity, catalog, media and permanent public storefront across both relationships. The full responsive web storefront is the Store's **customer-facing** public presentation for both BTHWANI_PARTNER and INDEPENDENT_STORE, once the respective web publication and legal gates are met. A marketplace-eligible Partner Store additionally has a compact Store view in the BThwani Client marketplace on mobile and web; the independent Store never gains marketplace discovery or ordering through that view. The two compositions may differ in navigation and content but never create parallel Store writers, prices, inventory or permissions.

For any public Store checkout, DSH derives the effective commercial relationship and the eligible Order route from current owner-backed Store and publication facts at server confirmation. A website path, query parameter, client theme or entry channel cannot choose Direct versus Marketplace settlement. Public site address/DNS, hosting terms and payment enablement remain separately gated decisions, not effects of this presentation contract.

### Approved Client Web storefront composition

- The full public Store website is a **web-only Store-scoped composition of the existing Client Expo Web application**, reusing its already owned design system, Store product cards, catalog/search interactions and customer-safe DSH readers where appropriate. It is **not** a new Expo application, a separate storefront product, another Store database, or a cloned Client application. Exact repository paths and deployment details are implementation truth, not durable governance.
- The Client Expo mobile apps and the Client marketplace web experience remain BThwani marketplace experiences. The public Store website is a separate **route and presentation mode inside Client Web**: it opens directly to one Store, may provide more Store-specific content than the compact marketplace view, and must not require a Client marketplace login merely to read approved public content. Web-only means no independent-store marketplace screen in the native Client application; a responsive public website may still be opened from a phone's browser.
- The website uses the **same canonical Store and StoreOffer/Product/Variant/catalog/media/availability facts** that power eligible Client marketplace views. Reuse proven UI components and styling rather than copying the catalog, pricing, search, Store detail or product presentation into a second application. Additional web detail may include Store cover/profile, Store-local sections, longer descriptions, product options, approved contact channels, policies and merchant-provided presentation. It may not expose private Store-owner, customer, joining-case or internal media data.
- Store-specific styling, links and presentation settings, where admitted, remain derived from authorized Store-owned content. They do not change Store identity, catalog values, relation model, marketplace entitlement, public publication eligibility or financial authority. A separate domain is not a separate tenant or another data owner.
- The Partner mobile/web workspace and Operator workspace remain the authorized **management** surfaces. A separate owner-only Store website preview is **not** admitted. The Store owner edits and reviews private draft data in the authorized Partner management forms, while the **same public Store URL** displays only DSH-approved, published facts for both visitors and owners. Draft policy editing remains in Partner management and never alters public visibility until reviewed and published. Do not host a second customer-facing site inside the Partner administrative shell.

### One mutation, consistent eligible reads

- An authorized Partner or Operator changes a Store, catalog item, offer price, availability, image or approved presentation through its canonical DSH owner and policy workflow, never separately per Client mobile, Client web and Store website. All eligible public channels read the resulting **same committed and publishable fact**. An independent Store's eligible public changes appear on its own website but never cause it to enter the marketplace.
- Channel-specific publication/visibility rules may legitimately show different **subsets** of that common data. Private drafts, withdrawn offers, unpublished media, restricted contact details and unapproved changes must not appear in any public channel, regardless of what another private preview displays.
- The web and mobile read models must revalidate or refresh stale content after applicable changes; invalidation/retry, withdrawn-publication handling, Store and city scoping, and cache isolation are required. This is an expected convergence and security contract, **not** a guarantee of instantaneous push updates on every device. Checkout must independently recheck authoritative publication, relation, offer, price, quantity and availability at confirmation rather than trusting an earlier displayed value.
- Changing the URL, route, website styling, browser platform or client credentials does not choose order semantics. For BTHWANI_PARTNER, any permitted purchase follows the admitted marketplace checkout route. For INDEPENDENT_STORE, public direct checkout is a distinct separately gated DSH flow; it must not silently reuse marketplace cart, delivery, Client membership, WLT wallet or Captain entitlements. A storefront may remain read-only while its own checkout gates are incomplete.
- Existing Store public links must be preserved through approved presentation migration and relation changes, with safe verified redirects for public GET requests where necessary. Do not auto-redirect private data, checkout mutations or Orders. Remove superseded public page compositions only after verified consumer/link cutover, negative authorization tests and marketplace/mobile/web regressions.

**Acceptance boundary:** The architecture above is the approved target, not evidence that the current code, public hosting, publication approval or checkout has shipped. Verify representative published Partner and independent Stores, draft/withdrawal isolation, Store/City/actor switching, shared product/price visibility, responsive RTL/theming, guest entry, stable links and allowed versus forbidden checkout behavior against their actual owner-backed runtime before declaring the transition complete.

## Ownership and relation semantics

DSH owns the Store relationship, ownership, effective history, channel publication, and Order routing. Identity owns the Partner actor/session; a new Store relationship never creates a new Identity role. WLT owns marketplace agreements, commissions, and any later admitted paid hosting invoice; Store-independent hosting plans never redefine the historical WLT Store COMMISSION/SUBSCRIPTION agreement. Applications present derived capabilities but never select financial terms or grant rights.

The differences between BTHWANI_PARTNER and INDEPENDENT_STORE must be expressed by Store-scoped policies, eligibility, publication gates, fulfillment rules and versioned contracts **within the existing canonical engines**. Both relationships use the same DSH Store identity, catalog, Offer/price/availability ownership and Order engine, the same Identity actor authority, and WLT as the sole financial owner for any applicable financial effects. Separate web composition or a lawful direct-Order route may differ in user experience and guarded transaction rules; neither authorizes a second Store table, duplicated catalog or pricing source, parallel checkout engine, independent finance ledger, or shadow synchronization. The mandatory ban and narrowly evidenced distinct-responsibility exception are owned by `docs/governance/architecture.md`.

The currently admitted marketplace model continues to own all existing Stores. Existing Store rows remain BTHWANI_PARTNER after schema adoption; a database default is not an active agreement, a new Partner approval, or publication permission.

## Publication and rollout boundary

- Marketplace publication requires the existing DSH/Identity/WLT Store-specific gates. An INDEPENDENT_STORE cannot be published or discovered through marketplace APIs, even if a caller spoofs request parameters.
- An independent Store's own web publication and direct Orders require a separately validated DSH-owned path, abuse/legal checks, and distinct Order semantics. They are NOT activated by the initial relation-model schema change.
- Independent storefront pages, slugs, catalog, media, banners and identity are the same Store resources as marketplace pages, with channel-specific navigation and checkout responsibility. No second Store, duplicate catalog, parallel merchant role or shadow financial ledger is admitted.
- No Store may accept new independent and marketplace Orders simultaneously under this initial relation model. The cutover must recheck Store relation at checkout, retain prior Order snapshots and financial duties, and prevent duplicate or retroactive charges.
- A self-service independent Store may begin on a bounded free plan once its hosting and publication safety gates exist; paid tiers and zero-commission marketplace promotions are separately governed and cannot activate via client UI switches.
- A Store's permanent public link must remain available across a legal model change. Route changes use verified safe redirects for public GETs, not redirects of checkout or Order mutations.
- Market publication and independent web publication are distinct facts; no existing Store publication flag may be reused to grant independent public visibility without an explicit owner-backed admission.

## Delivery boundary

This capability is admitted for development. The first technical slice records a fail-closed Store relationship and marketplace publication gate. The next slice permits a verified Partner to choose BTHWANI_PARTNER or INDEPENDENT_STORE when creating their first **unpublished** canonical Store. Older clients default to BTHWANI_PARTNER, preserving deterministic Store IDs and replay. INDEPENDENT_STORE creation must reject BThwani Captain fulfillment. Neither model selection nor Store creation enables independent public web publication, direct Orders, hosting payment, or model conversion. These require separately admitted owner-backed approval, publication, financial and checkout checks with end-to-end proof.
