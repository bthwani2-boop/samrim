# External References — Commerce, Fulfillment and Operations

DOCUMENT_CLASS: NON_AUTHORITATIVE_EXTERNAL_REFERENCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

CURRENT_REPOSITORY_STATE_AUTHORITY: NONE
ADOPTION_AUTHORITY: NONE
REFERENCE_FRESHNESS: REVALIDATE_MATERIAL_FACTS_AT_USE
REFERENCE_REVIEWED_ON: 2026-09-05
REFERENCE_MAX_REVIEW_AGE_DAYS: 180
LICENSE_RECHECK_ON_ADOPTION: REQUIRED
SECURITY_SUPPLY_CHAIN_RECHECK_ON_ADOPTION: REQUIRED

### 1B.1 Commerce core / cart / checkout / order / fulfillment

**P1 — Shopify**
- Docs: https://shopify.dev/docs
- Use first for: mature commerce semantics, cart/checkout/order/fulfillment, inventory behavior, refunds, discounts, webhooks, and admin/operator workflows.
- Mode: REFERENCE_ONLY unless a specific provider/API integration is independently selected.

**P2 — Adobe Commerce / Magento Open Source**
- Docs: https://developer.adobe.com/commerce/
- Repository: https://github.com/magento/magento2
- Use for: implementation detail, catalog/order/inventory/admin extensibility and a second mature commerce model.

**P3 — commercetools**
- Docs: https://docs.commercetools.com/
- Use for: composable commerce boundaries, carts/orders/inventory/pricing, API-first modeling, resource versioning and optimistic concurrency concepts.

**P4 — Saleor**
- Repository: https://github.com/saleor/saleor
- Docs: https://docs.saleor.io/
- Use for: inspectable checkout/order/payment/inventory/permissions logic and contract organization.

**P5 — Medusa**
- Repository: https://github.com/medusajs/medusa
- Docs: https://docs.medusajs.com/
- Use for: modular commerce flows and open implementation comparison.

**P6 — Spree**
- Repository: https://github.com/spree/spree
- Docs: https://spreecommerce.org/docs/
- Use only if higher priorities leave a gap.

**P7 — Sylius**
- Repository: https://github.com/Sylius/Sylius
- Docs: https://docs.sylius.com/
- Use as a final domain-driven commerce counterexample.

**STOP:** If P1 answers the product-semantic question and no implementation-level gap remains, do not read P2-P7.

### 1B.2 Multi-vendor marketplace / Partner / seller operations

**P1 — Mirakl**
- Entry: https://www.mirakl.com/
- Use for: enterprise marketplace operator/seller separation, onboarding/governance, offers, commissions and marketplace operations.
- Mode: REFERENCE_ONLY using public material.

**P2 — Mercur**
- Repository: https://github.com/mercurjs/mercur
- Use for: inspectable multi-vendor marketplace logic, seller teams, vendor onboarding, offers, commissions, payouts and admin/vendor surfaces.

**P3 — Sharetribe**
- Docs: https://www.sharetribe.com/docs/
- Use for: marketplace actors, listings, transactions, operator/user boundaries and journey comparison.

**P4 — Medusa**
- Repository: https://github.com/medusajs/medusa
- Use only when a marketplace question needs comparison with a modular commerce implementation.

**P5 — Adobe Commerce ecosystem concepts**
- Docs: https://developer.adobe.com/commerce/
- Use for mature extensibility/operator counterexamples where applicable.

BThwani extraction priorities:

~~~text
PARTNER_ONBOARDING
SELLER_MEMBERSHIP
STORE_OWNERSHIP
CATALOG_MUTATION_AUTHORITY
OFFER_OWNERSHIP
ORDER_PARTITIONING
COMMISSION
REFUND_ALLOCATION
SETTLEMENT_ELIGIBILITY
PAYOUT
SUSPENSION
OPERATOR_OVERRIDE
AUDIT
~~~

### 1B.3 Delivery / dispatch / captain operations

**P1 — Fleetbase**
- Repository: https://github.com/fleetbase/fleetbase
- Site: https://fleetbase.io/
- Use for: broad inspectable logistics, dispatch, fleet/order execution and operator workflows.

**P2 — Uber Engineering**
- Engineering: https://www.uber.com/blog/engineering/
- Use for: high-scale dispatch, marketplace matching, geospatial systems, reliability and real-time operational patterns.
- Mode: REFERENCE_ONLY.

**P3 — DoorDash Engineering**
- Engineering: https://careersatdoordash.com/engineering-blog/
- Use for: delivery marketplace, dispatch, logistics optimization and operational reliability.
- Mode: REFERENCE_ONLY.

**P4 — Traccar**
- Repository: https://github.com/traccar/traccar
- Docs: https://www.traccar.org/documentation/
- Use when the question is telemetry, location, geofencing, freshness, offline/reconnect or location provenance.

**P5 — VROOM**
- Repository: https://github.com/VROOM-Project/vroom
- Use only for vehicle/route optimization.

**P6 — OpenTripPlanner**
- Repository: https://github.com/opentripplanner/OpenTripPlanner
- Use only if multimodal-routing concepts become materially relevant.

Specialist override: GPS/telemetry questions start with Traccar; optimization questions start with VROOM.

### 1B.4 Maps / routing / geocoding / serviceability

**P1 — Google Maps Platform**
- Docs: https://developers.google.com/maps
- Use first because BThwani already has Google Maps integration and for routing/geocoding/places operational semantics.

**P2 — Mapbox**
- Docs: https://docs.mapbox.com/
- Use for independent provider comparison and port/fallback validation.

**P3 — Valhalla**
- Repository: https://github.com/valhalla/valhalla
- Use for inspectable self-hosted routing-engine concepts.

**P4 — OSRM**
- Repository: https://github.com/Project-OSRM/osrm-backend
- Use for route-engine internals.

**P5 — VROOM**
- Repository: https://github.com/VROOM-Project/vroom
- Use for multi-stop/vehicle optimization.

**P6 — PostGIS**
- Docs: https://postgis.net/documentation/
- Use for canonical internal geospatial data, spatial constraints, indexes and serviceability semantics.

### 1B.10 Search / catalog discovery

**P1 — Algolia**
- Docs: https://www.algolia.com/doc/
- Use for product/catalog search UX, indexing, ranking, facets, typo tolerance and filters.

**P2 — Elasticsearch**
- Docs: https://www.elastic.co/guide/
- Use for mature distributed search/query/aggregation/relevance concepts.

**P3 — OpenSearch**
- Repository: https://github.com/opensearch-project/OpenSearch
- Docs: https://docs.opensearch.org/
- Use for open distributed search/analytics comparison.

**P4 — Typesense**
- Repository: https://github.com/typesense/typesense
- Docs: https://typesense.org/docs/
- Use for developer-friendly product/geo search.

**P5 — Meilisearch**
- Repository: https://github.com/meilisearch/meilisearch
- Docs: https://www.meilisearch.com/docs
- Use for lightweight typo-tolerant search/ranking.

Specialist rule: product search starts at Algolia; deep distributed-search architecture starts at Elasticsearch/OpenSearch.

### 1B.13 Backoffice / ERP / operational administration

**P1 — Odoo**
- Repository: https://github.com/odoo/odoo
- Docs: https://www.odoo.com/documentation/
- Use for broad operations/admin/HR-reference/accounting/inventory workflows and mature backoffice IA.

**P2 — ERPNext**
- Repository: https://github.com/frappe/erpnext
- Docs: https://docs.frappe.io/erpnext
- Use for inspectable ERP, operations, accounting, inventory and HR workflows.

**P3 — OrangeHRM**
- Repository: https://github.com/orangehrm/orangehrm
- Use only when future HR-specific employee lifecycle questions remain unresolved; this does not imply a current peer HR boundary.

**P4 — Microsoft Dynamics 365**
- Docs: https://learn.microsoft.com/dynamics365/
- Use only for enterprise backoffice workflow comparison where public docs are sufficient.

These systems do not justify a generic ERP god service.

### 1B.15 Customer support / operator service

**P1 — Zendesk**
- Docs: https://developer.zendesk.com/documentation/
- Use for ticket lifecycle, requester/agent boundaries, status, SLA/escalation and audit.

**P2 — Intercom**
- Docs: https://developers.intercom.com/
- Use for conversations, customer support/inbox and operator/customer context.

**P3 — Chatwoot**
- Repository: https://github.com/chatwoot/chatwoot
- Docs: https://www.chatwoot.com/docs/
- Use for inspectable omnichannel support/inbox workflows.

**P4 — Zammad**
- Repository: https://github.com/zammad/zammad
- Docs: https://docs.zammad.org/
- Use for helpdesk/ticket/audit/operator workflow comparison.

### 1B.17 Promotions / discounts / loyalty

**P1 — Shopify**
- Docs: https://shopify.dev/docs
- Use for discount lifecycle, combinability, targeting and cart/order effects.

**P2 — Talon.One**
- Docs: https://docs.talon.one/
- Use for advanced promotion/loyalty rules, campaigns, budgets, coupons and effects.

**P3 — Voucherify**
- Docs: https://docs.voucherify.io/
- Use for coupons, promotions, loyalty, validation and redemption lifecycle.

**P4 — Saleor**
- Docs: https://docs.saleor.io/
- Use for inspectable promotion implementation comparison.

**P5 — Medusa**
- Docs: https://docs.medusajs.com/
- Use only if implementation details remain unresolved.

## 6. Primary reference corpus

Licenses and project terms can change. **Fresh verification of the exact repository/component license is mandatory immediately before direct code reuse or dependency adoption.**

### 6.1 Marketplace / Partner / Commerce

#### Mercur
Repository: https://github.com/mercurjs/mercur
Current observed license class: MIT
Primary mode: `SELECTIVE_LOGIC_REFERENCE`

Use to challenge BThwani for:

```text
seller/vendor onboarding
seller teams/membership
vendor catalog ownership
offers
multi-vendor order behavior
commission calculation
payout eligibility
refund allocation
seller/admin boundaries
marketplace operational workflows
```

High-value candidate invariants:

```text
SELLER_SCOPING
PARTNER_MEMBERSHIP
CATALOG_MUTATION_AUTHORITY
ORDER_SPLITTING
COMMISSION_CALCULATION
SETTLEMENT_ELIGIBILITY
PAYOUT_LIFECYCLE
REFUND_ALLOCATION
```

Do not replace the Go DSH backend with Mercur.

#### Medusa
Repository: https://github.com/medusajs/medusa
Primary mode: `REFERENCE_ONLY / SELECTIVE_LOGIC_REFERENCE`

Use for:

```text
commerce lifecycle
cart/checkout/order modeling
inventory
fulfillment
payment orchestration boundaries
promotions
returns/refunds
```

Do not adopt a whole Node/TypeScript commerce backend as a shortcut around BThwani refoundation.

#### Saleor
Repository: https://github.com/saleor/saleor
Primary mode: `REFERENCE_ONLY`

Use for:

```text
checkout semantics
order state
inventory
payment behavior
GraphQL contract ideas
permissions
operator workflows
```

Its Python/GraphQL stack is not a reason to change BThwani’s Go direction.

#### Spree
Repository: https://github.com/spree/spree
Primary mode: `REFERENCE_ONLY`

Use for mature commerce and admin workflow comparisons.

#### Vendure
Repository: https://github.com/vendure-ecommerce/vendure
Primary mode: `REFERENCE_ONLY`

Treat direct code reuse conservatively because license/commercial terms must be freshly verified for the exact version/component before use.

---

## 7. Logistics / Captain / Dispatch corpus

### Traccar
Repository: https://github.com/traccar/traccar
Current observed license class: Apache-2.0
Primary mode: `SELECTIVE_LOGIC_REFERENCE / COMPONENT_CANDIDATE`

Use to challenge Captain/dispatch/telemetry logic for:

```text
position timestamp
position accuracy
heading
speed
last-known-position
position freshness
stale-position classification
geofence entry/exit
offline behavior
reconnect behavior
device/session identity
telemetry provenance
```

BThwani must still own delivery/dispatch business truth.

### Fleetbase
Repository: https://github.com/fleetbase/fleetbase
Primary mode: `REFERENCE_ONLY`

Use for:

```text
fleet/dispatch concepts
driver/captain operations
order/route execution
fleet management
operator workflows
```

Do not import a whole logistics platform into DSH by default. Freshly verify the exact license of every component before any code reuse.

### Valhalla
Repository: https://github.com/valhalla/valhalla
Primary mode: `REFERENCE_ONLY / FUTURE_COMPONENT_CANDIDATE`

Use for routing-engine concepts if self-hosted routing ever becomes a proven requirement.

Google Maps already being used in development is not itself a reason to add another routing engine.

### VROOM
Repository: https://github.com/VROOM-Project/vroom
Primary mode: `REFERENCE_ONLY / FUTURE_COMPONENT_CANDIDATE`

Use for vehicle-route optimization concepts only when a proven route-optimization root exists.

---

## 16. Required Captain/dispatch comparison checklist

Whenever Captain/dispatch/location is touched, compare against mature logistics/telemetry references for:

```text
CAPTAIN_IDENTITY
ASSIGNMENT
ACCEPT/REJECT
ARRIVAL
PICKUP
DELIVERY
CANCELLATION
LOCATION_TIMESTAMP
LOCATION_ACCURACY
LOCATION_FRESHNESS
STALE_LOCATION
OFFLINE
RECONNECT
GEOFENCE
ROUTE_DEVIATION_WHERE_APPLICABLE
DUPLICATE_LOCATION_EVENT
OUT_OF_ORDER_LOCATION_EVENT
BATTERY/OS_BACKGROUND_LIMITATIONS_WHERE_MATERIAL
OPERATOR_OVERRIDE
AUDIT/PROVENANCE
```

Do not turn Traccar/Fleetbase into the DSH business owner.

---

## 17. Required Partner/marketplace comparison checklist

Whenever Partner/store/catalog/commission/payout is touched, compare against mature marketplace references for:

```text
PARTNER_ONBOARDING
PARTNER_MEMBERSHIP
STORE_OWNERSHIP
CATALOG_MUTATION_AUTHORITY
APPROVAL
AVAILABILITY
ORDER_PARTITIONING
FULFILLMENT_RESPONSIBILITY
COMMISSION_CALCULATION
REFUND_ALLOCATION
SETTLEMENT_ELIGIBILITY
PAYOUT_DESTINATION
PAYOUT_FAILURE
SUSPENSION
AUDIT
CONTROL_PANEL_OPERATOR_ACTIONS
```

---
