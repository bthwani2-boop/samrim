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

## Admitted policy: CITY_SCOPE_V1

The admitted serviceability policy is:

- `POLICY_VERSION = CITY_SCOPE_V1`
- `MEASUREMENT`: canonical Service City identity
- `BOUNDARY`: same active canonical Service City
- `UNIT`: Service City identity
- `COMPARISON`: exact canonical Service City identity equality

Canonical evaluation inputs for `CITY_SCOPE_V1` are:

- target canonical customer-visible Store and its assigned Service City (`Store.service_city_id`);
- owned client delivery address and its assigned Service City (`DeliveryAddress.service_city_id`);
- canonical active Service City state;
- immutable `CITY_SCOPE_V1` policy identity and version.

Canonical decision semantics:

- `SERVICEABLE`: Store and owned Address reference the same active canonical Service City, and the target Store satisfies customer-visible Store eligibility;
- `UNSERVICEABLE`: Store and owned Address are valid and active but belong to different active canonical Service Cities;
- `UNAVAILABLE`: required City assignment missing, required City inactive or unknown, legacy unassigned state, target Store not customer-visible, or required canonical dependency unavailable.

Store delivery origin and exact DeliveryAddress coordinates are preserved as purpose-limited operational location facts for physical delivery and routing, but they are explicitly not evaluation inputs for `CITY_SCOPE_V1`. Distance, radius, polygons, geofences, and map/routing provider measurements are not part of `CITY_SCOPE_V1`.

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
- `CITY_SCOPE_V1` evaluates equality of active Service City identities.

## Failure and recovery

Missing City assignment, inactive City, unserviceable address, stale evidence, or DSH offline state fail truthfully and distinguish `UNSERVICEABLE` from `UNAVAILABLE`. Recovery occurs by rereading or re-evaluating canonical owner state. A successful user-facing result requires canonical committed readback.
