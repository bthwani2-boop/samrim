# BThwani — Human Identity and Access

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/identity.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

## IDENTITY_ACTIVATION_SESSIONS — Identity activation and authorized sessions
CAPABILITY_ID: IDENTITY_ACTIVATION_SESSIONS

Identity alone owns human actor identity, verified contact, authentication factors, role eligibility, sessions and platform permissions. One person may hold several separately authorized roles; employment, Store affiliation, resource delegation, operational standing, beneficiary and delivery recipient are distinct facts. DSH owns its Store/employment/standing and Order facts; WLT owns financial balances, instruments and claims. No employee-specific identity, UI-derived role or second account for another presentation of the same Customer.

A phone number is a mutable verified attribute, never the canonical actor identifier. Official verified Identity names are distinct from Store display labels, temporary names and beneficiary data. Reuse the eligible canonical actor when the verified phone already exists; invitation and assisted provisioning cannot impersonate that person or approve their verification.

### Role admission

- A verified eligible Customer may directly first-register the Merchant workspace role without an existing Store or prior Operator case. This does not grant any Store right. Already-provisioned, disabled or suspended roles cannot self-reactivate through first registration. A Merchant may manage several separately authorized Stores; MARKETPLACE/DIRECT are Store choices, not actor roles.
- For invited Store staff, DSH validates an accepted scoped Store grant before requesting necessary Identity admission. Before requesting removal of standing Merchant-workspace eligibility, DSH checks whether any valid ownership or accepted grant remains. Revocation cannot silently rebind an actor or destroy unrelated authorized roles.
- For Captains, current DSH-approved operational standing precedes the authorized Identity role request; it is not a dispatch assignment. PENDING grants no delivery or Captain-role authority. A relevant merchant/operations Operator may initiate a Merchant invitation or Captain candidate only within actual authorization; the human proves their own Identity. Guest interest is not a standing application or role grant; [fulfillment](fulfillment.md) owns the candidate/standing distinctions and admitted entry flows. A later Product restriction on application origins requires consumer reconciliation without relaxing owner approval.
- Operator admission follows the protected authority and HR request protocol below. No client, BFF, Store owner, job title or unrelated Operator may create a role through a display or local state.

Any legacy role identifier transition requires the reviewed compatibility contract and preserved actor/role identity.

### Session lifecycle and presentation

Registration/verification, refresh, suspension, recovery, logout, device change and context switching have explicit owner-authorized transitions. Pending or failed proof cannot silently produce an admitted role. A role-specific suspension does not destroy unrelated roles unless justified by an Identity-wide security action. Refresh credentials rotate atomically; confirmed replay revokes/compromises the affected session family, never enables impersonation. Verification challenges are purpose/expiry/attempt/replay bounded and public responses avoid eligibility/identity enumeration.

Identity owns host/domain-scoped issuance, renewal, logout and revocation for public Store Web and marketplace. One actor does not imply freely shared cookies between public hosts. An admitted cross-domain handoff never puts access/refresh credentials in Store URLs, cross-origin storage, Merchant-authored scripts or untrusted redirects. Guests may browse permitted Store/Offer facts; protected Order, history and payment require current authority. Merchant/delegated staff read only Order/customer facts needed for their actual current authorized Store assignment, never unrelated orders or Customer balance/session data. A delivery recipient is a DSH Order contact snapshot, not a purchasing/payment principal or access to Customer wallet/history.

Context switches, logout, revoked grants, stale asynchronous requests and delayed failure recovery must not expose previous actor/Store money, orders, files or administrative facts. Scope caches and pending operations to the verified session; server-side authority never trusts old scopes, caller headers or UI state. See [safety](safety.md).

Public authentication presentation exposes only actions appropriate to the actual verified or pending admission state; no decorative protected tabs or simulated disabled workspace navigation. Real protected navigation mounts only after owner-backed role and required resource-scope checks. Developer inspection must not obstruct authentication or bypass authority. Web/native may adapt layout while retaining the same accessible admission, action and failure semantics.

## Operator authentication and policy-control admission

Normal Operator login requires user-verified WebAuthn/Passkey; password-only login and SMS as ordinary Operator MFA are not substitutes. The original privileged Operator is established once by protected bootstrap. Subsequent new Operator admission originates in the canonical company HR access request under [HR law](hr.md); the protected initial privileged Operator alone approves/rejects the request and issues/revokes invitations or approves the permitted grants through Identity. An authorized HR Operator may submit a request, not grant access. Preserve existing lawfully admitted legacy accounts; do not silently convert or delete them. A suspended, disabled or already-provisioned Operator cannot self-reactivate through ordinary registration.

Recovery uses separately controlled break-glass enrollment, bounded proof, authenticator/session revocation and audit; it is not a parallel ordinary login path. Root Owner exceptions remain narrowly authorized, explicit, attributable and reviewed under the actual risk requirements, never permanent bypass.

Policy mutation requires current Identity-authenticated operator, platform_policies and the additional applicable finance, merchant, operations or other owner scope. Actual DSH/WLT independently validate actor, scope and attribution at the mutation; menus/BFF guards are defense in depth. Financial execution, approval, reconciliation and read access are distinct authorizations.

## Finite Operator workspace permissions and session hardening

The original bootstrapped Operator is the access administrator and holds the registered scopes. New Operators receive no automatic workspace permission. Only that original active Operator can grant or revoke a registered scope to another currently enabled Operator, with reason, expected version, durable audit and invalidation of affected sessions. No scope delegates this administrative power.

| Scope | Bounded authority |
| --- | --- |
| operations | Authorized Order handling and Captain administration; no WLT financial execution |
| merchant | Merchant admission, status and directory; no Store ownership or Store-resource grant |
| catalog | Shared Product/category/attribute administration, catalog proposals and imports under DSH ownership and actual resource scope |
| marketing | Promotions/discovery content; no Identity or financial powers |
| hr | Bounded employee administration and HR audit readback; no Operator admission or permission administration |
| finance | Finance workspace; actual WLT effect requires independent financial authority; no beneficiary redirection without the authorized Store owner decision, no permission administration |
| platform_policies | Owner-backed policy mutation with the applicable additional scope; no change to immutable financial, security or legal invariants |

Leadership remains a read-oriented center, not a new write scope; sensitive reads require actual owner permission. The operator role alone grants no blanket authority. Access administration is not delegated by finance, platform_policies or any other workspace scope. These definitions are not implementation proof.

## Root Operator continuity and credentialless historical recovery

The archived 2026-10-29 report describes an original Operator lacking registered Passkey and recovery credentials, with an isolated old local-development login exercised. That is historical evidence, not proof of current production credentials. Do not create a second Root Owner, silently insert WebAuthn data, copy credentials between databases, disable login checks or infer authentication from HTTP 200.

Progressive recovery preserves the exact original Identity subject and lawful Store/Finance attribution. Confirm current authoritative credentials; use an existing isolated local development authentication mode only where explicitly configured and authorized. Require actual user-verified Passkey enrollment, durable credential readback, backup/recovery planning, session-family revocation, attributable internal risk assessment and genuine negative access/recovery verification before claiming secure recovery or retiring a legacy route. Local development passwords must never become remotely accepted Operator authentication or enter docs, CI artifacts, tests, URLs or chat.

## Acceptance

Prove applicable unauthorized/expired/revoked/forged actor, Store IDOR, cross-city access, stale cache and concurrent permission-change rejection using real distinct actors/Stores and canonical Identity/DSH/WLT readback. Protect Root Owner, existing users and privacy-safe evidence; hidden buttons, mocks and HTTP health do not establish owner authority. Protected original-actor recovery, current privileges, credential enrollment and protected database upgrade remain NOT_RUN unless demonstrated on the actual owner runtime. No extra reviewer staffing requirement substitutes for proof.
