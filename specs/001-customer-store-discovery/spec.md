# Feature Specification: Customer Store and Catalog Discovery

**Existing Git branch**: refoundation/clean-house-20261112 (no feature branch created)
**Created**: 2026-11-14
**Status**: IMPLEMENTATION_IN_PROGRESS — owner-backed DSH/PostgreSQL, Web discovery and Samsung Android smoke PASS; full Identity/Store-orderability/security acceptance NOT_RUN; Lenovo mirror still runs old revision; production BLOCKED
**Input**: Human request to start BThwani commercial services, screens and code; governed capability CUSTOMER_STORE_CATALOG.

## Normative owner boundary

This is a non-normative, pre-implementation Spec Kit planning artifact. Business meaning remains with governance/product.md (admission), governance/stores.md (publication, MARKETPLACE/DIRECT and service city), governance/catalog.md (CUSTOMER_STORE_CATALOG and CUSTOMER_VISIBLE_OFFER), governance/commerce.md (cart/checkout eligibility), governance/identity.md (identity) and governance/experience.md (Arabic RTL and accessibility). The relevant clauses are reconciled and decided during this journey; global governance cutover is not a development prerequisite. DSH alone writes Store/publication/catalog/Offer facts; Customer composes authorized reads. WLT finances and DSH Order writes are OUT OF SCOPE for this first increment.

## User Scenarios & Testing

### User Story 1 — Browse eligible marketplace Stores (Priority P1)

A Customer sees Store cards in the selected service city, limited to DSH-approved published MARKETPLACE Stores; can open a Store to view its full public page and eligible Offers. No user login is assumed for a public listing; private data requires its own permission.

**Independent Test**: From a real DSH-backed Customer Web/Android session, seed two isolated authorized Stores through the owner service; verify published MARKETPLACE appears, unpublished/direct-only/out-of-city Stores do not leak into marketplace listings, and a published but paused/closed Store remains discoverable where permitted while clearly not orderable. Permitted full Store detail remains link-accessible.

**Acceptance Scenarios**
1. Given a published eligible MARKETPLACE Store in a supported city, when the Customer opens discovery, then only authorized public Store facts appear.
2. Given a DIRECT Store with a valid public link, when marketplace discovery is requested, then that Store is not listed merely because its public Store detail is link-accessible.
3. Given an unpublished Store, a disabled vertical or an out-of-city Store, when discovery is requested, then no private Store information is exposed.
4. Given no eligible Stores, when discovery loads, then an accessible Arabic empty state is shown without fabricated cards.

### User Story 2 — Browse eligible Offers and change filters (Priority P2)

A Customer opens an eligible Store and browses available Offers and simple admitted filters with bounded, deterministic pagination. Prices and availability come from current DSH readback.

**Independent Test**: A real owner-backed Store with multiple Offers exercises mixed variants, pagination tie order, filters, unavailable and unpublished Offers.

**Acceptance Scenarios**
1. Given a Store with active published sellable Variants and positive exact YER prices, when the Customer requests eligible Offers, then only approved public Offers appear with authoritative prices.
2. Given stale pagination or a changed Offer version, when the next page is requested, then the owner rejects/reconciles the cursor safely rather than mixing old Store results.
3. Given a removed/unpublished/unavailable Offer, when deep-linked or paginated, then public access fails closed without revealing restricted attributes.
4. Given a slow or unavailable DSH response, the UI displays loading/error/retry and does not imply the data was confirmed.

### User Story 3 — Recover safely after context changes (Priority P3)

A Customer changes city or navigates between Stores without seeing stale Store details or a stale price mistaken for checkout eligibility.

**Independent Test**: Delay an actual DSH read, change city/Store, then resolve the older response and verify that the visible context remains the newly selected one.

**Acceptance Scenarios**
1. Given an older in-flight Store request, when city or Store context switches, then its late result must not populate the new context.
2. Given an Offer price/stock change while browsing, when attempting future cart/checkout, then DSH must independently revalidate; this feature never asserts checkout success.
3. Given network disconnect/reconnect, when the user retries, then the owner supplies the current permitted projection without duplicating Store/Offer data.

### Edge Cases

- Empty and large catalogs, invalid or reused identifiers, same-name Stores, zero/negative price, unapproved media, inactive city/vertical, unpublished/paused Store, direct-only relation and stale state.
- No server data, offline/timeout/5xx/403, cursor invalidation, mixed Arabic and numeric price formatting, font scaling, reduced motion, RTL keyboard/focus order and Android back/deep links.
- A public projection is not consent to disclose a Customer address, private Order, Merchant financial statement, employment record or authentication/session token.

## Functional Requirements

- **FR-001**: DSH MUST own one public discovery/query contract with server-side eligibility by Store publication, MARKETPLACE relation, service city, permitted vertical, access and bounded pagination.
- **FR-002**: DSH MUST expose public Store detail for each legitimately published channel, without implicitly granting DIRECT marketplace listing.
- **FR-003**: DSH MUST apply its single CUSTOMER_VISIBLE_OFFER evaluator to category, Product, Variant, Offer, Store, price, quantity and availability at each public Offer projection.
- **FR-004**: Public APIs MUST return only allowlisted public fields; never Customer addresses, unpublished Store/Offer data, unapproved media, internal grants or monetary ledger details.
- **FR-005**: Customer Web/Android MUST render Arabic RTL, light/dark semantic tokens, accessible labels/focus, loading, empty, error, no-results and recovery from DSH failures without local fake commerce data.
- **FR-006**: Switching Store/city/account MUST invalidate older in-flight projection responses and not show cross-context data.
- **FR-007**: The eventual cart and checkout flows MUST independently revalidate effective price, availability and eligible fulfillment with their actual owners; no shopping cart or payment mutation is implemented by this feature.
- **FR-008**: Executable operations, owner SQL, server and Customer business screens MAY be developed before global governance cutover as part of the progressively developed Product scope, after adapting the stage-aware verifier and within isolated synthetic development state. Contract/ACL review and applicable risk tests remain mandatory before claiming journey closure or production readiness.

## Key Entities

- **ServiceCity**: DSH-owned operating geography, not a freeform client authorization.
- **Store**: DSH-owned business resource with one MARKETPLACE/DIRECT relation, publication and operational availability.
- **Product/ProductVariant/StoreOffer**: DSH-owned catalogue identity and Store sellable Offer facts.
- **PublicStoreProjection/PublicOfferProjection**: Authorized DSH responses only; names for conceptual view shape, not new persisted tables, APIs or independent writers.

## Success Criteria

- **SC-001**: In owner-backed tests, all prepared published MARKETPLACE Store records are returned and every prepared ineligible/direct-only/out-of-scope Store is absent from marketplace discovery.
- **SC-002**: In owner-backed tests, every public Offer has a valid eligible Variant/Store and its actual DSH positive YER price; all prepared draft/unavailable Offers remain excluded.
- **SC-003**: Tested city/Store switch, failed fetch, stale response and cursor cases never reveal old-context private data and expose an actionable recovery state.
- **SC-004**: Actual Web and Android journeys show Arabic RTL, usable light/dark, keyboard/screen-reader accessibility and no invented checkout success; iOS remains NOT_RUN without real device evidence.
- **SC-005**: Auth/Store IDOR, negative visibility, pagination, read failure and policy-revocation cases pass against real owner contracts before any claim of business readiness.

## Explicit Non-goals and assumptions

- NO sample or mock Stores/Offers masquerading as server readback; NO Order, WLT, payment, merchant editing, subscription, direct checkout, new Store owner or API operation before the relevant owner contracts and tests are implemented.
- Reuse the existing Customer Expo Web/mobile app, existing Tamagui/design tokens, existing Identity and DSH owners, pinned toolchain and the single authorized worktree.
- This document is a spec, not Product approval, a generated API contract, a runtime implementation, legal permission or evidence that the feature works.
