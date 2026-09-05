# Representative Wallets Reference Finance

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/finance/representative-wallets-reference-finance.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: REPRESENTATIVE_WALLETS_REFERENCE_FINANCE

## Scope

This file is the **sole editable durable semantic owner** of `REPRESENTATIVE_WALLETS_REFERENCE_FINANCE`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### REPRESENTATIVE_WALLETS_REFERENCE_FINANCE

**Problem.** Client, partner, captain and field actors need one authenticated actor-scoped read-only view of their WLT-owned wallet, balances and ledger references through DSH BFF, while finance operators need exact permission-scoped lookup without transferring financial ownership to DSH or any frontend.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** All actor surfaces use canonical Identity and actor/authorization-scoped DSH reads backed by WLT financial truth.
**Primary success measure.** actor-scoped and permission-scoped wallet and ledger read coverage across required surfaces
**Guardrail measures.** unauthorized financial disclosure count; cross-actor wallet disclosure count; frontend direct WLT financial read count; DSH wallet balance mutation path count; hardcoded actor identifier count; route-contract drift count

**Required outcome.** Every representative sees an authenticated actor-bound WLT-owned wallet and permission-scoped ledger view through DSH, while operators can inspect supported wallets and matching ledgers only within server-authorized actor/business scope without any DSH or frontend balance mutation path.

**Primary actors.** client, partner, captain, field, operator.

**Canonical ownership.** This is a durable read-access capability with no financial writer of its own: WLT owns financial truth, DSH owns the application-facing projection/facade, and Identity owns trust context.

**Responsibility classification.** DERIVED_PROJECTION_READ_MODEL with durable multi-surface outcome; never a financial mutation authority.

**Material deployable surfaces.** app-client, app-partner, app-captain, app-field, control-panel.

**Business invariants**
- WLT is the sole owner of wallet and ledger truth.
- DSH is an authenticated and authorized application facade only.
- Identity resolves authenticated actor/session trust; each domain owner resolves its own authorization/business scope.
- Every self-service wallet read is scoped to the resolved actor.
- Ledger history is append-only financial evidence.

**Forbidden/negative invariants**
- No DSH table or handler mutates representative wallet balances.
- No frontend calls internal WLT financial routes directly.
- No user-facing surface supplies an arbitrary self-service actor id or trusted authorization scope.
- No operator lookup crosses the exact server-authorized actor/business scope.
- No settlement summary is labeled as a wallet balance.
- No read permission authorizes a money-moving action.

**Acceptance expectations**
- WLT accepts only supported wallet actor types.
- DSH derives self-service actor identity from the authenticated session and authorization/business scope from canonical server-side owner facts, never from client-controlled input.
- Client partner captain and field have canonical own-wallet and own-ledger routes.
- Control-panel lookup requires `finance.read` and server-side authorization for the requested actor/business scope.
- WLT repositories scope by canonical financial ownership and authorized actor/business scope before returning actor-linked wallet or ledger data.
- Cross-context wallet and ledger reads fail closed without disclosure.
- Balances are rendered from WLT without local derivation.
- No DSH or frontend route writes wallet balances or appends ledger truth for this journey.
- Human-facing surfaces represent loading empty partial forbidden offline error and retry states.

**Named failure classes:** cross_context_read, cross_actor_read, unsupported_actor, hardcoded_actor, direct_wlt_browser_call, local_balance_derivation, wallet_mutation_in_dsh, missing_permission, missing_context, stale_financial_display.

**Actor responsibility envelope**
- `client` — Authenticated customer reading only their own actor-bound wallet and ledger references; permitted: read own wallet status, read own available pending and held balances, read own ledger references, refresh; forbidden: select another actor id, grant authorization scope, mutate balance, append ledger entries, call WLT directly.
- `partner` — Authenticated partner reading only their own actor/business-scoped wallet and reference finance; permitted: read own wallet, read own ledger references, read own settlements commissions and payouts, refresh; forbidden: derive wallet balance from settlements, use a hardcoded partner id, grant authorization scope, mutate balance in DSH, read another partner wallet.
- `captain` — Authenticated captain reading their actor-scoped wallet, earnings references, payouts and COD liability; permitted: read own wallet, read own ledger references, read own commissions and payouts, submit governed payout request, perform authorized COD handoff actions; forbidden: read another captain wallet, cross authorized financial scope, mutate balance, complete payout locally, call a provider directly.
- `field` — Authenticated field actor reading their actor-scoped wallet, commissions, ledger and payout requests; permitted: read own wallet, read own commissions, read own ledger references, read and submit own payout requests, refresh; forbidden: supply beneficiary identity, grant authorization scope, request more than available balance, mutate wallet balance, read another field actor wallet.
- `operator` — Permission-scoped finance operator reading representative wallets and ledger references only within exact server-authorized actor/business scope; permitted: lookup a supported actor wallet when authorized, filter ledger by an authorized actor, inspect reference commissions settlements and payouts, audit correlation and update timestamps; forbidden: lookup without `finance.read`, supply or override trusted authorization scope, read outside authorized financial scope, mutate wallet balance, use read permission for a money-moving action, treat DSH as financial truth owner.

**Surface semantics**
- `app-client` — required; actors: client; states: loading, success, empty, suspended, frozen, offline, forbidden, error; actions: refresh, inspect ledger.
- `app-partner` — required; actors: partner; states: loading, success, empty, suspended, frozen, offline, forbidden, error; actions: refresh, inspect ledger, open settlement reference.
- `app-captain` — required; actors: captain; states: loading, success, empty, suspended, frozen, offline, forbidden, error; actions: refresh, inspect ledger, inspect COD, request payout.
- `app-field` — required; actors: field; states: loading, success, empty, partial, suspended, frozen, offline, forbidden, validation_error, error; actions: refresh, inspect ledger, inspect commissions, submit payout request.
- `control-panel` — required; actors: operator; states: idle, loading, success, empty, partial, not_found, forbidden, invalid_actor, offline, error; actions: select actor type, enter actor id, lookup, inspect ledger, refresh.
- `backend` — required; actors: client, partner, captain, field, operator; states: authenticated, authorized, authorization_scope_resolved, unsupported_actor, not_found, wlt_unavailable, success; actions: resolve identity, resolve canonical owner scope, scope actor, authorize, proxy read, propagate correlation, fail closed.
- `database` — required; actors: operator; states: authorization_scope_isolated, unique_actor_wallet, append_only_ledger, currency_bound, auditable; actions: enforce authorized actor/business-scope lookup, enforce actor uniqueness, preserve ledger lineage, prevent duplicate payout requests.
