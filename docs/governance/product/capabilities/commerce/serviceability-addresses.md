# Serviceability and Addresses

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/commerce/serviceability-addresses.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: SERVICEABILITY_ADDRESSES

## Outcome

A client can maintain an owned delivery address and receive one canonical DSH serviceability decision for a target customer-visible Store on the current BThwani delivery path.

## Ownership

DSH owns delivery-address operational truth, Store delivery-origin operational location truth, canonical Service City operational truth, and serviceability policy/evaluation result. Map/geocoding/routing providers are technical adapters for physical delivery and are not serviceability authorities.

## Admitted policy: CITY_SCOPE_V2_RADIUS_30KM

The admitted serviceability policy is:

- `POLICY_VERSION = CITY_SCOPE_V2_RADIUS_30KM`
- `MEASUREMENT`: matching canonical Service City plus straight-line distance between the Store delivery origin and the owned Client delivery address
- `BOUNDARY`: both locations in the same active Service City and at most 30,000 metres apart
- `COMPARISON`: inclusive maximum of 30 kilometres; invalid or missing coordinates fail closed
- WLT delivery quotes enforce the same maximum independently; a quote beyond this limit must not produce an arbitrary long-distance charge.

Canonical evaluation inputs for `CITY_SCOPE_V2_RADIUS_30KM` are:

- target canonical customer-visible Store and its assigned Service City (`Store.service_city_id`);
- owned client delivery address and its assigned Service City (`DeliveryAddress.service_city_id`);
- canonical active Service City state;
- canonical Store origin and Address coordinates;
- immutable `CITY_SCOPE_V2_RADIUS_30KM` policy identity and version.

Canonical decision semantics:

- `SERVICEABLE`: Store and owned Address reference the same active canonical Service City, and the target Store satisfies customer-visible eligibility and the 30 km radius;
- `UNSERVICEABLE`: Store and owned Address are active but in different Cities or exceed the accepted operating radius;
- `UNAVAILABLE`: required City assignment missing, required City inactive or unknown, legacy unassigned state, target Store not customer-visible, or required canonical dependency unavailable.

Store origin and DeliveryAddress coordinates are evaluated server-side only. Straight-line distance is a conservative operating limit, not a road distance or travel-time promise. Expanding service radius requires a new explicitly governed policy, not merely extending delivery-price bands.

## Invariants

- client input supplies address/location intent and discovery preferences, never authoritative serviceability;
- an address belongs to exactly one authorized client, derived from the verified client session;
- serviceability is Store-scoped, evaluated by DSH server-side from canonical Store and Address records;
- client activeServiceCityId is local client discovery preference only and is never serviceability authority;
- Store publication/customer visibility remains the `PARTNER_TO_VISIBLE_STORE` outcome; serviceability readiness is a prerequisite for `SINGLE_STORE_ORDER_CREATION` and does not redefine publication;
- the canonical result exposes sufficient Store, Address, and Service City version evidence for later Cart freshness validation without exposing raw coordinates;
- no alternate fulfillment lane can be selected through address/serviceability input;
- exact location is purpose-limited operational data and must be minimized.

## Location Core and Service City relationship

LOCATION CORE:

- owned client delivery address with exact coordinates and text;
- Store delivery origin with exact coordinates;
- canonical persistence, ownership, and readback for delivery execution.

SERVICE CITY SCOPE:

- DSH owns canonical Service City identity and lifecycle (active/inactive);
- Store belongs to exactly one canonical Service City;
- DeliveryAddress belongs to exactly one canonical Service City;
- `CITY_SCOPE_V2_RADIUS_30KM` evaluates same-city identity and a bounded origin-to-address radius.

## Failure and recovery

Missing City assignment, inactive City, unserviceable address, stale evidence, or DSH offline state fail truthfully and distinguish `UNSERVICEABLE` from `UNAVAILABLE`. Recovery occurs by rereading or re-evaluating canonical owner state. A successful user-facing result requires canonical committed readback.
