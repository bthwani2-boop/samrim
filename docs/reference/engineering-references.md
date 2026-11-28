# BThwani — External engineering references

A single independent catalog for engineering agents and humans. These sources are external knowledge, not internal governance, an implementation plan, dependency inventory, approval gate, or compliance evidence. Use them to evaluate the design, code, data, contracts, tests, operation, and internal rules themselves.

## Use and priority

1. Identify the actual task and affected domains; use the router below to read only relevant sources.
2. Open the original publication and verify applicable edition, version, status, and scope. Prefer specifications and official technical documentation for normative technical requirements, books and guides for reasoning, and exemplars for comparison.
3. Compare with actual source, contracts, consumers, persisted data, and behavior. Choose the simplest sound applicable practice; do not copy a vendor stack or process verbatim.
4. If external knowledge conflicts with an internal rule, examine assumptions, risk, context, and evidence; identify corrections through authorized changes. Neither external popularity nor internal wording establishes correctness.
5. Verify outcomes through appropriate real tests, rejection, recovery, and durable readback where applicable. Reference presence alone proves neither implementation nor compliance.

P0 = critical correctness, security, data, money, contracts; P1 = architecture, development and quality; P2 = operations, efficiency, experience; P3 = domain exemplars and alternatives. These are reference relevance priorities, not work priorities or mandatory reading lists. A critical accessibility, reliability, or logistics issue can require any relevant reference immediately.

## Task router

| Task | Consult first |
| --- | --- |
| Auth, sessions, privacy, native security | [Security](#p0-security-and-supply-chain) |
| API design, compatibility, errors | [Contracts](#p0-service-contracts) |
| Money, ledger, transactions, retry, concurrency | [Data and finance](#p0-data-and-financial-integrity) |
| Code quality, CI, regression prevention | [Engineering](#p1-software-engineering-and-architecture), [Security](#p0-security-and-supply-chain) |
| Architecture, coupling, migrations, scalability | [Engineering](#p1-software-engineering-and-architecture), [Data](#p0-data-and-financial-integrity) |
| Agent work, specifications, feedback, collaboration | [Agentic development](#p1-agentic-development) |
| Deployment, incidents, telemetry, performance, recovery | [Operations](#p2-operations-and-delivery-performance) |
| UI, accessibility, Arabic, RTL | [Experience](#p2-experience-and-localization) |
| Delivery, dispatch, routing, addresses, tracking | [Logistics](#p3-logistics-dispatch-and-fleet), [Maps](#p3-routing-geocoding-and-maps), [Yemen evaluation](#yemen-specific-evaluation) |
| Stores, commerce, inventory, support | [Commerce](#p3-commerce-inventory-and-support) |

## P0 Security and supply chain

| Source / type | When and practical value | Boundary |
| --- | --- | --- |
| [OWASP ASVS](https://asvs.owasp.org/) — verification standard | API/Web security, auth, sessions, validation, cryptography; derive testable controls. | Select applicable version/requirements; not certification. |
| [OWASP MASVS](https://masvs.owasp.org/) — mobile verification standard | Native storage, network, auth, privacy, platform interactions; test device behavior. | Does not replace backend authorization or native platform guidance. |
| [NIST SSDF](https://csrc.nist.gov/pubs/sp/800/218/final) — secure development framework | Threats, dependency and vulnerability handling, secure releases; integrate into existing lifecycle. | Risk-proportionate, not another administrative lifecycle. |
| [SLSA](https://slsa.dev/spec/) — supply-chain specification | CI/build provenance, artifact integrity and trust; verify actual provenance. | Do not claim a level without evidence or add a build service without need. |

## P0 Service contracts

| Source / type | When and practical value | Boundary |
| --- | --- | --- |
| [OpenAPI Specification](https://spec.openapis.org/oas/) + [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) + [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) — specifications (one group) | API schemas/security, HTTP methods/status/cache semantics, structured problem details; prove backend/client parity, rejection and compatibility. | Use actual contract version; no breaking migration or new error format solely because a reference mentions it. |

## P0 Data and financial integrity

| Source / type | When and practical value | Boundary |
| --- | --- | --- |
| [PostgreSQL Documentation](https://www.postgresql.org/docs/) — official docs | Schema, constraints, isolation, locking, roles, upgrades, restore, query plans. | Use installed major-version docs; prove isolated actual data behavior. |
| [Designing Data-Intensive Applications (DDIA)](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781098119058/) — book | Data models, consistency, distributed failures, transactions, replication, recovery. | No speculative distribution, brokers or replication. |
| [Amazon Builders' Library — Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) — engineering guide | Timeouts, duplicate order/payment effects, request identity, replay and ambiguity. | No AWS dependency or universal retry policy; retain domain invariants. |
| [TigerBeetle — Financial Accounting](https://docs.tigerbeetle.com/coding/financial-accounting/) — domain implementation guide | Double-entry ledger, debit/credit, balances, transfers, reconciliation and financial invariants. | Not a mandated database, provider or accounting/legal compliance guarantee. |

## P1 Software engineering and architecture

| Source / type | When and practical value | Boundary |
| --- | --- | --- |
| [IEEE SWEBOK](https://www.computer.org/education/bodies-of-knowledge/software-engineering) — body of knowledge | Requirements, design, construction, testing, maintenance; select accepted practices. | Not every practice is mandatory; not certification. |
| [Software Engineering at Google](https://abseil.io/resources/swe-book) — book | Maintainability, testing, dependency management, review, tooling and engineering at scale; reduce complexity and feedback latency. | Adapt to product/team scale; no Google infrastructure requirement. |
| [Building Evolutionary Architectures](https://www.oreilly.com/library/view/building-evolutionary-architectures/9781492097532/) — book | Architecture evolution, fitness functions, change boundaries and trade-offs. | Reuse existing checks; no additional architecture platform or duplicate gates. |

## P1 Agentic development

| Source / type | When and practical value | Boundary |
| --- | --- | --- |
| [OpenAI — Harness Engineering](https://openai.com/index/harness-engineering/) — engineering case study | Agent context, navigable repo, tools, feedback, constraints and durable evidence. | Transfer principles, not stack or unattended privileges. |
| [Martin Fowler — Harness Engineering](https://martinfowler.com/articles/harness-engineering.html) — engineering article | Harness design, feedback, constraints and agent reliability. | Complements OpenAI; no second harness. |
| [GitHub — Spec Kit Agentic SDLC](https://github.github.com/spec-kit/guides/agentic-sdlc.html) — methodology/tool guide | Specifications, clarification, plans, tasks and verification linked to implementation. | Use existing proportionate artifacts; no parallel lifecycle or speculative files. |
| [Anthropic — The AI-Native SDLC Playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook) — playbook | Plan, design, build, test, deploy, maintain; feedback, skills, parallel work and measurable controls. | Adapt vendor-specific examples; no Claude-specific tooling or duplicate approvals merely to reproduce the guide. |

## P2 Operations and delivery performance

| Source / type | When and practical value | Boundary |
| --- | --- | --- |
| [Google SRE Books](https://sre.google/books/) — books | SLOs, toil, incidents, monitoring, capacity, release and recovery. | Appropriate service objectives and mechanisms; no mandatory SRE organization. |
| [OpenTelemetry](https://opentelemetry.io/docs/concepts/) — specification/docs | Correlate traces, metrics and logs; diagnose latency, failures and handoffs. | Use existing telemetry paths; protect sensitive data; no duplicate stack. |
| [DORA AI Capabilities Model](https://dora.dev/ai/capabilities-model/report/) — research/guide | Engineering productivity, delivery outcomes and enabling capabilities. | Measure actual outcomes; no quotas or extra reporting system. |

## P2 Experience and localization

| Source / type | When and practical value | Boundary |
| --- | --- | --- |
| [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) + [Arabic Layout Requirements](https://www.w3.org/TR/alreq/) — accessibility recommendation and layout guidance (one group) | Accessibility, focus, contrast, text direction, mixed Arabic/Latin, numerals and layout; verify actual surfaces. | Arabic guidance is not conformance certification; WCAG does not replace native accessibility tests. |

## P3 Logistics dispatch and fleet

The 20 exemplars in this and the next two sections are not installed components or adopted dependencies. First = useful initial comparison; alternative = compare if a real choice exists; conditional = consult on demonstrated need.

| Source / type | Relevance | When, value and boundary |
| --- | --- | --- |
| [Fleetbase](https://github.com/fleetbase/fleetbase) — OSS exemplar | First | Dispatch, delivery operations, exception/recovery; verify AGPL/commercial licensing before reuse. |
| [Open Logistics Foundation](https://git.openlogisticsfoundation.org/explore/projects) — project collection | Conditional | Logistics interoperability; official projects on GitLab, not one GitHub repo. |
| [Traccar](https://github.com/traccar/traccar) — OSS exemplar | Conditional | Device GPS tracking/history; phone courier tracking need not adopt a fleet server. |
| [Eclipse Kuksa Databroker](https://github.com/eclipse-kuksa/kuksa-databroker) — OSS exemplar | Conditional / low | Vehicle IoT data; low relevance to ordinary phone delivery. |

## P3 Routing geocoding and maps

| Source / type | Relevance | When, value and boundary |
| --- | --- | --- |
| [OSRM](https://github.com/Project-OSRM/osrm-backend) — OSS exemplar | First | Routing/travel time; evaluate road coverage and operating cost. |
| [GraphHopper](https://github.com/graphhopper/graphhopper) — OSS exemplar | Alternative | Routing and vehicle profiles; compare rather than duplicate engines. |
| [Valhalla](https://github.com/valhalla/valhalla) — OSS exemplar | Alternative | Multimodal directions; adopt only when useful. |
| [Openrouteservice](https://github.com/GIScience/openrouteservice) — OSS exemplar | Alternative | Routing and isochrones; check each component's license. |
| [OpenTripPlanner](https://github.com/opentripplanner/OpenTripPlanner) — OSS exemplar | Conditional / low | Public-transit planning; not initial last-mile dependency. |
| [Nominatim](https://github.com/osm-search/Nominatim) — OSS exemplar | First | Geocoding/reverse geocoding; public endpoint is rate-limited, not a default high-volume service. |
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) — OSS exemplar | First | Browser maps/operator UI if unmet need is proven. |
| [Leaflet](https://github.com/Leaflet/Leaflet) — OSS exemplar | Alternative | Lightweight browser maps; do not add alongside MapLibre without need. |
| [VROOM](https://github.com/VROOM-Project/vroom) — OSS exemplar | Conditional / high when needed | Multi-order/vehicle route optimization only when complexity warrants. |

## P3 Commerce inventory and support

| Source / type | Relevance | When, value and boundary |
| --- | --- | --- |
| [Medusa](https://github.com/medusajs/medusa) — OSS exemplar | First | Commerce, merchant/fulfillment and inventory patterns; no parallel commerce engine. |
| [Saleor](https://github.com/saleor/saleor) — OSS exemplar | First | Catalog, orders and fulfillment; compare patterns. |
| [Spree Commerce](https://github.com/spree/spree) — OSS exemplar | First | Marketplace/fulfillment; verify current license and editions. |
| [ERPNext](https://github.com/frappe/erpnext) — OSS exemplar | Conditional | Inventory, fulfillment, accounting; not a DSH/WLT replacement. |
| [Odoo Community](https://github.com/odoo/odoo) — OSS exemplar | Conditional | Inventory and operations; check individual module editions/licenses. |
| [OpenWMS.org](https://github.com/openwms/org.openwms) — OSS exemplar | Conditional / low | Warehouse operations; local-store delivery need not adopt a warehouse system. |
| [FreeScout](https://github.com/freescout-help-desk/freescout) — OSS exemplar | First | Support cases, inbox, escalation workflows. |

"Node-Shipping / Open Shipping Libraries" is a generic category, not a verified single repository; do not invent a canonical URL.

## Yemen-specific evaluation

- Do not infer absence of Yemeni OSS delivery products from incomplete searches; absence needs a defined scope and reproducible census.
- OSS availability does not establish permission to privately embed or white-label. Verify exact license, network copyleft, edition, dependencies and provenance at adoption.
- Current service boundaries: DSH owns dispatch, order and delivery operational facts; WLT owns COD cash exposure, receivables, collection, remittance and reconciliation. References or bounded adapters must not silently duplicate writers. Evaluate boundaries independently against evidence when design itself is in question.
- For Sana'a and other Yemeni cities, verify actual OpenStreetMap coverage, vehicle access, turn restrictions, street/landmark naming and measured ETA on representative trips before selecting routing.
- Support a location pin plus bounded descriptive directions/landmarks; geocoded text alone is not a verified delivery point.
- OSM data is under ODbL and needs attribution. Do not copy proprietary map coordinates, roads or names into OSM. Consult [copyright/attribution](https://www.openstreetmap.org/copyright), [public tiles policy](https://operations.osmfoundation.org/policies/tiles/) and [public Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/); public endpoints are not guaranteed unrestricted production infrastructure.
- Account for intermittent connectivity, coarse/stale GPS, permissions, battery, privacy and authorized task-scoped readback in tracking; self-hosting alone does not solve these conditions.
- Compare alternatives for demonstrated need, measurable benefit, compatibility, licensing, bounded operating cost, replaceability and direct BThwani proof.

## Keep the catalog lean

Use version-specific official documentation for actual languages, frameworks, dependencies and tools (including GitHub Actions, Docker and operating systems) at the point of use, not a parallel technology-manual catalog. Do not introduce parallel methodologies, speculative infrastructure, duplicate engines, validators, CI gates or observability stacks just because a reference mentions them. Keep only distinct useful sources; do not copy books or duplicate changing specifications. Reference presence does not authorize copying code, deployment, migrations, spending, new services or changes to product requirements.
