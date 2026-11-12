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
