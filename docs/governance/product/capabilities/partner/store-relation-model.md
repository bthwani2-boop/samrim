# Store Relation Model

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/partner/store-relation-model.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: STORE_RELATION_MODEL

## Outcome

A Partner may own multiple Stores. Each Store retains one canonical identity, catalog, public link, and storefront across relationship changes and has exactly one effective commercial relationship: BTHWANI_PARTNER (BThwani marketplace) or INDEPENDENT_STORE (merchant-direct web storefront). Transitioning preserves Store and catalog identifiers, merchant content, existing public links and historical Orders. The Store relationship never derives from its vertical, Store Type, category, client navigation, or query string.

## Ownership and relation semantics

DSH owns the Store relationship, ownership, effective history, channel publication, and Order routing. Identity owns the Partner actor/session; a new Store relationship never creates a new Identity role. WLT owns marketplace agreements, commissions, and any later admitted paid hosting invoice; Store-independent hosting plans never redefine the historical WLT Store COMMISSION/SUBSCRIPTION agreement. Applications present derived capabilities but never select financial terms or grant rights.

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

This capability is admitted for development. The first technical slice only records a fail-closed Store relationship: it does not activate INDEPENDENT_STORE creation, public web publication, direct Orders, hosting payment, or model conversion. Subsequent slices must add versioned transitions, authorized acceptance, publication and checkout gates with end-to-end proof before exposing the relationship as a user choice.
