# Open-Source Delivery, Logistics and Yemen Localization References

DOCUMENT_CLASS: NONAUTHORITATIVE_EXTERNAL_REFERENCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
ADOPTION_AUTHORITY: NONE
REFERENCE_FRESHNESS: REVALIDATE_AT_USE
REFERENCE_CLASS: OSS_AND_PRODUCT_EXEMPLAR

Purpose: discover relevant fulfillment, dispatch, fleet, routing, mapping, commerce and support patterns when a current BThwani task materially needs them. This is a reference set, not an implementation plan, dependency inventory or architecture decision.

## Dispatch, operations and fleet
- Fleetbase — https://github.com/fleetbase/fleetbase — delivery dispatch, operations, exception/recovery patterns; AGPL/commercial-license implications require review before code reuse.
- ERPNext — https://github.com/frappe/erpnext — inventory and fulfillment/accounting patterns; not a replacement for DSH or WLT.
- Odoo Community — https://github.com/odoo/odoo — inventory, fulfillment and operational process reference; check individual module editions and licenses.
- Open Logistics Foundation — https://git.openlogisticsfoundation.org/explore/projects — open-logistics projects and interoperability; the official projects are hosted on GitLab, not one GitHub repository.
- Traccar — https://github.com/traccar/traccar — device GPS tracking and history; app-driven courier tracking need not adopt a separate fleet server.
- Eclipse Kuksa Databroker — https://github.com/eclipse-kuksa/kuksa-databroker — in-vehicle data/IoT, not ordinary phone-based delivery tracking; low current relevance.

## Routing, geocoding and maps
- OSRM — https://github.com/Project-OSRM/osrm-backend — route and travel-time calculations; evaluate road coverage and operating cost.
- GraphHopper — https://github.com/graphhopper/graphhopper — alternative route engine and configurable vehicle profiles.
- Valhalla — https://github.com/valhalla/valhalla — alternative route engine and multimodal directions.
- Openrouteservice — https://github.com/GIScience/openrouteservice — routing and isochrone/reference APIs; verify each component's license.
- OpenTripPlanner — https://github.com/opentripplanner/OpenTripPlanner — public-transit planning; not an initial last-mile delivery dependency.
- Nominatim — https://github.com/osm-search/Nominatim — geocoding/reverse geocoding; public Nominatim is rate-limited and not suitable as a default high-volume service.
- MapLibre GL JS — https://github.com/maplibre/maplibre-gl-js — browser-based map rendering; candidate for operator UI if there is a proven unmet need.
- Leaflet — https://github.com/Leaflet/Leaflet — lightweight browser-map alternative; do not add alongside MapLibre without need.
- VROOM (additional relevant exemplar) — https://github.com/VROOM-Project/vroom — multiple-order/vehicle route optimization, only when routing complexity makes it necessary.

## Commerce, warehouse and support
- Medusa — https://github.com/medusajs/medusa — merchant/fulfillment and inventory patterns.
- Saleor — https://github.com/saleor/saleor — commerce/order/fulfillment patterns.
- Spree Commerce — https://github.com/spree/spree — marketplace/fulfillment patterns; revalidate current license and editions.
- OpenWMS.org — https://github.com/openwms/org.openwms — warehouse operations; not a required standalone warehouse for local store delivery.
- FreeScout — https://github.com/freescout-help-desk/freescout — customer-service cases, inbox and escalation workflows.
- "Node-Shipping / Open Shipping Libraries" is a generic category, not a verified single repository. Do not add an invented canonical GitHub URL.

## Yemen-specific evaluation constraints
- Do not infer that 20 local Yemeni open-source delivery products do not exist from an incomplete GitHub search; absence would require a defined scope and reproducible census.
- Open-source availability does not prove legal permission to privately embed or white-label every project. Check exact license, network copyleft, edition, dependencies and provenance at the time of adoption.
- Existing BThwani DSH owns dispatch, order and delivery operational truth; WLT owns COD cash exposure, receivables, collection, remittance and reconciliation. External products are references or bounded adapters, never duplicate writers.
- For Sana'a and other Yemeni cities, validate actual OpenStreetMap road coverage, vehicle access, turn restrictions, street/landmark naming and measured ETA against representative local trips before selecting a routing provider.
- Customer delivery address must allow location pin plus bounded local descriptive directions/landmarks; geocoded text alone is not a verified delivery point.
- OSM data is under ODbL and needs attribution. Do not copy copyrighted coordinates, roads or names from proprietary maps into OSM.
- OSM Foundation public tiles and Nominatim endpoints are not guaranteed, unrestricted production infrastructure: https://www.openstreetmap.org/copyright ; https://operations.osmfoundation.org/policies/tiles/ ; https://operations.osmfoundation.org/policies/nominatim/
- Mobile tracking must account for intermittent internet, coarse/stale GPS readings, permissions, battery use, privacy, and authorized task-scoped readback; self-hosting alone does not solve these conditions.
- Compare alternatives within the current owner and adopt only on demonstrated need, benefit, license compliance, bounded operating cost, replaceability and direct BThwani proof.

Reference presence does not authorize code copying, deployment, migrations, a new service, or a change in product requirements.
