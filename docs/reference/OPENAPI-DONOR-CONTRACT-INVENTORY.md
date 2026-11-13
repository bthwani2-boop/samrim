# OpenAPI donor contract census and target scaffold coverage

ARTIFACT_CLASS: HISTORICAL_SOURCE_INVENTORY
BUSINESS_POLICY_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CANDIDATE_STATUS: CONTRACT_SCAFFOLD_ONLY
DONOR_WORKTREE: D:/samrim
DONOR_BRANCH: 41
DONOR_SHA: 426d67b47beb8c66b09acd8c7394086b53ac5aae

## Evidence and method

The donor is **read-only evidence**. Read the three owner's `contracts/openapi/<owner>.openapi.yaml`, every donor domain path fragment, parsed YAML with the donor's locally installed `yaml@2.9.0` dependency and resolved donor main Path Item references to their module files. Counted root path keys, distinct operations and fragment paths. This is a **contract-source census**, not a live server, source-handler, SQL, generated-client or signed-policy audit. The candidate's governance root remains `GOVERNANCE_CUTOVER: NOT_READY`.

| Owner | Donor root Path Items | Donor operations | Donor path modules | Root inline vs referenced | Target reserved groups |
| --- | ---: | ---: | ---: | --- | ---: |
| Identity | 55 | 59 | 7 | 0 inline / 55 referenced | 7 |
| DSH | 385 | 453 | 23 | 10 inline / 375 referenced | 21 |
| WLT | 95 | 107 | 0 | 95 inline / 0 referenced | 14 |

No duplicate `operationId` was observed among operations resolved from the donor root Path Items in this census. No donor fragment was found orphaned from DSH or Identity root references. **This is not proof of valid security, schemas, public exposure, financial semantics or backend parity**. In the donor, WLT's 95 paths reside inline in one 3,863-line OpenAPI entrypoint; Identity's 55 routes are already indexed through seven modules; DSH's entrypoint spans about 12,450 lines.

## Identity — preserve useful separation, not legacy permissions

Target `paths/` groups: `runtime`, `client-auth`, `managed-enrollment-auth`, `operator-passkey-access`, `session`, `internal-actor-administration`, `actor-legal-name`. These are the seven source-established donor groups and are kept as **unreferenced empty files**. They represent health, customer credentials/recovery, managed access, protected operator/passkey lifecycle, browser/native sessions, actor/role/operator permission administration and verified legal-name lifecycle, respectively.

Risk: donor development-session paths, root/operator administration, privileged re-enrollment, browser cookies, secure storage and role switching need actor/host authorization review; no operation is approved by reserving its group.

## DSH — source coverage and ownership decisions

The original **seven** reserved groups (`stores`, `catalog`, `offers`, `cart`, `orders`, `fulfillment`, `employees`) were **not comprehensive**. The target reserves 14 more: `runtime`, `locations`, `serviceability`, `store-access`, `store-publication`, `captains`, `order-conversations`, `promotions`, `discovery-content`, `notifications`, `client-shares`, `operational-policies`, `financial-views`, `customer-discovery`. Together these are 21 flat owner-local placeholders, **not 21 engines or approved APIs**.

| Donor path module | Donor Path Items | Target domain placement / required review |
| --- | ---: | --- |
| beneficiary-finance | 49 | `financial-views` for lawful DSH read projections; financial mutations/evidence/recipients belong to WLT; legal-name truth to Identity |
| captain | 39 | `captains` for admission and Store affiliation; `fulfillment` for assignment, handoff and completion |
| catalog | 77 | `catalog`, `offers`, `stores`, `customer-discovery` according to canonical writer; not one enormous catalogue file |
| client-shares | 3 | `client-shares` with consent, scope and blocking checks; not a parallel account engine |
| commerce | 66 | `cart` (quote/checkout/multi-Store coordination), `orders`, `order-conversations`, `customer-discovery`, `promotions` |
| delivery-fee | 2 | DSH operational eligibility only in `operational-policies`; actual fee terms/amounts owned by WLT `fee-policies` |
| hr-access | 6 | `employees` plus lawful Identity credential/role delegation, not a fourth HR service |
| hr-attendance | 1 | `employees` with company/Merchant organizational isolation |
| hr | 6 | `employees`, one bounded DSH employee engine |
| joining-cases | 17 | Audit legacy enrollment against admitted Merchant/Store and Captain onboarding; **do not restore discontinued field-onboarding as a new engine** |
| location-core | 3 | `locations` for addresses and delivery origins |
| marketing | 39 | `promotions` (pricing eligibility) and `discovery-content` (banners, Studio, publication/media); WLT owns promotion funding postings |
| notifications | 4 | `notifications`, bounded owner-scoped event/read/device delivery adapters |
| partner-finance | 8 | `financial-views` as WLT-backed projection; payouts/receivables/commission posting stay in WLT |
| runtime | 2 | `runtime` |
| service-city | 3 | `locations` for canonical service-city location scope |
| serviceability | 1 | `serviceability` with city/version/radius/fulfillment checks |
| store-access | 19 | `store-access`, `stores` and `store-publication` by real resource; no Identity global-grant writer |
| store-availability | 3 | `stores` for operational availability, independently of publication |
| store-contact | 3 | `stores` for public/business contact with visibility rules |
| store-images | 2 | `stores` for Store-specific attested image references; technical media storage is not a second Store writer |
| store-publication | 18 | `store-publication` and `stores`; Direct publication is not Marketplace checkout |
| wallet-provider | 4 | Provider display/metadata must be reconciled with actual payment-rail owner; **no DSH wallet, ledger or financial integration authority** |

The 10 donor inline DSH Path Items include separate independent-Store public reads, Store-joining policies and distance-band/Captain minimum-balance policies. Reclassify them with `stores`/`store-publication` and DSH operational policies **or WLT fee/cash policies according to owner**, instead of copying old root inline policy logic.

Notable target distinctions: `stores` is the **single** Store engine for Marketplace and Direct; `catalog` is global products/taxonomy; `offers` is StoreOffer price, stock and visibility; `cart` covers quote, checkout and multi-Store orchestration; `orders` covers snapshots, changes, cancellation and bounded incidents; `fulfillment` covers all admitted dispatch, Store-Captain and pickup modes; `captains` covers Captain status/affiliation, not a second Identity registry. `customer-discovery` includes public read and favorites, and `discovery-content` includes bounded publication of banners/media. `order-conversations` is separate from delivery notifications for private evidence and permission safety.

## WLT — split its monolithic source by financial responsibility

The 14 reserved `paths/` groups are `runtime`, `payment-intents`, `wallets`, `funding`, `ledger`, `cash-custody`, `fee-policies`, `commercial-agreements`, `earnings-receivables`, `beneficiaries`, `payouts`, `settlements`, `reconciliation` and `financial-reporting`.

Source rationale:
- `payment-intents` groups create/read/collect/cancel/remit; `wallets` provides owner-backed balance/holds; `funding` covers funding intents and authorized provider reconciliations.
- `ledger` reserves **one immutable WLT posting/readback boundary**, not a new ledger table or a claim that a donor API for every journal exists.
- `cash-custody` covers Captain COD reservations, cash liability, remittances and recovery; `fee-policies` owns delivery fees, commission policy and authorized monetary limits.
- `commercial-agreements` covers Store fee/collector contract admission, version and acceptance; `earnings-receivables` owns partner earnings, commission receivables and actual allocations.
- `beneficiaries` covers financial profiles, verified payout recipients and official transfer destinations; `payouts` covers requests/approvals/withdrawal intake; `settlements` covers batch close/transfer/posted evidence.
- `reconciliation` covers mismatched, uncertain, legacy COD or adjustment states without creating fake refunds; `financial-reporting` covers statements, documents and protected downloads. `runtime` is reserved for standard service health/readiness even though donor WLT had no separate path module.

Exact pathway placement, schema, money/permission invariants and negative tests are deferred to contract + service implementation. **Nothing in the scaffolds grants ledger mutation, withdraw, COD or financial settlement authority.**

## Structural admission and pending requirements

All three new OpenAPI 3.1 root documents remain exactly `paths: {}`, with no servers, schemas, security schemes or `$ref`. Each reserved group is precisely `paths: {}\n`; no module is referenced. The foundation gate must reject unknown filenames, non-empty Path Items, duplicate entrypoint content, syntax mutations, symlinks and premature Go/SQL. This does **not** claim full YAML/OpenAPI compliance of any future executable contract.

Before real Path Items: complete per-owner route/handler/consumer/SQL inventory (including dynamic usages), reconcile Product and protected governance, compare Path/Method/operationId/security/request/errors/nullable/constraints, use a standard OpenAPI 3.1 YAML parser + strict $ref resolver, verify duplicate paths/IDs, generate TypeScript/Go clients as derived output, and test real actor/Store isolation, no duplicated financial effects and owner durable readbacks. Old paths are evidence, not a required one-to-one migration. Record KEEP/MERGE/REFOUND/REPLACE/APPROVED_RETIRE decisions then, and before any sensitive implementation activation perform the human-approved **internal** FIN/SEC/MIG adversarial risk assessment, negative/integration and owner-backed readback tests, with distinct approval for the consequential action. There is no external-reviewer staffing prerequisite merely to adopt the approved target policies.

No Push, PR, Merge, running service, DB migration, invoice or payment effect is authorized by this source inventory.

## 2026-11-13 — Verified first Identity contract candidate (read-only admission precheck)

This section is an **implementation-source trace**, not an adopted Product rule, executable API, approved migration or permission to begin the domain phase. Source remains donor branch `41` at `426d67b47beb8c66b09acd8c7394086b53ac5aae`; candidate `GOVERNANCE_CUTOVER: NOT_READY`.

| Evidence boundary | Exact donor source and observed behavior | Candidate treatment |
| --- | --- | --- |
| Contract | `services/identity/contracts/openapi/paths/session.yaml`: `GET /auth/session`, `operationId: readCurrentSession`, `security: [{ accessToken: [] }]`; response `200` refers to `ActorIdentity`, `401` to `Unauthenticated`. | **REFOUND_CANDIDATE / NOT_ADMITTED**: evaluate as a first read-only Identity contract after policy approval and an isolated service runtime. |
| HTTP owner | `services/identity/backend/internal/transport/http/server.go`: registers `GET /auth/session` with `s.currentSession`; handler requires a bearer token, resolves it via `s.sessions.ResolveAccessToken`, returns `ErrUnauthenticated` when absent/invalid and serializes the resulting identity on success. | Reuse the approved Owner semantics, not an unreviewed copy of the donor router or session issuance. |
| Historical test | `services/identity/backend/internal/storage/postgres/migrate_test.go` contains a test helper that calls `GET /auth/session` and asserts role/actor identity for successful sessions. | Reassess proof coverage on the **new** service/schema/runtime; donor test presence is not a candidate PASS. |
| Target | `services/identity/contracts/openapi/identity.openapi.yaml` retains `paths: {}`; `paths/session.yaml` is only an empty reservation; `clients/index.ts` exports nothing. | Do not add a route, Go service, client export or database schema until a separate domain-implementation authorization and applicable FIN/SEC/MIG/LEGAL gates. |

**Minimum future admission checks:** approve the session's authorized actor/role response shape and token/cookie boundary; explicitly test missing/invalid/expired/revoked credentials, role and account switching, cross-actor confusion, logout invalidation, browser origin/session isolation, safe errors without credential leakage and canonical Identity persistent readback. Record required SQL baseline/upgrade and generated-client compatibility against one tested candidate SHA. Operator recovery/Root Owner is a separate protected journey; `GET /auth/session` alone does not validate it.

**First commerce follow-on, not yet selected:** a DSH-publication-scoped, privacy-safe published-Store read for Customer can follow Identity admission; its exact donor route, Store publication invariants, authorized projection and consumer proof must be verified before any operation is added. No WLT wallet, COD, settlement or ledger mutation is admitted by these read-only suggestions.

**Documentation correction recorded:** the three service owner READMEs now describe the actually reserved **7 Identity / 21 DSH / 14 WLT** nonfunctional path groups. Earlier README statements that Identity/WLT had no modules and DSH had only seven were stale. The structural directories remain unchanged.

## 2026-11-13 — Published-Store read dependency correction (DSH source-traced)

SOURCE_BRANCH_SHA: `41@426d67b47beb8c66b09acd8c7394086b53ac5aae`
STATUS: SOURCE_TRACE_ONLY / NO_API_ADMISSION / NO_RUNTIME_PROOF

The earlier proposal to use a published-Store read as a first visible Customer slice needs a material dependency qualification: **this is not a stand-alone DSH/SQL read** in the donor. It gates customer visibility on live Identity and WLT owner facts, so a new implementation must not merely return rows whose `publication_state` is published.

| Boundary | Branch-41 source proof | Required new-owner behavior, pending governance |
| --- | --- | --- |
| OpenAPI | `services/dsh/contracts/openapi/paths/store-publication.yaml`: `GET /dsh/public/stores/{storeId}`, `operationId: readPublishedStore`, required `StoreId` and `ServiceCityIdRequired`, `200 PublicStoreView`, `404 NotFound`, `502 DependencyUnavailable`. | Candidate mapping to the **existing** target DSH `customer-discovery` / `store-publication` groups must be decided **once** by owner; never publish duplicate operations in both. |
| HTTP | `services/dsh/backend/internal/transport/http/storepublication.go`: `readPublic` requires `serviceCityId`, calls `s.service.ReadPublished`, masks an ineligible Store as `404`, computes published Store orderability and serializes the public view. | Require city-scoped allowlisted data, no private Store or recipient fields, explicit failure/readiness and orderability labels, no UI-local business-price or publication writer. |
| DSH persisted read | `services/dsh/backend/internal/storage/postgres/store_publication.go`: `ReadPublishedStore` filters same service city, active city, `publication_state='published'`, donor `relation_model='BTHWANI_PARTNER'`, customer-visible Offer and active financial profile. | Reconcile old relation string to the approved `MARKETPLACE` / `DIRECT` policy **without** rebuilding separate Store/Order engines or inventing marketplace entitlement for Direct Stores. Do not equate publication with customer orderability. |
| Identity gate | `services/dsh/backend/internal/storepublication/service.go`: `ReadPublished` calls `ReadinessForPartner`, which resolves the current Partner role through Identity and requires enabled/security-enabled/activated state; failures cannot be replaced by client flags. | A verified Identity read contract and relevant authorization behavior are predecessors. Cross-actor/cross-Store negative tests are required. |
| WLT gate | The same service calls `activeCommercialAgreementForStore` → `s.wlt.ReadStoreCommercialAgreements` and requires an accepted effective Store agreement before return. In `services/wlt/contracts/openapi/wlt.openapi.yaml`, `GET /wlt/v1/store-commercial-agreements` has `operationId: readStoreCommercialAgreements`, required `storeId`, `security: [{ serviceToken: [] }]`, and returns agreement history; `services/wlt/backend/internal/transport/http/store_commercial_agreement.go` validates the service caller and reads from WLT PostgreSQL. The donor declares a **separate POST mutation on the same path**; it must not be admitted merely to support this read. `ListPublished` also filters Identity eligibility and WLT agreement state after a bounded SQL-page scan. | An approved **service-authenticated, read-only WLT agreement-read** contract/implementation is a predecessor for parity, with exact Store scope, correct error responses and no direct Customer/DSH ledger writer. WLT is the sole financial owner; do not duplicate agreement validity, policy defaults or a ledger in DSH. |
| Source tests | `services/dsh/backend/internal/storage/postgres/joining_to_published_catalog_integration_test.go`, `joining_case_full_lifecycle_integration_test.go` and `checkout_single_store_replay_integration_test.go` contain negative scenarios for unpublished/non-marketplace Store visibility. | Donor test existence is not target candidate PASS. Run new owner-backed positive and negative tests on one isolated environment/revision including Identity/WLT unavailable, unpublished, wrong-city, Direct relationship, missing financial agreement and wrong actor. |

**Correct sequence:** (1) independently admit session/role semantics and isolated Identity read path; (2) approve DSH Store publication and minimal WLT commercial-agreement read contracts along with their own persistence/permission obligations; (3) implement DSH public view and genuine Customer consumer with missing-dependency/failure tests. The DSH read is **not** a reason to implement or activate Wallet, COD, customer charges or settlements first, but it does require a lawful, real WLT read boundary. No mock or static fixture is accepted as proof of that integration.

**Important separation:** branch-41's additional `GET /dsh/public/independent-stores/{storeId}` / `readPublishedIndependentWebStore` exists inline in the donor root OpenAPI for separately approved Direct web publication. That historic route is **not** a second canonical Store engine and must not automatically be reinstated or conflated with Marketplace `readPublishedStore`. Any approved Direct public read should be modeled as a governed policy within one DSH Store/catalog owner after the Product/Legal admission review.

No executable OpenAPI entrypoint, client export, Go service or SQL migration was changed by this source review. `GOVERNANCE_CUTOVER` remains `NOT_READY`; FIN/SEC/MIG/LEGAL target policy choices were approved by the human owner on 2026-11-13 without an external-reviewer prerequisite; affected internal financial/security/migration/legal **implementation evidence** and actual integrations remain `REVIEW_BLOCKED`/`NOT_RUN`.
