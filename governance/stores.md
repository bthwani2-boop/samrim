# BThwani — Store Registration, Relation, Publication and Delegated Access

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/stores.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Merchant and Store are different truths

Identity owns actor, role and session; DSH owns Store identity, ownership, relation, service city, grants, publication and operational availability. One Merchant may manage multiple Stores through one Store writer; no relation-specific Store table or parallel Partner identity. DSH employment records remain organization-scoped and separate from invitations, accepted Store grants and login under [HR](hr.md).

Relation/channel (طريقة عمل المتجر), business type (نوع النشاط) and parent commercial vertical (المجال التجاري) are distinct. Service city and catalog category are independent facts. Validate against current DSH registries; derive compatible hierarchy rather than asking redundant classification questions. Preserve accepted classification IDs and relationships through authorized migration.

## PARTNER_ONBOARDING_STORE_PUBLICATION — Store admission and publication
CAPABILITY_ID: PARTNER_ONBOARDING_STORE_PUBLICATION

Merchant self-registration uses the canonical verified Identity actor, without prior Operator approval or existing Store. An authorized merchant Operator may initiate an invitation or assist enrollment; cannot verify the human's phone, issue the role, impersonate or silently assign ownership. A separately authorized Operator-assisted Store-create entry may bind only an explicitly selected existing verified Merchant actor, after actual Store-create permission and eligibility checks. Both entry points converge on the one DSH writer. The current Merchant-only API is not itself authority to use an Operator credential; assisted creation remains unavailable until its own authorized contract and proof exist.

For every first or subsequent Store creation, collect only necessary business name, service city, active vertical and compatible type/category as applicable, address/actual map location, eligible relation/modes and consent. Operator Policies exposes one versioned DSH admission decision per applicable scope/relation. Recheck policy and eligibility atomically at creation; missing/disabled policy rejects fresh creation, with no silent relation substitution. Same actor/operation/identical payload retry returns its committed Store after current authority; conflicting payload fails. Historical first-Store locks and defaults are implementation evidence, not a second writer or permission to infer a missing relation.

New Store starts unpublished and operationally closed, without invented schedule, media, catalog, discovery, payment or orderability. DSH separately reviews legal, Identity, serviceability, location, approved logo/cover, terms, explicit operating hours, eligible catalog/method and WLT accepted agreement/Finance activation before eligible publication/checkout. Direct low-risk automatic publication remains a separately admitted workflow, never implied by registration. Marketplace and Direct publication/eligibility are separate decisions; one flag cannot silently grant the other. Optional public business phone/email/WhatsApp are DSH Store facts, not copied from private Identity or customer records.

Denial and incomplete drafts remain recoverable through the owner. Closing admission does not disable existing Stores. No new historical acquisition-role, enrollment or reward path; preserve lawful historical obligations and admitted pending-case recovery without creating new obsolete cases.

## STORE_RELATION_MODEL — Two governed channel options, one Store
CAPABILITY_ID: STORE_RELATION_MODEL

Human decision 2026-11-26: each Store has exactly one relation; DIRECT means Direct commerce only (not marketplace listing), not a prohibition on an eligible public link. MARKETPLACE adds marketplace eligibility to the same Direct foundation.

| Relation | Direct sales | Marketplace sales |
| --- | --- | --- |
| DIRECT (متجر مباشر) | Eligible subject to common gates | Forbidden |
| MARKETPLACE (داخل سوق بثواني) | Eligible subject to common gates | Eligible subject to common and marketplace gates |

Historical BTHWANI_PARTNER/INDEPENDENT_STORE are migration inputs, never four competing relation types. DSH owns current relation/history and validates actual requested sales channel, publication and common gates; confirmed Order sales channel is immutable. Both relations share Store, catalog, inventory, cart, Order, staff, fulfillment, reporting and financial engines. WLT independently owns COMMISSION/SUBSCRIPTION, collection responsibility and accepted terms; DSH governs methods under [fulfillment](fulfillment.md). No relation hard-wires fees, collector, platform Captain or unsupported capability.

A relation conversion requires the Store owner's authorized request, legal eligibility, accepted effective WLT agreement/Finance approval where applicable, reconciled in-flight Orders/custody, subscriptions/commission periods and DSH publication transitions. Preserve Store, Product/Variant/Offer IDs, valid staff grants, lawful media, public URL, financial and Order history. Existing Orders retain frozen terms; newly prohibited marketplace channel cannot create Orders after cutover. Direct remains subject to common gates. Safe GET redirects only where needed, never private records or checkout mutations. Conversion is not activated by this document.

One Customer Expo Web public Store page exposes approved information to guests and owner alike. Private editing/preview remains Merchant workspace. Marketplace discovery and compact views require separate marketplace eligibility. On withdrawal invalidate/revalidate stale public reads; checkout independently rechecks relation, publication, availability, price, stock and legal terms. Direct checkout may remain unavailable/read-only until proven. No URL/theme/query parameter grants marketplace access or determines settlement.

## STORE_OPERATIONAL_AVAILABILITY — Availability is not publication
CAPABILITY_ID: STORE_OPERATIONAL_AVAILABILITY

DSH owns the actual weekly schedule, one-off closure, paused-until, reason, bounded preparation estimate and current availability of each durably admitted method. Derived orderability distinguishes OPEN_FOR_ORDERS, CLOSED_BY_SCHEDULE, PAUSED and OPERATIONALLY_UNAVAILABLE. These are results, not independently editable client statuses. Publication, catalog/Offer visibility, active city/reachability, durable contractual mode admission and current operational method availability are distinct.

Merchant or Operator changes require exact Store scope, current authority, expected version, attributable reason, idempotency and DSH readback. A pause cannot add modes, alter WLT terms, unpublish a Store or rewrite existing Orders. Resuming only applies to an already durable eligible mode; new contractual terms require consent and WLT activation. No invented 24/7 hours, mandatory check-in or numeric/predictive capacity scheduler. Follow owner policy and safe change protocol.

Stale version, simultaneous pause/resume, invalid local/overnight interval or unknown response requires explicit owner reconciliation. Checkout rechecks effective state at confirmation; never substitute unavailable mode. Authenticated checkout may show current pause expiry from the same schedule snapshot; public discovery exposes derived state only. Pause expiry removes temporary override, not weekly hours or other gates. Unavailable policy/readback fails safe.

## STORE_SCOPED_ACCESS_DELEGATION — One account, bounded Store rights
CAPABILITY_ID: STORE_SCOPED_ACCESS_DELEGATION

DSH owns StoreAccessGrant lifecycle: one verified grantee actor, authorizing Store owner, exact Store, allowlisted actions, version, expiry, acceptance, suspension/revocation and audit. Identity owns proof, role and session. Employment need not imply login, and neither Merchant role nor invitation implies Store authority. No extra global role, generic Merchant administrator, reusable bearer authority or routine Operator enrollment queue for ordinary owner-created staff.

An invitation starts with phone/name and scoped duties, not caller-chosen actor ID, password transfer or global role. Resolve/reuse the canonical actor or admitted enrollment through the person's own phone proof; ambiguous match fails closed. Owner label is not verified legal name. Only Identity can admit necessary Merchant role via its managed path; invited actor accepts the specific DSH grant before effective access. One UX action across several Stores creates individually attributable grants with per-Store authority checks.

Store Manager, Order Staff, Catalog Staff, Accountant and Delivery Staff are presentation presets, not Identity roles. Every catalog, promotion, Order, operation and fulfillment action requires exact DSH grant. Financial read/report or payout-intent request also requires independent WLT Store authorization; no preset grants unrelated promotion, Finance approval, settlement execution, permission administration or ownership.

Only actual Store owner may propose/change/reconfirm payout recipient through the authorized WLT protocol. Staff, including Accountant/Manager, cannot replace a beneficiary, mutate external destination or bypass Finance verification. DSH independently rejects revoked, expired, suspended or unaccepted grants on every read/write; discard stale private responses after account/Store change. Duplicate invites, partial Identity admission, lost acceptance and concurrent changes reconcile through stable operation identity and actual owner facts without duplicated actor/grant or broadened scope.

## Acceptance

Use actual DSH/Identity/WLT contracts; owner policy applies prospectively under [architecture](architecture.md#safe-change-protocol). Verify two Store owners, multiple Stores, delegated/unrelated/revoked actor, pending GET/POST during context switch, current policy races, exact creation replay, allowed/denied channels, publication withdrawal, schedule/pause recovery, privacy and protected financial/customer readback. Preserve legal obligations and public links through compatible migration. No screen, policy row, historic approval or source-only check proves deployed capability.
