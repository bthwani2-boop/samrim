# Partner Onboarding Store Publication

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/partner/partner-onboarding-store-publication.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: PARTNER_ONBOARDING_STORE_PUBLICATION

## Scope

This file is the **sole editable durable semantic owner** of `PARTNER_ONBOARDING_STORE_PUBLICATION`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### PARTNER_ONBOARDING_STORE_PUBLICATION

**Problem.** Partner onboarding, first-store readiness, approval and publication must form one governed journey with authenticated actors, server-resolved business scope and explicit Partner/Store ownership instead of disconnected surface-specific records and manual checks. Field-assisted evidence capture and WLT payout setup participate only when the active onboarding policy/commercial model requires them.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** Every mutation is trusted-context derived, Partner/Store scoped, authorization-scoped, concurrency-safe, idempotent, audited and readable on required surfaces.
**Primary success measure.** percentage of submitted partner drafts reaching a governed terminal decision without manual cross-system reconciliation
**Guardrail measures.** zero cross-scope partner, store, document, visit or audit reads/writes; zero stores reassigned between partners outside an explicit transfer journey; zero raw payout account identifiers returned by DSH; zero client-visible stores failing any publication gate; zero duplicate transition audit events for identical retries

**Required outcome.** A partner can be onboarded from an authorized onboarding draft to a client-visible first store through one traceable trusted-context-aware state model. Field-assisted capture is used when policy requires field evidence; operator-managed onboarding may proceed without manufacturing a field task when policy does not. Partner/Store business ownership remains explicit and WLT exclusively owns raw payout details whenever payout setup is applicable.

**Primary actors.** partner-owner, control-operator, client; field-agent when field-assisted onboarding/evidence is required by policy.

**Canonical ownership.** DSH partner/store operational truth; WLT payout-destination truth; Identity trusted context.

**Boundary/non-overlap.** FIELD_OPERATIONS_ASSIGNMENT_READINESS owns field assignment/visit/check/evidence lifecycle. This capability consumes verified field evidence and owns Partner/Store onboarding, activation/readiness decision and store publication eligibility. CENTRAL_CATALOG separately owns taxonomy/master-product/assortment/catalog publication; customer visibility requires all applicable owners to pass.

**Material deployable surfaces.** app-client, app-partner, control-panel; app-field only for onboarding increments/policies that require field-assisted evidence capture.

**Business invariants**
- Every partner/onboarding child record belongs to the authenticated actor and explicit Partner/Store business scope required by the current model.
- One partner may own multiple stores, but one store has at most one onboarding owner unless an explicit transfer model says otherwise.
- Control-panel approval is distinct from field evidence capture.
- WLT is the sole owner of raw payout destination data.
- Client visibility is a store publication outcome, not merely a partner status label.
- Every material transition records the actor, trusted context, business scope, correlation, retry and audit data required by current contracts.

**Forbidden/negative invariants**
- Client-controlled input cannot select or grant trusted business/authorization scope.
- Missing required trusted context cannot silently fall back inside partner handlers.
- One Partner/Store scope cannot enumerate, read, link, mutate or infer another unauthorized business scope.
- A field agent cannot approve their own evidence where separation is required.
- A partner cannot bypass store publication gates.
- A store cannot be reassigned by the generic link operation.
- DSH cannot persist raw payout account data after binding a WLT reference.
- A stale version cannot mutate partner state.
- A reused idempotency key cannot represent a different payload.
- A store failing any applicable publication gate cannot appear to clients.

**Acceptance expectations**
- Business and authorization scope is derived server-side from authenticated identity plus canonical owner facts; browser headers, query parameters and request bodies cannot grant or override it.
- Requests requiring trusted context fail closed when it is absent and do not reach partner persistence.
- Partner lists, details, documents, visits, stores, assignments/scopes, transitions and audit records are read or mutated only within trusted context plus object/business authorization.
- Cross-scope partner/store identifiers do not disclose ownership details.
- Field agents can create, resume, save and submit only assigned or authorized onboarding drafts.
- Submission/publication is blocked until the legal, first-store and other prerequisites applicable to the active onboarding policy are complete.
- A WLT payout reference is required before the first state/financial action whose commercial model actually needs payout-destination truth; it is not a universal store-publication prerequisite for models that create no such payout obligation.
- Documents, field evidence and independent review are required exactly when the active onboarding/publication policy marks them mandatory; missing applicable evidence always fails closed.
- Client publication requires every applicable partner, store, catalog, marketing and serviceability gate.
- A store already owned by one partner cannot be linked to another through the generic onboarding link operation.
- Identical transition and payout retries replay the original result; payload changes under the same idempotency identity are rejected.
- DSH persists and returns only WLT payout references or masked compatibility values allowed by the current contract.
- Partner and control-panel surfaces read back committed activation and readiness state.

**Named failure classes:** trusted context selected from client-controlled input, missing trusted context accepted, cross-scope record disclosure/mutation, raw payout data stored or returned by DSH, store ownership silently changed, publication without all applicable gates, approval without required evidence, payload-divergent retry accepted, surface reports success before committed readback.

**Actor responsibility envelope**
- `field-agent` — When a field-assisted onboarding policy is active, captures and maintains the assigned partner/first-store evidence inside trusted session/assignment scope; permitted: create/edit assigned field-assisted draft, capture first-store profile, upload required documents, submit evidence-bearing visit, submit assigned draft for review; forbidden: approve own evidence, publish store to client, reassign a store owned by another partner, write financial ledger or settlement truth, select or override trusted business/authorization scope. No field task is fabricated when the active policy does not require field evidence.
- `partner-owner` — Reads governed activation, readiness, store scope and team state for the authenticated partner business scope.; permitted: read own activation state, read own readiness, read own store scope, manage authorized store team; forbidden: self-approve onboarding, override store publication gates, read raw payout identifiers from DSH, read another partner or store outside authorized scope.
- `control-operator` — Reviews documents and evidence, links eligible unowned stores, and applies governed activation/publication decisions through exact server-side permissions and business scope.; permitted: review partner documents, read field-visit evidence, link an eligible unowned store, apply allowed partner transitions, read immutable onboarding audit; forbidden: bypass readiness gates, reassign a store owned by another partner, persist raw payout identifiers in DSH, mutate WLT ledger truth, read or mutate records outside authorized business scope.
- `client` — Discovers a store only after all applicable publication gates are satisfied.; permitted: discover client-visible store, read public store profile; forbidden: discover hidden or unready store, read partner-private onboarding data.

**Surface semantics**
- `app-client` — required; actors: client; states: loading, empty, ready, offline, error; actions: discover published store, open public store detail.
- `app-partner` — required; actors: partner-owner; states: loading, blocked, in-review, active, hidden, deactivated, error; actions: read own status, read own readiness, manage authorized team.
- `app-captain` — excluded; states: out-of-scope; exclusion reason: Captain assignment and fulfillment begin in later order/dispatch journeys after store publication.
- `app-field` — conditional; required only when the active onboarding policy/increment requires field-assisted evidence; actors: field-agent; states: blank, draft, saving, conflict, offline, blocked, submitted, error; actions: create draft, save draft, capture store, upload required document/evidence, capture visit, submit for review.
- `control-panel` — required; actors: control-operator; states: loading, empty, ready, forbidden, conflict, readiness-blocked, error; actions: review evidence, link eligible unowned store, apply allowed transition, read audit.
- `backend` — required; actors: field-agent, partner-owner, control-operator, client; states: authorized, trusted-context-required, not-found, forbidden, conflict, readiness-blocked, idempotent-replay, service-unavailable; actions: authenticate, derive trusted context, authorize, validate, persist, audit, handoff to WLT, read back.
- `database` — required; actors: control-operator; states: trusted-context-scoped, business-scope-isolated, consistent, conflict-rejected, single-active-payout, audit-retained; actions: enforce trusted-context scope, enforce Partner/Store ownership, enforce version, enforce idempotency, retain audit.
- technical presentation binding — required implementation evidence; actors: field-agent, partner-owner, control-operator; states: loading, ready, offline, forbidden, conflict, partial, error; actions: map contracts, coordinate mutations, normalize readback, present recovery actions.
