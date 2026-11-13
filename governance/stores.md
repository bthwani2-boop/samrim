# BThwani — Store Registration, Relation, Publication and Delegated Access

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/stores.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Merchant and Store are different truths
Identity owns Merchant actor and session. DSH owns Store ID, actual Store owner, service city, Store relation, authorized membership/grants, publication and operational availability. One Merchant may create/manage multiple Stores through one authorized create operation; no separate Partner identity or relation-specific Store table.

DSH's one bounded `employees` engine may record Merchant employees against their actual Merchant organization and, where approved, one or multiple Stores. Employment records, invitations, Store-scoped grants and Identity accounts are separate facts. A Store employee may exist without a login; an employee with a login receives only independently accepted DSH Store grants consistent with their Identity eligibility. No Merchant can inspect company HR or another Merchant's employee records merely through Store membership.

The two **customer-facing choices** during Store creation are `MARKETPLACE` («داخل سوق بثواني») and `DIRECT` («متجر مباشر»). These names target the new clean contract, not two Store engines. Historic `BTHWANI_PARTNER`/`INDEPENDENT_STORE` refer to the same two old meanings during audited migration; never persist four competing business relation types.

## PARTNER_ONBOARDING_STORE_PUBLICATION — Store admission and publication
CAPABILITY_ID: PARTNER_ONBOARDING_STORE_PUBLICATION

**Outcome:** An authenticated Merchant directly creates a DSH Store using the minimum necessary business, service city, category, location and relevant consent data. The human actor is not an HR employee or a legacy field-enrollment representative. Additional Stores reuse the same DSH Store-create command under their owner.

**Policy:** Operator Policies governs whether **new Store registration** is available by relation, with one versioned DSH owner-backed setting; closing admissions does not silently disable existing Stores. Store creation verifies eligibility and relation at commit. No fallback to a different relation when disabled. Onboarding is not publication.

**Publication:** A submitted Store is reviewed under applicable legal, serviceability, catalog, identity and relation-specific criteria. Direct Web publication does not imply marketplace search/listing or a functioning checkout. DSH separately controls marketplace eligibility, full public Store page, terms acceptance, approval and revocation. Review, agreement, publication, Store operational status and checkout availability are distinct.

**Integrity:** Idempotent creates never make duplicate Stores after timeout; ownership is checked with Identity/DSH at the mutation boundary. Denials and incomplete drafts remain recoverable without a fake success. Obsolete donor onboarding workflows are not automatically restored as a new entry point, role, earnings writer or navigation surface; only legally binding historical financial/evidence obligations remain protected at their rightful owner.

## STORE_RELATION_MODEL — Two governed channel options, one Store
CAPABILITY_ID: STORE_RELATION_MODEL

**Outcome:** Each Store has precisely one effective channel relation: `MARKETPLACE` or `DIRECT`. The selected relation determines eligible customer discovery and legal publication/checkout **channels**, not commercial fee model, COD responsibility, identity or product catalog owner.

**Owner:** DSH writes Store relation and history. WLT owns the associated Store financial agreement and fee/collector policy. Operator can set permitted defaults and admission availability by relation in the **one Policies UX**, but cannot grant a capability still blocked in DSH/WLT.

**Relation change:** A future authorized change retains the same Store ID, Product/Variant/StoreOffer IDs, lawful media links, accepted financial history and Order history. It requires deliberate agreement and publication transitions and a coordinated, tested contract/data migration; it is not currently deemed activated merely by documenting it.

**Views:** A Store's full page is one Customer Expo Web presentation reachable by its governed link for an eligible published Store. Marketplace additionally presents eligible Store discovery and compact marketplace views. A DIRECT Store never inherits marketplace listing just because the underlying full page shares Customer code.

**Payment/fulfillment:** `COMMISSION` or `SUBSCRIPTION` may apply to either relation per accepted WLT agreement. Collection responsibility and eligible methods are separately owner-controlled. No relation name hard-wires fees, cash custody or the availability of a BThwani Captain.

## STORE_OPERATIONAL_AVAILABILITY — Availability is not publication
CAPABILITY_ID: STORE_OPERATIONAL_AVAILABILITY

**Outcome:** DSH owns one canonical readback of weekly schedule, temporary pause/closure, bounded preparation estimate and each **already admitted** fulfillment method's current orderability.

Publication, Offer stock/visibility, delivery reachability, Store opening, method availability and checkout eligibility are **distinct**. A visible Store may be closed, paused or have a selected method unavailable without being unpublished or changing its contractual modes.

Authorized Merchant/Operator changes are versioned, attributable, idempotent and confirmed by DSH readback. A temporary pause never adds an unapproved method or amends the WLT contract. Checkout rechecks all relevant availability at the authoritative confirmation point, not only when the screen was opened. No numeric predictive capacity engine is admitted by a pause toggle.

## STORE_SCOPED_ACCESS_DELEGATION — One account, bounded Store rights
CAPABILITY_ID: STORE_SCOPED_ACCESS_DELEGATION

**Outcome:** A Merchant can grant a named actor only specific Store-scoped duties allowed by Identity and DSH; the grantee does not become another root Store owner, global Merchant account or platform Operator by virtue of that grant.

Identity verifies actor authentication and platform role; DSH authorizes the current Store owner/grant for every Store-scoped mutation. Revocation must prevent a stale page, token or pending response from recovering old Store data. Store employee accounts, when admitted, require bounded authorization, safe invitation and auditable revocation; never silently inherit financial agreement authority.

**Proof boundary:** Two owners/two Stores, delegated actor, unrelated Store, revoked grant, account switch while GET/POST are pending, and protected customer/financial readback. A screen showing or hiding a button is not authorization proof.

## Required Store policy safety and recovery
- Policies have owner, scope, allowed values, version, effective date, who/why and owner-backed confirmation; no second policy store in Control Panel.
- Defaults govern **future eligible cases**. Existing Store rights, active orders, published URLs and WLT agreements do not change retroactively.
- Unsupported combinations are blocked, not silently remapped. Missing policy/failed read resolves to a safe unavailable state, not an invented open Store.
- Public data excludes private customer addresses and unrelated Store/Actor records.
- Exact API enum names and protected SQL migration are deferred to implementation evidence; these semantic requirements already bind the intended refoundation.

## Enrollment and Store publication details retained from the donor review

For a first Store, the Merchant is an already **verified Identity actor**; a client-supplied phone, actor header or Store owner ID cannot create Merchant privileges or select an arbitrary owner. Authorized Operator-assisted Store creation may bind an explicitly selected **existing, verified Merchant** with the same canonical DSH Store-create writer, but the Operator never becomes the Store owner by default or impersonates that person. Initial and subsequent Store creation use one DSH engine with deterministic idempotent retry; first-Store availability does not imply a second Store writer.

An accepted Store relation is distinct from **commerce vertical, Commercial Store Type, service-city assignment and catalog category**; all must be validated against current DSH registries. A new Store starts **unpublished and operationally closed** with no invented weekly schedule, 24/7 hours, product media, catalog, customer discovery or financial activation. It is not customer-orderable until explicit Store publication and checkout/fulfillment/readiness gates pass. Required publication facts include authentic Store location and branding, separate approved cover/logo, legal terms, Store-specific WLT agreement/Finance activation, explicit operating hours and eligible catalog/method. Public business phone/email/WhatsApp are optional DSH Store data, never copied from private Identity phone or archived customer records.

Owner-created Store member invitations preserve a bounded Store role and preset, proof of the member's **own** phone, optional reuse of the canonical Identity actor, explicit acceptance of DSH grant, scope-limited suspend/revoke and safe account switching. A label entered by an owner is not verified legal identity. Ordinary Store members are not subject to a new routine Operator admission workflow, but no member can grant themselves publication, payouts, financial-beneficiary change or another Store's access. Existing pending legacy admission cases retain historical authorized recovery without generating new work through obsolete paths.

## Explicit Store/orderability state distinctions preserved from branch 41

DSH's canonical customer orderability decision must distinguish at least `OPEN_FOR_ORDERS`, `CLOSED_BY_SCHEDULE`, `PAUSED` and `OPERATIONALLY_UNAVAILABLE` as **derived results**, not independently editable client statuses. The Store's publication state, catalog/StoreOffer visibility, active Service City and delivery reachability, **durable contractual method admission**, and **current operational availability of the selected method** are different owner facts. A customer-facing published Store can truthfully appear closed without losing its Store ID, market visibility or existing accepted Orders.

A Store's actual weekly schedule, one-off closure, paused-until timestamp, accountable reason and bounded preparation estimate use DSH-approved schemas and **supported Operator Policies**. No invented 24/7 hours, numeric capacity system or predictive queue scheduler follows from this requirement. A Merchant may pause/resume **only** an already durable eligible method, without changing the WLT agreement; a disabled mode cannot be silently replaced by another at checkout. If mode/financial terms require a new binding agreement, owner-specific consent and WLT activation precede durable admission.

On every change, verify Store scope, current role and expected version and retain reason/audit. Stale weekly schedule, conflicting simultaneous pause/resume, invalid local time/overnight interval or unknown network result require safe DSH readback; the Customer's quote/checkout rechecks the same effective Store/method state at confirmation. These are operational semantics, not four extra Store engines or a permanently duplicated policy field.
