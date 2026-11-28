# BThwani — Store registration, relation, publication and delegated access

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/stores.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Merchant and Store are different truths

Identity owns actor, role and session; DSH owns Store identity, ownership, relation, Service City, grants, publication and operational availability. One Merchant may own several Stores, including different verticals, through one Store writer. No relation-specific Store table or parallel Merchant identity. DSH employment under [HR](hr.md) is distinct from account, invitation and effective Store grant.

Relation (طريقة عمل المتجر), business type (نوع النشاط), parent commercial vertical (المجال التجاري), Service City and catalog category are independent facts. Validate actual active compatible DSH registries, deriving compatible hierarchy rather than demanding redundant inputs. Preserve accepted IDs and relationships through authorized migration; no guessed legacy classification.

## PARTNER_ONBOARDING_STORE_PUBLICATION — Store admission and publication
CAPABILITY_ID: PARTNER_ONBOARDING_STORE_PUBLICATION

### Account and creation authority

Eligible self-registration uses the same verified canonical Customer actor, own phone proof and Identity-authorized Merchant role/session without prior Operator approval or existing Store. Disabled or previously provisioned roles cannot be reactivated via first registration. Follow [Identity](identity.md) for credentials, purpose-bound challenges and role/session creation. Collect necessary account input only (phone, password and confirmation where required by the admitted flow); optional legal name/business email belong to their actual later profile owners, never fake saved identity. Native and explicitly trusted Merchant Web share admission semantics with platform-appropriate session storage. Authenticated Merchant without a Store enters setup; one with Stores reaches authorized management. No joining-application writer.

An authorized merchant Operator may assist enrollment or initiate an invitation, but cannot verify the person's phone, issue the role or impersonate. A separately authorized Operator-assisted Store-create entry may select only an explicitly identified existing verified Merchant owner after current Store-create permission and eligibility checks. It converges with Merchant self-service on one DSH writer, never assigns the Operator as owner by default. Current Merchant-only API is not authority for Operator credentials; assisted creation remains unavailable until its exact authorized contract and proof exist.

### One creation contract, explicit admission

For every first or later Store, require genuine name, active Service City, active vertical and compatible Store Type, category only where applicable, actual address/map location, explicit eligible relation, modes/terms and consent required by the admitted contract. No complete Shared catalogue prerequisite. One versioned DSH policy per applicable scope/relation governs every new Store, regardless of entry path. Authorized Operator policy changes require current platform_policies and applicable owner scope under [Identity](identity.md), expected version, attribution and idempotency. Registration options display only currently usable choices; no enabled city/relation or active vertical means no usable form. Missing/disabled policy fails closed at atomic creation; no stale client fallback, implicit relation substitution or policy bypass.

Stable operation identity binds exact owner and payload. Check existing exact operation and current authority before denying new creation on a changed policy; replay returns the committed Store, never duplicates or broadens access. Differing payload, stale policy version and conflicting/unknown creation are explicit failures or reconciliation. First-Store convenience must preserve exact replay and concurrency; it does not create a separate engine. Historical first-Store-only endpoints/defaults do not prove further-Store or assisted creation has shipped.

Each new Store has its own ID, draft catalogue, relation, grants, schedule, readiness and WLT agreement. No inheritance of publication, wallet access, staff grants or paid entitlements from another Store. Authorized multi-Store selection always rechecks actual scope; switching invalidates prior private reads and in-flight responses. Closing admission affects fresh creation, not existing lawful Stores/Orders or exact authorized replay.

### Readiness, profile and publication

New Store starts unpublished, empty WEEKLY operating schedule (closed), without invented hours, media, catalogue, publication, payment or orderability. DSH owns preparation and publication; WLT alone owns terms, bound owner's exact acceptance and Finance activation. Verify current legal/Identity/Store eligibility, active geography, location, separate approved logo and cover, eligible catalogue, explicit operating schedule, supported methods and actual accepted effective agreement before the applicable publication/checkout transition. Never enable a financial or fulfillment method merely through visibility, registration or a pause control. Direct low-risk automatic publication is a separately admitted workflow, never implied by this document.

Direct public visibility and marketplace publication are separate eligibility decisions; one flag does not silently authorize the other. Publication does not imply open, visible Offer, serviceability or checkout readiness. Optional public business phone/email/WhatsApp and media are DSH Store facts, written by actual authorized Store/profile owner; private Identity contacts, premises proof, retired enrollment evidence and customer data are not copied. Operator publication review reads existing unpublished Store evidence; it is not a new application writer, approval or activation.

Denied and incomplete drafts remain recoverable through the owner. Preserve lawful historical obligations, original ownership and eligible pending-case recovery without recreating obsolete enrollment, acquisition-role or reward writers.

## STORE_RELATION_MODEL — Two channel options, one Store
CAPABILITY_ID: STORE_RELATION_MODEL

Human decision 2026-11-26: each Store has exactly one relation; DIRECT means Direct commerce only, not a prohibition on an eligible public link. MARKETPLACE adds marketplace eligibility to the same Direct foundation. This supersedes the donor's older prohibition on concurrent Direct and marketplace channels for the same eligible marketplace Store.

| Relation | Direct sales | Marketplace sales |
| --- | --- | --- |
| DIRECT (متجر مباشر) | Eligible subject to common gates | Forbidden |
| MARKETPLACE (داخل سوق بثواني) | Eligible subject to common gates | Eligible subject to common and marketplace gates |

Historical BTHWANI_PARTNER/INDEPENDENT_STORE are migration inputs, not additional current types. DSH owns relation/history, publication, actual requested sales channel and Order channel snapshot. Neither a path, query parameter, theme, business type nor caller determines authority/settlement. Both relations use one Store, catalogue, inventory, cart, Order, employee/grant, fulfillment, reporting and financial foundation. WLT independently owns COMMISSION/SUBSCRIPTION, collector and accepted terms; DSH owns methods under [fulfillment](fulfillment.md). No relation hard-wires a fee, collector, Captain or unsupported capability.

### One public storefront, bounded channels

One responsive Customer Expo Web Store page uses shared eligible DSH Store/Offer/Product/Variant/availability/media facts and reusable presentation components. It is a Store-scoped web route, not another Expo app, website framework, tenant, cloned customer application or Merchant administrative shell. Guests and owners see the same approved public URL without requiring marketplace login for lawful public reading; editing/private draft review stays in Merchant management. No owner-only parallel storefront. Native Customer marketplace and compact Web marketplace views require separate marketplace eligibility; a phone browser can open the public Web Store page. DIRECT does not acquire native marketplace discovery. Additional lawful Web profile content, Store sections, descriptions, options, policies and business contact must obey owner privacy and publication. DNS/hosting terms/payment activation are separately gated.

One authorized DSH mutation supplies all eligible projections; their visibility subsets may legitimately differ. Revalidate on changed price, offer, scope or withdrawn publication; no stale public draft/private records or unapproved media. Refresh/invalidation is required, not a guarantee of instantaneous push. Checkout rechecks server authority, actual channel, publication, quantity, price, stock, availability, geography, financial terms and selected mode. Public URL never implies payment authority. Direct checkout may remain read-only until its actual proof exists.

### Conversion and retained rights

Authorized owner request, legal eligibility, actual effective WLT terms/Finance approval as applicable, pending Order/custody and subscription/commission reconciliation, plus versioned DSH relation/publication transition precede conversion. Preserve Store/Variant/Offer IDs, valid staff grants, media, stable public URL, historical Orders and financial rights. Prior Orders retain frozen terms; only future newly prohibited channel creation is denied. Safe verified redirects only for eligible public GET requests, never private records or checkout mutations. No conversion from a UI label or registration field; activation requires actual owner contract and end-to-end proof. Remove superseded presentation only after verified link/consumer cutover and regressions.

## STORE_OPERATIONAL_AVAILABILITY — Availability is not publication
CAPABILITY_ID: STORE_OPERATIONAL_AVAILABILITY

DSH owns versioned weekly schedule, one-off closure, temporary pause, attributable reason and optional end, bounded preparation estimate and operational availability of each durably admitted method. Derive OPEN_FOR_ORDERS, CLOSED_BY_SCHEDULE, PAUSED and OPERATIONALLY_UNAVAILABLE from facts; not independently editable statuses. Distinguish publication, visible Offer, active city/serviceability, durable method eligibility and operational availability. Customer discovery may show a published Store as closed/paused; no automatic unpublication. Authenticated checkout may show relevant pause expiry from the same owner snapshot, public discovery derived state only.

Merchant with actual owned/granted scope or specifically authorized Operator bounded intervention invokes the same DSH writer with expected version, attributable reason, idempotency and readback. Operational changes cannot add methods, bypass agreement, alter publication, catalogue, serviceability, past Orders or financial terms. Only pause/resume an already durably admitted eligible method; changed commercial obligation requires effective agreement under [finance](finance.md). Pause expiry removes temporary override, not weekly hours or other gates. Never substitute another unavailable mode. At confirmation independently recheck current selected-method orderability.

Reject stale version, overlapping/invalid local or overnight intervals, unauthorized scope and conflicts; reconcile duplicate, offline and unknown results at owner. No 24/7 defaults, mandatory check-in, workforce scheduler, numeric capacity, predictive queue or independent publication engine. Follow [architecture](architecture.md#safe-change-protocol) for versioned policy changes.

## STORE_SCOPED_ACCESS_DELEGATION — One account, bounded Store rights
CAPABILITY_ID: STORE_SCOPED_ACCESS_DELEGATION

DSH owns StoreAccessGrant invitation, one Store/actor, authorizing owner, finite action allowlist, version, acceptance, expiry, suspension/revocation and audit. Identity owns phone proof, actor, credentials, Merchant role and session. Employment does not imply login; invitation or Merchant role alone never grants Store access. Owners and staff use the same Merchant workspace; no separate Staff app, generic organization-wide permission or new Identity role.

Only actual authorized Store owner can create, change, suspend/resume or revoke staff grants; no delegated self-expansion, permission administration or shared credentials. Before Identity provisioning, DSH validates owner, exact Store and complete requested permission set. Invitation begins with name/phone and scoped duties, not raw actor ID, code or password transfer. Resolve/reuse eligible canonical actor or initiate admitted managed enrollment, failing closed on ambiguous identity. Owner label is not verified official name. Invited person proves own phone, accepts the specific invitation and obtains the necessary Identity-managed role/session where applicable; only effective accepted DSH grant plus current role/session authorizes access. No routine Operator approval of ordinary owner-created employees. Preserve lawful pending legacy recovery without reviving new obsolete cases. One multi-Store user action produces separately scoped, attributable per-Store grants.

### Bounded permission presets and financial boundary

Store Manager is an operational preset over explicitly granted scopes; Order Staff receives Order scope; Catalog Staff receives catalogue scope and only separately granted promotion management; Accountant receives financial read/report and payout-intent request only when separately granted; Delivery Staff receives only admitted fulfillment/Order scope. These are UI presets, not roles. Custom selection is bounded to same finite actions. All Order/catalogue/promotion/operation/fulfillment reads and writes check current Store authority; unrelated Stores, revoked grants, another role session and owner-only actions are denied even in aggregate views.

WLT independently authorizes financial read/report and payout-intent against exact Store scope. Only actual Store owner proposes/changes/reconfirms beneficiary assignment through WLT; no grant authorizes destination mutation, redirection, Finance approval/execution/reconciliation or ownership. Follow [finance](finance.md). Suspension/revocation stops future Store access, not unrelated Store relationships or historical actions. Identity re-evaluates remaining lawful Merchant-workspace eligibility; no automatic deletion or reactivation. Duplicate/declined/expired invitation, interrupted actor/role admission, stale grant, concurrent update or lost acceptance reconciles original identity without duplicate actor/grant or broadened scope. Discard old actor/Store private responses on switch.

## Acceptance

Prove exact actual DSH/Identity/WLT contracts, verified self-registration and rejection of disabled role, new Store admission races, identical replay and changed-payload conflict, explicit assisted permission where admitted, multi-Store isolation, no inherited grants, guest approved public reading, stable URL, separate channel publication, withdrawal and stale reads, current checkout/availability, schedule/pause recovery, owner-only grant administration, phone-based invitation and accepted-role readback, denied non-Merchant/foreign/revoked/self-escalated scopes and financial boundaries. Exercise affected actual Web/Android, private pending responses and lawful retained rights. No screen, policy row, historical approval or source declaration proves deployed capability.
