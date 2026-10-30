# BThwani — C4 architecture map (derived view)

> **Artifact class:** NON-AUTHORITATIVE / DERIVED_ARCHITECTURE_VIEW
> **Purpose:** Explain the existing BThwani boundaries and point to their canonical owners.
> **Execution authority:** NONE · **Product admission authority:** NONE · **Implementation-state authority:** NONE
> **Source basis:** The live canonical governance, service contracts and implementation must be read at the exact candidate HEAD before using this derived map. **This is not a runtime inventory or evidence that any journey passed end-to-end tests.**

## 1. How to read this document

This is a **map, not another source of truth**. It is deliberately descriptive and does not create roles, services, tables, APIs, product features, requirements, tests, or deployment instructions. Arrows in the **logical** diagrams describe responsibility and handoff; they do not prove direct network connections or deployed behavior.

When this map and its sources disagree, use the following owners:

| Question | Canonical source |
| --- | --- |
| Agent execution, safety and proof | [AGENTS.md](../AGENTS.md) |
| Repository placement | [REPOSITORY-STRUCTURE.md](../REPOSITORY-STRUCTURE.md) |
| Governance routing | [Governance index](governance/README.md) |
| Human actors and surfaces | [Platform model](governance/platform.md) |
| Durable service/data boundaries | [Architecture governance](governance/architecture.md) |
| Current admitted scope/non-goals | [Current Product](governance/product/overview.md) |
| Capability-specific meaning | [Capabilities index](governance/product/capabilities.md) |
| Cross-surface business scenarios | [Journeys](governance/product/journeys.md) |
| Experience and access constraints | [Experience](../docs/governance/policies/experience.md), [Security](../docs/governance/policies/security.md) |
| Current API behavior | [Identity OpenAPI](../services/identity/contracts/openapi/identity.openapi.yaml), [DSH OpenAPI](../services/dsh/contracts/openapi/dsh.openapi.yaml), [WLT OpenAPI](../services/wlt/contracts/openapi/wlt.openapi.yaml) |
| Actual modules and runtime configuration | [Apps](../apps/), [Services](../services/), [Local Compose](../infra/local/compose/compose.yaml) |

Governance expresses approved meaning; executable code/configuration, contracts, schema, tests and actual owner readback express current implementation truth. Historic blueprints and competitor files are not new authority. The diagrams below are **selective**, not an exhaustive API call graph.

## 2. C1 — System context (logical)

BThwani is **one** commerce/delivery Product serving four currently admitted high-level human personas. A person retains one canonical actor identity even when admitted to multiple roles; Store ownership, employee relationships, delegated access and Store–Captain affiliation are separate domain facts.

~~~mermaid
flowchart LR
    Client["العميل / Client"]
    Partner["الشريك / Partner"]
    Captain["الكابتن / Captain"]
    Operator["المشغّل / Operator"]
    BTH["BThwani\nمنصة تجارة وتوصيل واحدة"]
    Client --> BTH
    Partner --> BTH
    Captain --> BTH
    Operator --> BTH
~~~

**Boundary:** The human personas are not independent Products, tenants or business-data owners. Field is retired: its historical attribution remains auditable, but new referrals and Field sessions are not admitted. Partner onboarding is through Partner self-service or authorized Operator intake. External financial providers, notification transports and media providers are integration boundaries, not internal ledger or Order truth. Whether an external rail is currently integrated and usable must be established separately from executable evidence.

## 3. C2 — Containers (logical build/run decomposition)

The current build exposes three mobile app hosts, one Operator web host, and three Go backend service owners. Historical Field attribution is audit-only; Partner onboarding uses Partner self-service or authorized Operator intake. PostgreSQL/PostGIS and SeaweedFS appear in the local Compose configuration. The physical PostgreSQL instance is shared locally, but that does **not** grant cross-service permission to mutate another owner's facts.

~~~mermaid
flowchart TB
    subgraph Surfaces["Presentation hosts (no canonical business ownership)"]
      ClientApp["Client · React Native / Expo"]
      PartnerApp["Partner · React Native / Expo"]
      CaptainApp["Captain · React Native / Expo"]
      Control["Operator · Next.js Control Panel"]
    end

    subgraph Owners["Canonical service owners"]
      Identity["Identity · Go\nhuman identity / roles / sessions"]
      DSH["DSH · Go\ncommerce / Store / delivery / HR logical owner"]
      WLT["WLT · Go\nfinancial truth"]
    end

    subgraph Data["Local infrastructure (deployment details below)"]
      Pg[("PostgreSQL / PostGIS\nowner-bounded persistence")]
      Media[("SeaweedFS\nbinary media storage")]
    end

    Surfaces -.->|"authenticate through authorized paths"| Identity
    Surfaces -.->|"operational intent / readback"| DSH
    DSH -->|"authorized role/actor handoff"| Identity
    DSH -->|"durable financial handoff / reconciliation"| WLT
    Identity --> Pg
    DSH --> Pg
    WLT --> Pg
    DSH -.->|"bounded media adapter"| Media
~~~

**Important:** Dotted presentation edges represent logical API responsibilities rather than a verified direct client-to-service transport map. The exact route, proxy, authentication, adapter and caller for an operation must be read from the relevant source/OpenAPI files. No direct mobile-to-WLT route is asserted here. No separate deployable HR service, message broker, notification service, cache, gateway, or production cluster is implied by this picture.

### C2 source pointers

| Host or service | Current source boundary |
| --- | --- |
| Client | [apps/app-client](../apps/app-client/) |
| Partner | [apps/app-partner](../apps/app-partner/) |
| Captain | [apps/app-captain](../apps/app-captain/) |
| Operator | [apps/control-panel](../apps/control-panel/) |
| Identity | [services/identity](../services/identity/) |
| DSH | [services/dsh](../services/dsh/) |
| WLT | [services/wlt](../services/wlt/) |
| Design reuse | [packages/design-system](../packages/design-system/) |

## 4. C3 — Internal components (selective, source-backed)

These entries point to *existing code directories*, not to a mandate to extract new microservices. Owning business meaning comes from the Governance links in §1; a directory name does not prove that every admitted capability is complete.

| Logical responsibility | Verified current implementation directory |
| --- | --- |
| Identity actor, authentication, session | [actor](../services/identity/backend/internal/actor/), [authentication](../services/identity/backend/internal/authentication/), [session](../services/identity/backend/internal/session/) |
| Identity transport and persistent state | [transport](../services/identity/backend/internal/transport/), [storage](../services/identity/backend/internal/storage/) |
| DSH Partner joining/onboarding | [joiningcase](../services/dsh/backend/internal/joiningcase/) |
| DSH Store ownership/delegation, publication and live availability | [storeaccess](../services/dsh/backend/internal/storeaccess/), [storepublication](../services/dsh/backend/internal/storepublication/), [storeavailability](../services/dsh/backend/internal/storeavailability/) |
| DSH catalog, cart, Store Order | [catalog](../services/dsh/backend/internal/catalog/), [cart](../services/dsh/backend/internal/cart/), [order](../services/dsh/backend/internal/order/) |
| DSH geography and serviceability | [servicecity](../services/dsh/backend/internal/servicecity/), [serviceability](../services/dsh/backend/internal/serviceability/), [locationcore](../services/dsh/backend/internal/locationcore/) |
| DSH captain work and fulfillment-related source | [captain](../services/dsh/backend/internal/captain/), [order](../services/dsh/backend/internal/order/) |
| HR — logical domain within current backend | [hr](../services/dsh/backend/internal/hr/) |
| DSH/WLT cross-owner work | [financialhandoff](../services/dsh/backend/internal/financialhandoff/) |
| WLT money-related logic, transport and storage | [domain](../services/wlt/backend/internal/domain/), [cashin](../services/wlt/backend/internal/cashin/), [transport](../services/wlt/backend/internal/transport/), [storage](../services/wlt/backend/internal/storage/) |

### Domain distinctions easy to lose in a diagram

- Human Actor/role is an **Identity** fact; Store ownership and Store-scoped grants are **DSH** facts. HR employment is a logical HR fact, not an Identity role.
- **ServiceCity**, **CommerceVertical**, **CommercialStoreType**, **CatalogCategory**, and **StorefrontSection** are distinct concepts. Store Type does not equal product category. See [Central Catalog](governance/product/capabilities/partner/central-catalog.md).
- Store publication, current orderability, Offer availability, serviceability and fulfillment-mode availability are distinct DSH results. See [Store onboarding](governance/product/capabilities/partner/partner-onboarding-store-publication.md).
- WLT owns payment, balances, commission, earnings, cash custody, reconciliation and Store Commercial Agreement state; a Store-facing screen does not gain financial write authority. See [Agreement](governance/product/capabilities/finance/store-commercial-agreement.md) and [Finance policy](../docs/governance/policies/finance.md).
- One Store Order belongs to one Store. Parent multi-Store checkout is orchestration above independent Store Orders; its admission does **not** prove implementation completeness. See [Current Product](governance/product/overview.md).

## 5. Dynamic example — Partner admission to customer-visible Store

This is a **governed business handoff model**, not a network trace or an E2E test report. Conditional gates and authorizations remain with their named owners.

~~~mermaid
sequenceDiagram
    participant O as Operator
    participant D as DSH
    participant I as Identity
    participant P as Partner
    participant W as WLT / Finance
    participant C as Client
    alt Verified Partner self-service
      P->>D: Submit first-Store application
    else Authorized Operator intake
      O->>D: Create Partner joining case without Field attribution
    end
    O->>D: Review / correction / authorized admission
    D->>I: Request eligible Partner role admission
    I-->>D: Canonical actor / role outcome
    P->>D: Confirm / correct bound Store facts
    D->>W: Supply Store / enabled-mode context
    W-->>P: Present exact agreement version
    P->>W: Accept exact agreement version
    O->>W: Authorized Finance approval
    W-->>D: Active agreement readback
    O->>D: Final Store readiness / publication decision
    D-->>C: Customer-safe published Store projection, if gates pass
~~~

Final publication additionally depends on admitted catalog, Service City and other readiness conditions. Publication does **not** promise the Store can accept an Order now. Recovery, unknown outcomes, identity rebinding protection and idempotency are governed by the linked [Partner-to-visible-Store journey](governance/product/journeys.md), not by this abbreviated diagram.

## 6. Deployment view — current local Compose only

[infra/local/compose/compose.yaml](../infra/local/compose/compose.yaml) defines, among others, persistent PostgreSQL, an object-media service, local Mailpit, backend runtime containers, and one-shot migration/bootstrap/access-setup jobs. The Client/Partner/Captain Metro development servers and Next.js development host are started by separate repository commands, not represented above as additional backend services.

This does **not** specify staging/production topology, scalability capacity, current database row health, external financial connectivity or correctness of all local migrations. Read [runtime source](../tools/dev/dev.ps1) and actual runtime state before making operational claims.

## 7. C4 / code level — only when a material change requires it

No universal classes/functions diagram is maintained: doing so would quickly go stale and duplicate source. For a change to a financial transition, a concurrency boundary or a cross-service handoff, read the owning implementation and tests, draw one **temporary or focused** class/sequence/state diagram if that helps falsify the claim, and verify it against the same exact candidate. The code, schema, OpenAPI and test/readback remain authoritative.

## 8. Accuracy / maintenance rule for this derived map

1. **Never** use this file to approve Product scope, justify a new service/role, change an API, bypass governance, or declare a task complete.
2. Before changing a diagram, inspect the exact current Git HEAD plus any relevant working-tree changes, owner contracts, code paths, and local runtime configuration as applicable.
3. Keep each diagram scoped and labeled as conceptual versus deployment versus actually traced; do not draw unverified endpoints, protocols, queues, production topology or provider integrations.
4. On a material boundary change, update the applicable **canonical** owner/source first. Update this view only if the changed boundary makes it materially misleading. Do not create a parallel rule or an always-running diagram generator.
5. Validate relative Markdown links and Mermaid syntax; review changes alongside affected source when useful. A valid diagram **never** substitutes for tests, authorized end-user interaction, negative/failure cases, canonical committed readback and exact-head integration proof.
6. If an observed behavior conflicts with this map, treat this map as potentially stale and investigate. Do not modify healthy runtime data to make it match a drawing.

**Explicitly not proven by this document:** completeness of the repository, every service-to-service edge, CI/PR readiness, applied database migrations, financial conservation in real workflows, accessibility, load capacity, outage recovery, or an end-to-end journey reaching every authorized participant. No 100% or production-readiness claim is made.
