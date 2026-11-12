# BThwani — Human Identity and Access

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/identity.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## IDENTITY_ACTIVATION_SESSIONS — Identity activation and authorized sessions
CAPABILITY_ID: IDENTITY_ACTIVATION_SESSIONS

**Outcome:** Customer, Merchant, Captain and Operator humans have one canonical actor identity, verified session, bounded high-level role and appropriate recoverable authentication lifecycle. HR employee status, Store ownership, Store-affiliated Captain membership, settlement beneficiary and delegated Store authority are *different* bounded facts, not alternative Identity principals.

**Owner:** Identity alone creates/updates accounts, authentication factors, sessions, global role eligibility and platform permissions. DSH alone owns Store memberships, Store access grants, Captain operational availability and Order eligibility. WLT alone owns financial balances, payment instruments and settlement claims. A role is never granted by navigating to a screen.

**Admission and recovery:** Registration/verification, session refresh, suspension, recovery, logout, device change and actor switching have explicit authorized state transitions. A failed or pending authentication step does not silently create a usable role. Never sacrifice Root Owner security or existing users to simulate test success.

**Merchant account:** One authenticated Merchant can create or manage multiple distinct DSH Stores; `MARKETPLACE`/`DIRECT` are Store choices, not global actor roles. The same Customer identity accesses eligible marketplace and full Store Web views without duplicate Customer accounts.

**Operator:** Policy modification requires Identity-authenticated `operator` plus `platform_policies` and additional `finance`, `partners`, `operations` or other scope as required by the canonical owner. Client-side menus and BFF permission checks are defense in depth; each actual DSH/WLT owner operation independently verifies authority, request scope and actor attribution. Root Owner exceptions are narrow, explicit, audited and separately reviewed; they do not silently grant permanent privileges.

**Sessions and isolation:** A context switch, permission revocation, logout or stale async response must never expose previous actor/Store's money, private orders, files or administrative state, including while pending GET/POST or during delayed failure recovery. All UI caches and policy previews are scoped to the verified Identity session; server-side authorization never trusts UI state, old scopes or supplied actor headers alone.

**Failure and proof:** Unauthorized actor, expired session, Store IDOR, revoked grant, cross-city access, forged actor header, stale cache and concurrent permission change all fail safely. Prove with two real distinct actors/Stores and canonical Identity/DSH/WLT reads, not only hidden buttons or a mocked HTTP response. Keep privacy-safe evidence and avoid exporting secrets.

## Operator authentication and policy-control admission

For the present approved Operator security model, **normal Operator login requires user-verified WebAuthn/Passkey**. Password-only Operator login and SMS as ordinary Operator MFA are not substitutes. The first privileged Operator is created by a protected **one-time bootstrap**; normal subsequent Operator admission proceeds through authorized current Operators. Recovery is a separately controlled break-glass enrollment with bounded proof, authenticator/session revocation and full audit. An Operator cannot self-reactivate a suspended, disabled or already-provisioned actor through ordinary registration.

`platform_policies` is one **Identity-owned permission**, not a new high-level role. The bootstrapped first Operator holds its administrative grant/revoke authority; a subsequently admitted Operator receives no policy-change permission by default. Grant and revocation require current authority, reason, version and audit and invalidate affected sessions. Each policy owner checks both active authenticated Operator and scoped permission at the mutation boundary; financial mutation additionally requires the actual Finance authority. Operator read access, financial execution, approval and reconciliation must remain separately authorized.

A phone number is a **mutable verified attribute**, never the canonical cross-service actor ID. A verified official Identity name is not interchangeable with a temporary merchant display label or beneficiary name supplied in a form. Identity handles host/domain-scoped session issuance and revocation for Customer public Store Web versus marketplace surfaces; one human identity does not imply browser cookies can be shared freely across public hosts. Public permitted Store/Offer browsing may be guest-accessible, but protected ordering, history and payment require current appropriate authorization.

New actor provisioning must not create duplicate identities when a verified phone already belongs to an eligible actor; the original owner is authoritative. This governs Merchant member invitations and Store-Captain invitations without allowing the owner to impersonate a member or approve their identity proof.

## Finite Operator workspace permissions and session hardening

The admitted bounded Operator permission scopes are **`operations`, `partners`, `catalog`, `marketing`, `finance`, `hr`, `platform_policies`**. The initial bootstrapped Operator is the access administrator and receives registered scopes; subsequent Operators receive none automatically. Scope grants/revocations are reasoned, expected-version-checked, audited and require existing privileged administration. The `operator` role alone never confers blanket access. `operations` does not grant financial execution, `hr` does not grant Operator admission, and `finance` does not allow beneficiary redirection without an independent authorized Store owner decision.

A single Human Actor may have multiple roles, but role credentials/sessions and suspension follow the actual admitted Identity lifecycle. Disable for one role must not automatically destroy unrelated roles unless an Identity-wide security action is justified. Refresh tokens rotate atomically; a confirmed refresh replay compromises/revokes that session family, not an unlimited impersonation fallback. Verification challenges are single-purpose, attempt/expiry/replay bounded, and public authentication should not enumerate eligibility or identity records.

An Order recipient may be **different from the purchasing Customer**. Recipient contact is an Order delivery snapshot and never becomes a new Identity account, purchasing/payment principal or authority to access the customer's wallet/history.


## Root Operator continuity and credentialless historical recovery

The archived 2026-10-29 recovery report records an **original Operator who lacked a registered Passkey and registered recovery credential**, while an isolated old local development login could still be exercised. This report is **historical evidence only**, not proof of today's production credentials or access readiness. Do not solve this by creating a second Root Owner, silently inserting WebAuthn data, copying credentials between databases, disabling protected login checks or treating an HTTP 200 as actual authenticated recovery.

During the later Identity refoundation, establish one protected original-actor continuity and break-glass recovery protocol: confirm exact Identity subject and current registered credentials from its authoritative source; use a strictly local/isolated existing development authentication mode **only where explicitly configured and authorized**; require actual user-verified Passkey enrollment and durable credential readback, backup/recovery planning, session-family revocation and independent security review before claiming secure recovery or retiring a legacy local route. Local development passwords must never become a remotely accepted Operator login or appear in documentation, test output, CI artifacts, web URLs or chat. A supported user-facing recovery must keep previously lawful actor ownership and Store/Finance attribution intact across any migration.

Status for actual recovery, present Operator privileges, enrolled credentials and protected database upgrade: **NOT_RUN** in this governance-only candidate.
