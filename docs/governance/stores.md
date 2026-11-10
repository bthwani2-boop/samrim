# Stores and Commercial Relations

ARTIFACT_CLASS: DURABLE_GOVERNANCE
SEMANTIC_OWNER: docs/governance/stores.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## PARTNER_ONBOARDING_STORE_PUBLICATION — Partner Onboarding and Store Publication

CAPABILITY_ID: PARTNER_ONBOARDING_STORE_PUBLICATION

### Outcome
A verified person creates a Partner account directly with their phone and password. Identity verifies the phone and admits the Partner role without a joining application or Operator approval. After successful registration or login, the Partner immediately sets up their first Store in DSH; the Store belongs to their canonical Identity actor and starts **unpublished and not orderable**. The Partner can manage it and prepare its catalog, logo, cover, operating hours and commercial agreement. Customer-visible publication remains subject to Store-specific WLT financial approval, catalog/media/readiness and authorization gates, not a Partner account/joining-application approval.

Historical `joining_case` records and their evidence remain available for authorized correction/readback and financial reconciliation. New Partner account and first-Store creation never create a joining case.

### Ownership
Identity owns the phone challenge, canonical actor, Partner role admission, credentials and role-specific sessions. DSH owns Store identity, first-Store setup, durable ownership, Service City, commerce vertical and Store Type, fulfillment policy, operator-ready publication gates, public Store media, and canonical Store records. WLT owns Store-specific financial agreement proposal, acceptance, Finance approval and ledger-linked readiness. Partner self-registration never delegates these writers to the UI. Existing joining-case data are preserved under DSH as **legacy historical records only**.

### Current Store enrollment availability policy

DSH owns the two explicit model-specific admission toggles BTHWANI_PARTNER and INDEPENDENT_STORE. An authorized Operator with platform_policies may enable or pause **new first-Store creation** through the canonical DSH policy record and optimistic versioned, idempotent mutation; one initial record exists per relation model. Both start enabled for creation of unpublished drafts. Partner setup presents only enabled options read from DSH. The DSH first-Store transaction rechecks policy under a row lock after checking for an exact existing Store, so closing enrollment refuses fresh creation including legacy requests that omit relationModel, while preserving idempotent readback of an already created Store and all existing Store/Order rights.

This toggle never admits identity roles, commercial terms, marketplace publication, independent web publication or Order checkout. Marketplace still requires Partner acceptance, Finance approval and DSH publication readiness. Independent automatic low-risk publication is a future separately gated workflow and cannot be activated through this enrollment toggle. A policy-read/storage failure blocks new Store creation rather than trusting UI defaults. No generalized rule engine or parallel frontend policy authority is created.

### Current direct-registration and Store invariants

- Partner self-registration requires a valid verified Identity Client session on the same canonical actor; it creates the Partner role and a scoped Partner session atomically. An arbitrary phone number, spoofed Actor header or unsigned browser request never admits a Partner. Disabled or previously provisioned Partner roles must not be reactivated through self-registration.
- Both native Partner mobile and explicitly trusted Partner Web share the product sequence: direct account registration or login, automatic Partner session, first-Store setup, then management. They use platform-appropriate token/cookie storage. Neither surfaces a joining application as the way to join.
- New registration requires phone, password and confirmation, followed by Identity phone challenge. Personal legal name and public Store email are later optional/profile workflows, not fake saved Identity registration fields.
- An already authenticated Partner with Stores enters the management workspace; a Partner without a Store enters first-Store setup.
- DSH validates active Service City, vertical and compatible Store Type, real Store name, address, selected map coordinates and fulfillment modes using canonical registries. Only the authenticated Partner actor becomes the Store owner. The Partner explicitly chooses Store relationship BTHWANI_PARTNER or INDEPENDENT_STORE before first Store creation; business Store Type remains separate from commercial relationship. Old request contracts default to BTHWANI_PARTNER without changing legacy deterministic IDs. An independent Store may select only merchant delivery or customer pickup and stays unpublished until its separate web-hosting policy and owner publication workflow are admitted.
- One first Store is created per Partner through an atomic first-Store writer with deterministic exact replay, a per-actor advisory lock and negative cross-actor access checks. No new joining case, operator approval or impersonated actor ID is accepted.
- A newly created Store of either relationship is **unpublished**, with an empty WEEKLY schedule (closed) and no invented opening hours, catalog, public images or financial activation. A marketplace Store must not appear in customer discovery/orderability until DSH and WLT gates pass. Independent Stores remain ineligible for marketplace discovery and orderability altogether; their own separate public web publication and direct checkout are future independent-readiness gates, not a side effect of choosing INDEPENDENT_STORE.
- A Store may later add business-only phone, email and WhatsApp via DSH-owned public contact settings; personal identity phone and private customer data are not automatically copied.
- Store-scoped agreement terms/settlement and Finance approval remain WLT-owned and cannot be accepted implicitly by account or Store creation.
- Existing historical JoiningCase records and store/evidence links must remain readable for authorized workflows; do not delete the old schema or revoke existing admitted Partners as part of migration.
- Front-end session switches must invalidate prior owner data, and retries must not create extra Stores or cross-actor access.

### Historical joining-case preservation

Existing joining cases, correction evidence, encrypted proof identifiers, Field-origin records and legally binding historical financial obligations remain under their original DSH, Identity and WLT owners, with scope-limited authorized readback and reconciliation. They are not an entrance for a new Partner account or Store, not an alternative Partner admission path, and are never silently reassigned, exposed publicly or erased by simplifying documentation.

### Store-specific readiness and publication

- DSH first-Store setup validates an active Service City, compatible Commerce Vertical and Commercial Store Type, Store name, location and allowable fulfillment modes using canonical data. Store Type, vertical and category are distinct facts.
- Publication requires the applicable Store-specific agreement acceptance/Finance activation, legal checks, catalog/readiness, active public logo and separate cover media, explicit operating schedule and authorized DSH publication. Missing hours mean CLOSED WEEKLY, never inferred 24/7.
- Public Store phone, email and WhatsApp are optional business-only DSH profile facts; protected Identity phone, archived proof, historical premises images and private customer data are not copied into public views. Authorized owners and Operators use the existing DSH Store media/profile writer.
- Durable mode eligibility is DSH-owned, versioned, attributable and authorized. A Partner may pause an already-admitted mode operationally but may not grant a new mode or bypass finance using an availability toggle. Independent Stores cannot enable BThwani Captain fulfillment.
- Store publication, current orderability, visible offers, serviceability and checkout eligibility are separately evaluated; publication is not a promise that the Store is open now.
- One Partner may own several Stores. Subsequent Store creation must reuse DSH and Identity authority but is not represented as delivered by the first-Store-only creation writer.

### Further Stores: one DSH create command, two authorized entry points

The approved **target** for every additional Store is one canonical DSH Store creation operation (with authorized Partner self-service and Operator-administered entry points), not a second "additional Store" engine or duplicate Store identity. Identity supplies the authenticated acting actor and role; DSH verifies the intended owning Merchant actor, Store-scoped operator authority, relation-model admission policy, active City/type/vertical and replay/version rules at mutation time. An Operator cannot use a form to impersonate a Merchant or grant a new Identity role. The same validation and state defaults apply regardless of which entry point invokes the command. The first-Store shortcut may remain a user-experience convenience only when it invokes the original DSH owner and preserves its existing exact replay semantics.

Each new Store gets its own identity, relation, draft catalog/offers, publication/readiness and separately accepted WLT agreement; neither a new Store nor a switch to another Store inherits publication, wallet access, staff grants or paid entitlements from an existing Store. Multiple owned Stores use server-authorized Store selection. Concurrent creation/retry must not create duplicates or overwrite another Store; failure recovery reads DSH's persisted outcome. This is a **target contract**; the present first-Store-only endpoint is not evidence that additional-Store creation has been shipped.

### Current lifecycle — not legacy JoiningCase

1. Identity verifies the person through the canonical Client proof and directly admits a Partner session for a new eligible Partner, without a new JoiningCase or preliminary Operator approval.
2. DSH creates exactly one replay-safe first Store as an unpublished, initially closed draft with explicit BTHWANI_PARTNER or INDEPENDENT_STORE relation and bound actor ownership.
3. Store content, schedule, contact/media and permitted fulfillment are prepared through DSH. The bound owner accepts exact WLT agreement terms, which require authorized Finance approval before active paid or marketplace operations.
4. DSH publishes only the authorized channel after all distinct conditions pass: marketplace only for approved BTHWANI_PARTNER; direct web Store view for either eligible published relation.
5. DSH rechecks eligibility, stock/price and current orderability for the selected fulfillment at checkout. Independent direct checkout and subscriptions remain disabled until their distinct owner-backed gates pass.

Shared catalog preparation is optional program ordering, not a Partner role-admission prerequisite.

### Failure and recovery

Unverified self-admission, duplicate first-Store creation, stale version, incompatible city/vertical/type, cross-actor ownership, unavailable mode, unapproved publication, and incomplete WLT acceptance/approval fail closed. Recovery reads the authoritative Identity/DSH/WLT state and never creates a second Store or JoiningCase.

### Material participants

Verified Partner self-service, Store-publication Operators, customer public readers and Identity/DSH/WLT owners participate. Historical Field-origin acquisition and joining-case evidence remain limited to authorized historical readback and finance reconciliation.

## STORE_RELATION_MODEL — Store Relation Model

CAPABILITY_ID: STORE_RELATION_MODEL

### Outcome

A Partner may own multiple Stores. Each Store retains one canonical identity, catalog, public link, and storefront across relationship changes and has exactly one effective commercial relationship: BTHWANI_PARTNER (BThwani marketplace) or INDEPENDENT_STORE (merchant-direct web storefront). Transitioning preserves Store and catalog identifiers, merchant content, existing public links and historical Orders. The Store relationship never derives from its vertical, Store Type, category, client navigation, or query string.

### Ownership and relation semantics

DSH owns the Store relationship, ownership, effective history, channel publication, and Order routing. Identity owns the Partner actor/session; a new Store relationship never creates a new Identity role. WLT owns Store-specific commissions and, once independently activated, subscriptions and their invoices for either Store relation within one canonical financial ledger. The default model is policy-controlled, while the accepted Store-specific agreement is authoritative; relation alone cannot activate fees. No subscription creates a competing agreement engine or ledger, and old agreement versions remain unchanged. Applications present derived capabilities but never select financial terms or grant rights.

The currently admitted marketplace model continues to own all existing Stores. Existing Store rows remain BTHWANI_PARTNER after schema adoption; a database default is not an active agreement, a new Partner approval, or publication permission.

### Shared Store presentation contract

A published Store has one canonical identity, catalog, media and permanent public storefront across both relationships. The full responsive web storefront is the Store's **customer-facing** public presentation for both BTHWANI_PARTNER and INDEPENDENT_STORE, once the respective web publication and legal gates are met. A marketplace-eligible Partner Store additionally has a compact Store view in the BThwani Client marketplace on mobile and web; the independent Store never gains marketplace discovery or ordering through that view. The two compositions may differ in navigation and content but never create parallel Store writers, prices, inventory or permissions.

For any public Store checkout, DSH derives the effective commercial relationship and the eligible Order route from current owner-backed Store and publication facts at server confirmation. A website path, query parameter, client theme or entry channel cannot choose Direct versus Marketplace settlement. Public site address/DNS, hosting terms and payment enablement remain separately gated decisions, not effects of this presentation contract.

#### Approved Client Web storefront composition

- The full public Store website is a **web-only Store-scoped composition of the existing Client Expo Web application**, reusing its already owned design system, Store product cards, catalog/search interactions and customer-safe DSH readers where appropriate. It is **not** a new Expo application, a separate storefront product, another Store database, or a cloned Client application. Exact repository paths and deployment details are implementation truth, not durable governance.
- The Client Expo mobile apps and the Client marketplace web experience remain BThwani marketplace experiences. The public Store website is a separate **route and presentation mode inside Client Web**: it opens directly to one Store, may provide more Store-specific content than the compact marketplace view, and must not require a Client marketplace login merely to read approved public content. Web-only means no independent-store marketplace screen in the native Client application; a responsive public website may still be opened from a phone's browser.
- The website uses the **same canonical Store and StoreOffer/Product/Variant/catalog/media/availability facts** that power eligible Client marketplace views. Reuse proven UI components and styling rather than copying the catalog, pricing, search, Store detail or product presentation into a second application. Additional web detail may include Store cover/profile, Store-local sections, longer descriptions, product options, approved contact channels, policies and merchant-provided presentation. It may not expose private Store-owner, customer, joining-case or internal media data.
- Store-specific styling, links and presentation settings, where admitted, remain derived from authorized Store-owned content. They do not change Store identity, catalog values, relation model, marketplace entitlement, public publication eligibility or financial authority. A separate domain is not a separate tenant or another data owner.
- The Partner mobile/web workspace and Operator workspace remain the authorized **management** surfaces. A separate owner-only Store website preview is **not** admitted. The Store owner edits and reviews private draft data in the authorized Partner management forms, while the **same public Store URL** displays only DSH-approved, published facts for both visitors and owners. Draft policy editing remains in Partner management and never alters public visibility until reviewed and published. Do not host a second customer-facing site inside the Partner administrative shell.

#### One mutation, consistent eligible reads

- An authorized Partner or Operator changes a Store, catalog item, offer price, availability, image or approved presentation through its canonical DSH owner and policy workflow, never separately per Client mobile, Client web and Store website. All eligible public channels read the resulting **same committed and publishable fact**. An independent Store's eligible public changes appear on its own website but never cause it to enter the marketplace.
- Channel-specific publication/visibility rules may legitimately show different **subsets** of that common data. Private drafts, withdrawn offers, unpublished media, restricted contact details and unapproved changes must not appear in any public channel, regardless of what another private preview displays.
- The web and mobile read models must revalidate or refresh stale content after applicable changes; invalidation/retry, withdrawn-publication handling, Store and city scoping, and cache isolation are required. This is an expected convergence and security contract, **not** a guarantee of instantaneous push updates on every device. Checkout must independently recheck authoritative publication, relation, offer, price, quantity and availability at confirmation rather than trusting an earlier displayed value.
- Changing the URL, route, website styling, browser platform or client credentials does not choose order semantics. For BTHWANI_PARTNER, any permitted purchase follows the admitted marketplace checkout route. For INDEPENDENT_STORE, public direct checkout is a distinct separately gated DSH flow; it must not silently reuse marketplace cart, delivery, Client membership, WLT wallet or Captain entitlements. A storefront may remain read-only while its own checkout gates are incomplete.
- Existing Store public links must be preserved through approved presentation migration and relation changes, with safe verified redirects for public GET requests where necessary. Do not auto-redirect private data, checkout mutations or Orders. Remove superseded public page compositions only after verified consumer/link cutover, negative authorization tests and marketplace/mobile/web regressions.

**Acceptance boundary:** The architecture above is the approved target, not evidence that the current code, public hosting, publication approval or checkout has shipped. Verify representative published Partner and independent Stores, draft/withdrawal isolation, Store/City/actor switching, shared product/price visibility, responsive RTL/theming, guest entry, stable links and allowed versus forbidden checkout behavior against their actual owner-backed runtime before declaring the transition complete.

### Relation conversion — governed target, not yet activated

An independent-to-Partner conversion requires the Store owner's request, legal eligibility and an explicit versioned commercial agreement matching the approved effective financial policy, accepted by the owner and approved through WLT, followed by DSH-controlled effective relation change and marketplace publication gates. Preserve Store ID, catalog/offer IDs, media, existing direct links, staff grants and historical Orders without duplicating the Store. Existing Orders and WLT entries retain their original transaction snapshots and original terms; in-flight obligations, privacy and outstanding subscription/commission periods require bounded settlement or safe cutover. The opposite conversion similarly requires closing current obligations and prospective checkout rights. Changing only a UI choice or data field is never Partner approval. Actual conversion APIs and end-to-end cutover are not declared implemented by choosing a relation during initial Store creation.

### Publication and rollout boundary

- Marketplace publication requires the existing DSH/Identity/WLT Store-specific gates. An INDEPENDENT_STORE cannot be published or discovered through marketplace APIs, even if a caller spoofs request parameters.
- An independent Store's own web publication and direct Orders require a separately validated DSH-owned path, abuse/legal checks, and distinct Order semantics. They are NOT activated by the initial relation-model schema change.
- Independent storefront pages, slugs, catalog, media, banners and identity are the same Store resources as marketplace pages, with channel-specific navigation and checkout responsibility. No second Store, duplicate catalog, parallel merchant role or shadow financial ledger is admitted.
- No Store may accept new independent and marketplace Orders simultaneously under this initial relation model. The cutover must recheck Store relation at checkout, retain prior Order snapshots and financial duties, and prevent duplicate or retroactive charges.
- INDEPENDENT_STORE may use COMMISSION on eligible direct Store Orders or SUBSCRIPTION, and BTHWANI_PARTNER may use either model, according to WLT's owner-backed policy, accepted Store agreement and actual implementation readiness. This never grants independent marketplace admission or changes collection responsibility. Any trial, free period or grace rule requires a versioned policy; a UI selection cannot activate a subscription or charge before WLT billing, collection, reconciliation and independent approval gates pass.
- A Store's permanent public link must remain available across a legal model change. Route changes use verified safe redirects for public GETs, not redirects of checkout or Order mutations.
- Market publication and independent web publication are distinct facts; no existing Store publication flag may be reused to grant independent public visibility without an explicit owner-backed admission.

### Delivery boundary

This capability is admitted for development. The first technical slice records a fail-closed Store relationship and marketplace publication gate. The next slice permits a verified Partner to choose BTHWANI_PARTNER or INDEPENDENT_STORE when creating their first **unpublished** canonical Store. Older clients default to BTHWANI_PARTNER, preserving deterministic Store IDs and replay. INDEPENDENT_STORE creation must reject BThwani Captain fulfillment. Neither model selection nor Store creation enables independent public web publication, direct Orders, hosting payment, or model conversion. These require separately admitted owner-backed approval, publication, financial and checkout checks with end-to-end proof.

## STORE_OPERATIONAL_AVAILABILITY — Store Operational Availability

CAPABILITY_ID: STORE_OPERATIONAL_AVAILABILITY

### Outcome

A published Store has one DSH-owned operational-orderability truth that distinguishes durable publication and contractually admitted fulfillment modes from whether the Store and each admitted mode can accept a new order now. Partner, Client and authorized Operator surfaces read the same canonical result.

### Ownership

DSH owns Store operating schedule, one-off closure, temporary pause, bounded preparation estimate, current derived Store orderability, current fulfillment-mode availability and canonical readback. Store publication remains owned by `PARTNER_ONBOARDING_STORE_PUBLICATION`; durable fulfillment-mode admission and financial terms are governed through the Store onboarding/commercial-agreement owners; offer availability remains owned by `CENTRAL_CATALOG`; geographic serviceability remains owned by `SERVICEABILITY_ADDRESSES`; checkout confirmation remains owned by `CART_CHECKOUT`.

### Invariants

- `PUBLISHED_STORE`, `CUSTOMER_VISIBLE_OFFER`, `SERVICEABLE`, `DURABLY_ENABLED_FULFILLMENT_MODE` and `STORE_OPERATIONALLY_AVAILABLE` are distinct facts;
- publication never implies that a Store is open for orders now;
- an operational availability control may pause/resume only a fulfillment mode already durably admitted for that Store;
- operational availability can never add a new fulfillment mode or bypass Store Commercial Agreement acceptance/Finance approval when the durable change has financial meaning;
- temporarily pausing/resuming an already admitted mode does not create a new Commercial Agreement version;
- a Store has a versioned weekly operating schedule; an authorized Partner may maintain it for an owned or explicitly granted Store scope;
- DSH may represent a bounded one-off closure or temporary pause with attributable reason and optional end time;
- temporary operational pressure is represented initially by pause/unavailable semantics, not by inventing a numeric capacity engine;
- each admitted fulfillment mode may be temporarily unavailable independently when DSH has a current operational reason; no unavailable mode is silently replaced by another mode;
- a bounded preparation estimate may participate in customer orderability/readback when needed, but predictive queueing or AI preparation-time machinery is not admitted by this capability;
- checkout revalidates current Store and selected-mode orderability before creating an Order;
- Client discovery/readback may show a published Store as closed or paused without deleting or unpublishing the Store;
- an authorized Operator may perform only bounded intervention admitted by current policy; the Operator surface is not a second writer;
- mutations are versioned, attributable, idempotent and converge on canonical DSH readback.

### Minimal state semantics

The exact executable representation belongs to implementation, but current durable meaning must distinguish at least:

```text
OPEN_FOR_ORDERS
CLOSED_BY_SCHEDULE
PAUSED
OPERATIONALLY_UNAVAILABLE
```

Reason and `until` semantics are explicit when applicable. The state is derived from canonical DSH facts rather than authored by Client presentation.

### Failure and recovery

Stale schedule version, duplicate pause/resume, invalid time interval, unauthorized Store scope, attempt to operationally enable an unadmitted mode, conflicting Operator/Partner mutation, offline mutation and ambiguous commit recover through canonical DSH reread. A failed mutation never changes publication, catalog, commercial agreement or serviceability truth as a side effect.

### Material participants

Partner maintains normal Store operating state, Client consumes orderability, Operator may perform bounded authorized intervention, and DSH owns persistence/evaluation/readback.

### Explicit non-goals

This capability does not admit a generic workforce scheduler, numeric Store-capacity engine, mandatory daily check-in, queue forecasting, AI preparation prediction, route optimization, financial-rate mutation or a second Store-publication lifecycle.

## STORE_SCOPED_ACCESS_DELEGATION — Store-Scoped Access Delegation

CAPABILITY_ID: STORE_SCOPED_ACCESS_DELEGATION

### Outcome

An authorized Store owner may invite a canonical Human Actor into bounded Partner-workspace access for one or more owned Stores and grant/revoke an allowlisted set of operational permissions without creating a sixth Identity role, a generic Partner organization, a separate Staff application or a multi-tenant team system.

### Ownership

DSH owns Store-scoped invitation/grant lifecycle, Store scope, allowlisted permissions, acceptance, suspension/revocation and canonical operational readback. Identity owns the Human Actor, verified phone, `partner` role admission, credentials and Partner role-scoped sessions. WLT remains the independent owner of financial authority and may reject delegated financial intent according to Finance policy.

### Surface/session contract

Owners and delegated Store staff use the same Partner application and a `partner` role-scoped session. The role means admitted access to the merchant-side Partner workspace; it does not imply Store ownership. DSH independently authorizes every Store action from Store ownership or an active accepted StoreAccessGrant.

Normal user-facing invitation starts from a phone number, not an `actor_id`, Store code or other technical identifier. DSH/Identity resolve the canonical Human Actor behind that boundary. Resolution must fail closed when the phone does not resolve uniquely to one eligible canonical actor. A UI role preset is only a convenient bundle of bounded DSH permissions; it never becomes a new Identity role or independent RBAC authority.

A Store owner cannot grant the `partner` role directly. The governed path is:

```text
STORE OWNER
→ phone-based Partner-surface invitation
→ DSH resolves canonical Human Actor + requested Store scopes/permissions
→ invitation acceptance
→ DSH establishes Partner-workspace eligibility when required
→ authorized Identity partner-role admission when needed
→ actor activates/authenticates Partner role
→ DSH commits accepted StoreAccessGrant(s)
→ Partner surface exposes only authorized Store scope and functions
```

One owner action may target several owned Stores, but canonical authority remains Store-scoped: the system persists attributable Store grants rather than one opaque organization-wide permission.

### Permission model

The allowlist may include only currently admitted operational responsibilities, including where implemented: Orders, Catalog/StoreOffer, Store operations, promotions, fulfillment/Store-Captain work and bounded financial read/request intents governed by WLT policy.

Permission bundles such as Store Manager, Order Staff, Catalog Staff, Accountant or Delivery Staff are UX presets over this allowlist. Custom selection, when exposed, remains bounded to the same canonical permissions. The user-facing permissions may cover Orders read/manage, Catalog read/manage, Store operations, promotion management, finance read/report, payout-intent request and admitted fulfillment/Store-Captain operations. DSH enforces each grant per Store; WLT independently authorizes financial read and intent against the same Store scope. A payout-intent permission never changes the payout recipient.

The Partner owner alone may assign, change or reconfirm a Store payout recipient. That owner-only routing authority is not a delegable permission and is distinct from the ability to read financial information or request a payout. Team invitation, grant changes, suspension and revocation remain owner-managed in the current scope.

Role presets remain presentation bundles rather than backend authorities. Their normal mappings are bounded: Store Manager receives the admitted operational scopes; Order Staff receives Orders; Catalog Staff receives Catalog and only explicitly granted promotion management; Accountant receives finance read/report and receives payout-intent request only when separately granted; Delivery Staff receives only admitted fulfillment/Orders scopes.

### Invariants

- every canonical invitation/grant references one Store and one canonical actor, even when a user action creates equivalent grants for several Stores;
- a Store grant never creates a new high-level role and never grants access through a Captain/Field/Operator session;
- only the authorized Store owner may create/change/revoke Store staff grants under the current scope;
- the invited actor must accept before delegated authority becomes active;
- normal Partner UX never requires or exposes raw Actor IDs as the invitation mechanism when human-readable identity is available;
- permissions are an explicit finite allowlist, versioned and attributable; a grant cannot self-expand or grant owner-level authority;
- Partner role/session and DSH Store authorization are both required; possession of either one alone is insufficient;
- a delegated actor cannot cross Store scope or mutate another owner's facts;
- aggregate or multi-Store views never weaken object-level Store authorization;
- financial request/approval/execution/reconciliation remain subject to WLT policy and cannot be bypassed by a Store grant;
- revocation/suspension stops future access without rewriting historical actions;
- no generic organization, department, team hierarchy, tenant semantics, shared-owner credential or separate Staff app is introduced.

### Failure and recovery

Unknown, unresolved or ambiguous phone/actor, declined/expired invitation, unauthorized owner, duplicate invitation/grant, stale version, cross-Store request, revoked access, conflicting permission update, interrupted role admission and ambiguous mutation converge on one DSH grant truth plus Identity role/session truth. Retry cannot create a second actor, second effective Store grant or broader permission set.

### Proof boundary

Proof requires phone-based invitation, invitation acceptance, Partner-role activation where needed, positive authorized Store access, negative unrelated/cross-Store access, function-level denial, self-escalation denial, revocation readback, no access through a non-Partner session, no raw Actor-ID dependency in normal UX and preservation of WLT financial boundaries.


### Store owner-created member accounts — approved 2026-10-21

The Store owner creates a bounded member relationship by name, phone, Store scope and permission preset. The canonical Identity actor is created when missing, or reused when present. The owner's display label is not an Identity-verified legal name. Identity provisions a managed Partner role but never gives Store authorization: the member must verify their own phone and accept the DSH Store grant. No routine Operator approval is needed for new owner-created ordinary employees. Earlier pending-operator-admission records retain their recovery path.

The owner can suspend, resume and revoke Store-specific access without taking possession of the person's credentials or changing roles at other Stores. DSH must validate Store ownership and the full permission set before provisioning Identity, and reject unauthorized/cross-Store access on each read and write. WLT's financial recipient controls remain owner-only and independent from delegated finance permissions.
