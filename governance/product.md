# BThwani — Product Admission and Capability Scope

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/product.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose and Product target
BThwani is **one** delivery-commerce platform for Customer, Merchant, Captain and authorized Operator, initially serving approved cities and business types. A Merchant can own multiple DSH Stores. Each Store has exactly one relation: `MARKETPLACE` («داخل سوق بثواني») or `DIRECT` («متجر مباشر»), selected during registration when permitted. Different relations are policies/channels, not duplicate Store, Product, cart, checkout, Order, fulfillment or payment engines.

The complete public Store presentation belongs to the **same Customer Expo Web application**, available through a governed link; marketplace listings and compact Store views belong to the existing Customer app surfaces. A DIRECT Store does not acquire marketplace exposure just by creating a link. No extra website framework, merchant-specific wallet or separate commerce platform follows from the relation name.

## Capability admission set — 26 existing IDs
The following identifiers are stable evidence-routing IDs from branch 41. They retain their current spelling solely to prevent loss of coverage during reconstruction; they are **not** instructions to perpetuate legacy UI nomenclature or revive retired operations. Domain documents own their semantics. There is no second capability catalog.

| Canonical semantic owner | Admitted capability IDs |
| --- | --- |
| `identity.md` | `IDENTITY_ACTIVATION_SESSIONS` |
| `hr.md` | `EMPLOYEE_HR` |
| `stores.md` | `PARTNER_ONBOARDING_STORE_PUBLICATION`, `STORE_RELATION_MODEL`, `STORE_OPERATIONAL_AVAILABILITY`, `STORE_SCOPED_ACCESS_DELEGATION` |
| `catalog.md` | `CENTRAL_CATALOG`, `CUSTOMER_STORE_CATALOG` |
| `commerce.md` | `SERVICEABILITY_ADDRESSES`, `CART_CHECKOUT`, `MULTI_STORE_CHECKOUT`, `ORDER_LIFECYCLE`, `ORDER_CONVERSATION`, `COMMERCE_PROMOTIONS`, `DISCOVERY_CONTENT` |
| `fulfillment.md` | `STORE_CAPTAIN_MEMBERSHIP`, `CAPTAIN_DISPATCH`, `STORE_CAPTAIN_HANDOFF`, `FINAL_MILE_DELIVERY`, `CUSTOMER_PICKUP` |
| `finance.md` | `STORE_COMMERCIAL_AGREEMENT`, `ORDER_PAYMENT_COLLECTION`, `CUSTOMER_BALANCE_FUNDING`, `CAPTAIN_BALANCE_FUNDING`, `PARTNER_CAPTAIN_EARNINGS_SETTLEMENT`, `CUSTOMER_BALANCE_MANUAL_WITHDRAWAL` |

The table is the **single admission census**. A capability is considered semantically reconstructed only once its named owner has a substantive `CAPABILITY_ID:` section with behavior, permissions, failure/recovery and cross-owner boundaries. No status here proves implementation.

## Product invariants
- One canonical Store and DSH order engine; one accepted Store Order per Store even when orchestrated under a multi-Store parent intent; DSH holds canonical order snapshots and lawful adjustments.
- Store relation, fees, collection responsibility and fulfillment are independently governed dimensions. Both relations can have either `COMMISSION` or `SUBSCRIPTION` under a signed WLT Store agreement; a policy is not a billing implementation.
- The supported fulfillment **types** are BThwani Captain, Store-affiliated Captain and Customer Pickup, independently eligible for each relation. A policy may only admit methods actually implemented, financially safe, permissioned and operationally ready.
- Marketplace discovery, Store publication, Store operational availability, Offer inventory, city/serviceability and Order checkout are distinct DSH facts. No single toggle substitutes for their evaluation at confirmation.
- Internal wallet money, cash custody, Store obligations and settlement beneficiaries are distinct WLT facts. No UI or Store policy directly writes an authoritative ledger.
- Merchant is the actor; Store is the resource. Delegation does not turn Merchant employees into a sixth global platform role.
- `EMPLOYEE_HR` remains one bounded product capability with one DSH employee-administration engine for BThwani company personnel and Merchant personnel. Different organizational scope does not authorize separate engines, a fourth HR service, automatic accounts/permissions or a general Merchant payroll product; Identity and WLT retain their exclusive authority.
- Private Order messages and media, transactional notifications, product/catalog import, promotions, media, bounded operations, Captain opportunity displays, financial reports, multi-Store Merchant work and secure links remain material subfeatures to include in the source-derived coverage crosswalk during implementation. No silent capability retirement because this document does not list it separately.

## Exclusions and scope change
Donor archives and competitor benchmarks are research, not automatic Product authority. Any proposed new marketplace, Direct Order engine, SaaS platform, ERP/POS replacement, review/CRM module, generic rules engine, loyalty or regulated pharmacy workflow may be **studied and prototyped during a scoped journey**, not silently added to the current supported Product or activated for real users. At the point of adopting commercial/legal behavior, the canonical Product owner must resolve scope and applicable legal obligations, avoid duplicate writers/engines, and establish verifiable acceptance. Production remains independently blocked until authorized.

**Explicit donor-41 non-goals retained (not newly admitted):** The current Product does not include scheduled Customer Orders, generic point-to-point courier requests, standalone advanced route-optimization or analytics Products, a standalone notification Product, broad customer-profile/privacy orchestration, generic Merchant organization/team administration beyond bounded Store grants, speculative multi-currency handling, paid Customer membership, mandatory daily Store check-in, a predictive/numeric Store-capacity engine, generic returns/exchanges, or electronics warranty-claim processing. Prescription-required and specially regulated pharmacy fulfillment remains excluded until its distinct legal and operational model is expressly approved; ordinary lawful pharmacy commerce does not itself activate that workflow. Transactional notifications, Order-scoped feedback and limited wrong/damaged/missing-item incident/refund remedies remain bounded to already admitted owner capabilities, not an invitation to create those excluded Products. Any newly proposed capability can be analyzed and implemented during development; its Product/legal adoption, owner, scope and failure/recovery decisions are resolved in the corresponding journey. Production activation remains subject to applicable acceptance and authority.

Obsolete onboarding paths from historical sources cannot be reinstated as new products, roles, screens or reward writers. Preserve only independently verified legally or financially binding historical liabilities with their true owners. Existing capability IDs containing `PARTNER` preserve traceability without creating a second Merchant actor or workflow.

New capability proposals may be **analyzed, specified and implemented in isolated development during their journey** without a separate preliminary human admission vote. The Product owner resolves their intended scope and legal/commercial choices in this single census as development proceeds, assigning one domain owner, contract, permissions, privacy, failure/recovery semantics and measurable acceptance. The existing 26 IDs are the current baseline, not a permanent maximum. A proposed new capability is not automatically production-ready or a binding commercial/legal commitment; those require applicable human decisions, evidence and separate release approval. Changing operator-editable defaults for an already supported capability is not a new Product capability.

## Remaining Product-boundary details retained for implementation planning

An accepted **subscription tier** may regulate clearly agreed and actually implemented optional capacity/service entitlements through the correct owner after WLT approval. It does **not** grant Identity roles, Store ownership, public listing, checkout or a guaranteed payment rail. Policy defaults, subscribed agreement and actual Store entitlement/readiness must remain distinct even when shown in one Operator workspace.

A delivery recipient can differ from the purchasing Customer but does not acquire Order/payment authority or a new required platform account. A Customer may receive basic Order-scoped feedback and post-order incident/refund remedy without establishing a social-review network or generic returns/warranty platform. Transaction notifications, current map opportunities and media projections are bounded dependents of DSH/WLT/Identity, not standalone business authorities.
