# Financial Capabilities

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/finance.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md

## Scope

This owner defines only the durable capability semantics listed in this file. Cross-cutting capability schema/admission rules are owned by `../CAPABILITIES.md`; journeys remain owned by `../JOURNEYS.md`.

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

### SETTLEMENTS_COMMISSIONS

**Problem.** Partner settlements and representative commissions require one auditable WLT-owned financial lifecycle backed by durable DSH operational evidence, versioned policies, deterministic calculation, explicit adjustments and read-only multi-surface readback.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** WLT owns one evidence-backed idempotent settlement and commission lifecycle with policy versions, refund-aware calculation, adjustments, audit and scoped readback.
**Primary success measure.** verified evidence to canonical settlement or commission readback rate
**Guardrail measures.** caller supplied financial amount count; duplicate source settlement count; unverified completion evidence count; completed refund omitted from settlement count; commission without policy version count; reasonless adjustment count; negative wallet bucket count; cross-actor read count; unbalanced ledger transaction count

**Required outcome.** Every settlement and commission is deterministically calculated by WLT from durable evidence and a retained policy version, every adjustment has a reason and balanced financial effect, and every required surface reads only canonical scoped references.

**Primary actors.** partner, captain, field, finance_operator, dsh_service, wlt_service.

**Canonical ownership.** WLT financial truth; DSH provides operational evidence.

**Boundary/non-overlap.** SETTLEMENTS_COMMISSIONS owns earning/commission calculation, policy-version application and settlement/commission lifecycle. WLT_MONEY_MOVEMENT_PAYOUT_RECONCILIATION owns common wallet/ledger money movement, Cash-In/COD/payout execution and reconciliation primitives; the same financial fact may not be independently mutable in both capability implementations.

**Material deployable surfaces.** app-partner, app-captain, app-field, control-panel.

**Business invariants**
- WLT exclusively owns settlement commission wallet ledger refund and adjustment truth.
- DSH exclusively owns operational completion cancellation order store visit and representative evidence.
- Every financial mutation carries service authentication correlation and idempotency.
- Every visible success is read back from WLT or a governed DSH application projection backed by WLT.
- Every policy change and adjustment is append-only auditable.

**Forbidden/negative invariants**
- No DSH or frontend code calculates authoritative settlement fees or commission amounts.
- No caller supplied monetary value becomes commission truth.
- No completed refund remains in the payable settlement basis when policy requires its exclusion.
- No cancelled or unverified source is settled.
- No idempotency key represents different inputs.
- No wallet balance violates current financial invariants.
- No actor reads another actor financial detail.

**Acceptance expectations**
- DSH sends operational identities and immutable evidence only; it never sends an authoritative fee, settlement amount or commission amount.
- WLT verifies operational evidence and its own refund truth before calculation.
- A deterministic idempotency key cannot create duplicate financial effects for the same evidence.
- Every settlement and commission retains the exact policy version used for calculation.
- Every commission amount is calculated by the applicable WLT policy and is never accepted from an untrusted caller.
- Lifecycle transitions enforce legal source states and balanced wallet or ledger effects.
- Every deduction or adjustment is reasoned, operator-attributed and auditable.
- Partner captain and field reads are actor-scoped and mutation-free.
- No runtime mock fixture local financial calculation or duplicate financial truth owner remains.

**Named failure classes:** caller supplied amount, unverified evidence, cancelled source settled, completed refund ignored, duplicate settlement, duplicate commission, missing policy, stale policy ambiguity, reasonless adjustment, negative wallet bucket, cross-actor financial read, unbalanced ledger, frontend-only success.

**Actor responsibility envelope**
- `partner` — Authenticated partner viewing only its WLT settlement and commission references; permitted: read own settlement cycles, read own deductions and adjustments, read own commission references, refresh canonical WLT readback; forbidden: calculate commission locally, post or reverse a settlement, change a financial policy, read another partner financial record.
- `captain` — Authenticated captain viewing only personal commission lifecycle and adjustment reasons; permitted: read own commissions, read own pending confirmed settled rejected and reversed states, refresh canonical readback; forbidden: submit an amount, confirm settle reject reverse or adjust a commission, read another beneficiary record.
- `field` — Authenticated field representative viewing only personal visit commission lifecycle; permitted: read own visit commissions, read policy-derived amount and adjustment reasons, refresh canonical readback; forbidden: submit an amount, change visit evidence, mutate a commission state, read another representative record.
- `finance_operator` — Authorized control-panel operator managing policies and governed financial lifecycle actions; permitted: create or update a versioned policy with reason, initiate a settlement from DSH evidence, confirm reject settle or reverse an eligible commission, create a reasoned adjustment, read audit and reconciliation references; forbidden: supply settlement or commission truth amounts, approve an action created by the same actor where maker-checker applies, erase audit evidence, bypass mutation or service authentication gates.
- `dsh_service` — Operational truth owner providing durable completion and cancellation evidence; permitted: deliver immutable order and visit evidence, carry correlation and idempotency identifiers, proxy authorized read-only references; forbidden: calculate a WLT fee or commission, write WLT tables, declare refund completion, send mutable or unverifiable evidence.
- `wlt_service` — Sole financial truth owner for policy application settlement commission wallet ledger adjustment and audit; permitted: verify DSH evidence, verify WLT refund truth, calculate governed amounts, post balanced ledger effects, retain policy and adjustment versions, return canonical readback; forbidden: trust caller supplied financial amounts, settle unverified evidence, allow negative wallet buckets, reuse an idempotency key for different inputs.

**Surface semantics**
- `app-partner` — required; actors: partner; states: loading, empty, success, pending, settled, rejected, reversed, forbidden, offline, partial, error; actions: refresh, inspect cycle, inspect adjustment reason.
- `app-captain` — required; actors: captain; states: loading, empty, success, pending, confirmed, settled, rejected, reversed, forbidden, offline, error; actions: refresh, inspect commission, inspect adjustment reason.
- `app-field` — required; actors: field; states: loading, empty, success, pending, confirmed, settled, rejected, reversed, forbidden, offline, error; actions: refresh, inspect visit source, inspect adjustment reason.
- `control-panel` — required; actors: finance_operator; states: loading, empty, success, draft, active, inactive, pending, confirmed, settled, rejected, reversed, forbidden, conflict, offline, error; actions: create policy version, initiate settlement, confirm, settle, reject, reverse, adjust, inspect audit.
- `backend` — required; actors: finance_operator, dsh_service, wlt_service; states: authorized, forbidden, invalid, conflict, pending, confirmed, settled, rejected, reversed; actions: authenticate, validate evidence, calculate, enforce idempotency, post ledger, audit, read back.
- `database` — required; actors: wlt_service; states: versioned, immutable, idempotent, balanced, auditable, trusted-context-scoped; actions: enforce uniqueness, retain evidence, retain reasoned adjustment, prevent negative amount, retain policy version.
- technical presentation binding — required implementation evidence; actors: partner, captain, field, finance_operator; states: idle, loading, empty, success, forbidden, conflict, offline, partial, error; actions: map canonical states, classify errors, disable duplicate actions, refresh canonical readback.

### WLT_MONEY_MOVEMENT_PAYOUT_RECONCILIATION

**Problem.** BThwani needs one governed financial capability that preserves WLT-owned internal wallet truth while safely connecting official-wallet Cash-In, captain COD exposure, stakeholder earnings and governed external settlements without duplicate money movement, parallel ledgers, unverifiable completion, beneficiary-controlled payout master data or manual authoritative financial arithmetic.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** Cash-In, payment allocation, captain COD, stakeholder earnings, destination master data, payout eligibility, governed manual external settlement, evidence, reconciliation and financial close use one WLT-owned financial truth.
**Primary success measure.** share of financial movements with complete automatically derived WLT ledger lineage and required external evidence and reconciliation lineage
**Guardrail measures.** beneficiary financial-master-data mutation path count; manual authoritative monetary override path count; unverified-destination payout count; duplicate financial effect count; unreconciled completed payout count; direct balance mutation path count; ambiguous-provider duplicate attempt count; blocking finance exposure at close; cross-context financial disclosure count

**Required outcome.** Every money movement and stakeholder financial view is derived from trusted operational events and approved WLT policy, attributable to one WLT-owned wallet and ledger truth and, where external money moves, to one authoritative provider or governed manual-settlement evidence chain through reconciliation and close.

**Primary actors.** client, captain, partner, field, finance-operator, system.

**Canonical ownership.** WLT financial truth; DSH application facade; Identity trust context.

**Boundary/non-overlap.** WLT_MONEY_MOVEMENT_PAYOUT_RECONCILIATION owns common wallet/ledger movement, Cash-In/COD, payout execution and reconciliation. Commission/settlement calculation policy and its evidence-derived lifecycle remain in SETTLEMENTS_COMMISSIONS; shared ledger primitives do not create two writers for the same posting.

**Material deployable surfaces.** app-client, app-captain, app-partner, app-field, control-panel.

**Business invariants**
- WLT is the sole internal financial truth owner and every value-changing movement is represented by the canonical double-entry ledger.
- Authoritative monetary values are system-derived from trusted events and versioned policy; human actions express governed intent or evidence, not accounting arithmetic.
- Official external wallets move external money but do not own internal BThwani balances, liabilities or settlement state.
- There is one internal wallet per actor and one canonical payout engine for partner, captain and field.
- Payout destination data is read-only on beneficiary surfaces and controlled as WLT-owned Finance master data.
- Order payment composition and COD exposure are server-owned financial facts.
- The current production Cash-Out model is governed manual external official-wallet settlement; automated payout requires a separately approved capability.
- Unknown or conflicting external outcomes remain reconcilable until authoritative evidence resolves them.

**Forbidden/negative invariants**
- No DSH or frontend component writes WLT balances or ledger truth.
- No beneficiary surface mutates official-wallet destination master data.
- No client or finance surface directly supplies an authoritative earning commission fee balance hold payable settlement total or full-payout amount.
- No provider name determines the internal ledger account or stakeholder entitlement.
- No screenshot spreadsheet or unverified file row creates financial success.
- No unverified or silently changed destination receives payout.
- No frozen batch or approved payout snapshot is edited in place.
- No second provider is invoked for the same ambiguous external mutation before reconciliation.
- No legacy COD custody/remit path and captain-wallet debit path both account for the same order value.
- No daily financial close hides unresolved blocking exposure or mismatched control totals.

**Acceptance expectations**
- WLT remains the sole writer of wallet balances, ledger transactions, payments, refunds, commissions, payouts, settlements and reconciliation truth.
- Authoritative monetary values are derived server-side from trusted events, canonical state and versioned policy; no beneficiary or finance UI directly overrides them.
- Each actor has one canonical internal WLT wallet; held pending earned settled and withdrawal-eligibility values are states or projections, not parallel wallets.
- Cash-In credits an internal wallet only after authoritative provider evidence is verified and normalized.
- Mock or sandbox provider behavior cannot be selected as a production fallback.
- Every applicable order has one server-owned payment allocation that conserves the governed order total and prevents duplicate delivery-fee treatment.
- Captain COD authorization is order-specific, atomic and idempotent; cancellation releases once and finalization debits once.
- The current captain-funded COD path cannot simultaneously create a second remittance liability for the same order value; any alternate custody model requires a separately approved Product/financial governance decision.
- Customer withdrawal and cash-out of externally funded principal remain disabled unless a separately approved product, legal and financial policy enables them.
- Partner, captain and field payouts use one WLT-owned payout engine with stakeholder-specific eligibility expressed as policy rather than separate ledgers.
- Beneficiary surfaces expose payout destination information read-only and cannot create, update, deactivate, replace or select destination master data.
- Official-wallet destination master data is WLT-owned, versioned, encrypted and masked; only an independently verified active version is eligible for payout.
- Beneficiary payout intent contains only amount mode, optional specified amount, and idempotency context; WLT resolves beneficiary, eligible funds and current verified destination transactionally.
- Approved payout facts and frozen settlement batches are immutable; later destination changes cannot rewrite them.
- The current production Cash-Out model is governed manual external official-wallet settlement; automated payout requires a separately approved capability.
- Manual external execution records required reference and evidence and cannot expose a bare mark-paid transition.
- Final completion requires agreement between approved payout, frozen batch row, execution evidence and authoritative external statement; mismatch creates a blocking reconciliation exception.
- Financial separation of duties is enforced server-side according to active policy.
- Legitimate adjustments are typed governed WLT events with reason, evidence and authorization; there is no direct balance edit or generic monetary override.
- Blocking finance exceptions, missing required evidence, control-total mismatch or unresolved material reconciliation exposure prevent affected completion.
- Refund routing follows the authoritative original money source unless an explicit product policy states otherwise.
- An ambiguous external mutation result is reconciled before any new provider or route attempt can move the same money again.
- External official-wallet account balances are treasury control facts and never a second internal wallet ledger.

**Named failure classes:** parallel_financial_truth, direct_balance_mutation, manual_authoritative_financial_value, beneficiary_destination_mutation, beneficiary_selected_destination, client_asserted_success, client_computed_full_payout_amount, payment_allocation_mismatch, delivery_fee_double_count, cod_overcommit, cod_double_effect, unverified_destination, approved_snapshot_mutation, frozen_batch_mutation, bare_mark_paid, duplicate_external_reference, ambiguous_result_retried_elsewhere, unreconciled_completion, spreadsheet_as_truth, self_approval_bypass, blocking_exception_ignored, mock_in_production, source_unaware_refund, financial_close_with_unresolved_exposure.

**Actor responsibility envelope**
- `client` — Customer funding or paying through supported WLT-governed payment paths and reading only owned internal financial state.; permitted: create governed Cash-In intent, use supported order payment allocation, read own internal wallet and ledger references; forbidden: assert top-up success, directly mutate wallet balance, select provider credentials, supply authoritative financial totals, withdraw internal balance unless a separately approved capability permits it.
- `captain` — Captain using one WLT internal wallet for approved funding, order-specific COD exposure, automatically derived earnings and governed settlement requests.; permitted: top up through approved Cash-In, accept financially authorized COD assignment, receive governed earnings, read masked current official-wallet destination state, request eligible payout as FULL_AVAILABLE or SPECIFIED, read own wallet and ledger; forbidden: accept uncovered COD exposure, mutate COD reserve or balance locally, create or edit earning amount, create update deactivate or select payout destination, treat future earnings as existing COD capacity, assume visible balance is fully withdrawable, complete external settlement locally.
- `partner` — Partner receiving WLT-calculated governed proceeds and requesting settlement to the current server-resolved approved official-wallet destination.; permitted: read own wallet and settlement references, read masked current official-wallet destination state, request eligible payout as FULL_AVAILABLE or SPECIFIED; forbidden: create update deactivate or select payout destination, select an arbitrary external provider, activate an unverified destination, supply authoritative payable totals, edit an approved payout snapshot, mark settlement paid.
- `field` — Field actor receiving automatically derived governed commissions and requesting eligible settlement to the current server-resolved approved official-wallet destination.; permitted: read own commissions and wallet, read masked current official-wallet destination state, request eligible payout as FULL_AVAILABLE or SPECIFIED; forbidden: self-create or edit commission value, create update deactivate or select payout destination, activate an unverified destination, request more than server-owned withdrawal eligibility, complete external settlement.
- `finance-operator` — Permission-scoped operator reviewing automatically calculated financial truth and performing governed master-data, approval, execution, evidence, reconciliation and close transitions assigned to the role.; permitted: initiate governed official-wallet destination provisioning or change, verify or approve destination according to separation-of-duties policy, prepare or review payout according to role, freeze approved settlement batch, execute assigned manual transfer, record execution reference and evidence, reconcile authoritative external statement, resolve governed finance exception, close a business date only when gates pass; forbidden: directly edit wallet or ledger balances, manually override authoritative monetary truth, change destination master data without governed reason evidence authorization and approval, change approved beneficiary destination or amount in place, use a bare mark-paid transition, silently bypass separation of duties, treat spreadsheets or screenshots as financial truth, close blocking unresolved exposure.
- `system` — WLT-owned financial engine, provider adapters, reconciliation and policy enforcement producing canonical automatic ledger, payout and audit truth from trusted operational events and approved policies.; permitted: derive payment allocation, derive earnings commissions fees holds balances and withdrawal eligibility, reserve release and finalize governed COD exposure, resolve current verified active payout destination, resolve FULL_AVAILABLE and validate SPECIFIED payout amount transactionally, normalize authoritative provider evidence, post double-entry ledger transactions, enforce idempotency and legal state transitions, create reconciliation exceptions, enforce financial close gates; forbidden: route an ambiguous money mutation to a second provider before the first outcome is authoritative, credit from client claims or screenshots, trust client or operator supplied financial totals over canonical events and policy, use mock or sandbox as production fallback, create parallel provider or stakeholder ledgers, silently mutate historical financial evidence.

**Surface semantics**
- `app-client` — required; actors: client; states: loading, ready, pending, authoritative_success, reconciliation_required, failed, offline, forbidden, error; actions: create Cash-In intent, select supported payment route, read canonical result, inspect wallet history.
- `app-captain` — required; actors: captain; states: loading, eligible, insufficient_balance, cod_reserved, cod_released, cod_finalized, earning_posted, destination_unavailable, destination_verified, payout_held, payout_pending, error; actions: top up, read balance, accept eligible order, read automatic COD and earning effects, read masked payout destination, request FULL_AVAILABLE or SPECIFIED payout.
- `app-partner` — required; actors: partner; states: loading, destination_unavailable, destination_verified, available, held, payout_pending, completed, error; actions: read wallet, read masked payout destination, request FULL_AVAILABLE or SPECIFIED payout, read payout state.
- `app-field` — required; actors: field; states: loading, commission_candidate, earned, destination_unavailable, destination_verified, held, payout_pending, completed, error; actions: read wallet, read commission, read masked payout destination, request FULL_AVAILABLE or SPECIFIED payout, read payout state.
- `control-panel` — required; actors: finance-operator; states: loading, ready, blocked, needs_action, awaiting_approval, awaiting_execution, awaiting_evidence, awaiting_verification, awaiting_reconciliation, exception, closed, forbidden, error; actions: inspect server-calculated truth, initiate governed destination provision or change, verify or approve when authorized, prepare, approve or reject when authorized, freeze batch, record execution, verify independently, reconcile, resolve exception, close day when gates pass.
- `backend` — required; actors: client, captain, partner, field, finance-operator, system; states: authenticated, authorized, idempotent, reserved, held, approved, frozen, executed, evidenced, verified, reconciled, completed, unknown_external_result, blocked, exception; actions: derive trusted financial purpose, derive monetary effects from canonical events and policy, resolve payout amount and current verified destination, enforce policy, lock or reserve atomically, post ledger, normalize provider evidence, hold payout, freeze immutable batch, record external execution, reconcile, audit, fail closed.
- `database` — required; actors: system, finance-operator; states: balanced, append_only, versioned, immutable_when_frozen, reconcilable, auditable, authorization_scope_isolated; actions: enforce uniqueness, enforce balance invariants, preserve history, reject contradictory replay, prevent in-place mutation of approved or frozen financial facts, preserve destination version provenance.
- technical presentation binding — required implementation evidence; actors: client, captain, partner, field, finance-operator; states: contract_aligned, capability_driven, no_local_truth; actions: render server-owned state, submit non-authoritative user intent, refresh canonical readback.

### WLT_PRICING_QUOTES

**Problem.** Checkout pricing can be manipulated or overflow if client values or unsigned/unbounded evidence are trusted.

**Required outcome.** WLT produces one bounded, currency-consistent quote from authoritative pricing evidence tied to client/store/cart identity and version.

**Primary actors.** customer as intent source, DSH pricing/catalog evidence producer, WLT system, authorized operator for diagnostics only.

**Canonical ownership.** WLT quote/allocation financial computation; source commercial item evidence comes from canonical DSH owners.

**Material surfaces.** app-client checkout readback, DSH↔WLT integration, control-panel diagnostics where authorized.

**Durable semantics.** every line has canonical product identity/quantity and authoritative unit-price evidence; currency is one governed currency per quote; fee/discount figures are non-negative and bounded; quote is correlated to cart version and source evidence version.

**Forbidden/negative invariants.**
- no client-supplied unit price/fee/discount is authoritative;
- no overflow/unbounded quantity/amount;
- no mismatched product/currency evidence;
- no quote accepted without authentic source evidence;
- no quote becomes a ledger posting until the owning payment/checkout transition authorizes it.

**Failure/recovery.** invalid/bounds failure, stale/mismatched evidence, unavailable evidence verifier/owner, cart version conflict; reacquire canonical evidence and requote.

**Acceptance expectations.** quote arithmetic conserves totals, evidence provenance is verifiable, and checkout/order snapshot preserves the accepted commercial/financial basis.

**Target state.** One WLT quote lifecycle computes bounded currency-consistent totals from authenticated DSH evidence and exposes versioned readback without becoming a ledger posting by itself.
**Primary success measure.** quotes reproducible from accepted source evidence/cart version with conserved totals.
**Guardrail measures.** client-authoritative price; overflow/unbounded quantity; mismatched currency/product; stale evidence accepted; quote posted to ledger without owning transition.
**Business invariants**
- authoritative item/commercial evidence comes from canonical DSH owners;
- WLT alone computes authoritative quote allocation/financial arithmetic;
- quote is correlated to cart/evidence version and currency;
- quote is non-posting until a payment/checkout owner authorizes money movement.
**Actor responsibility envelope**
- `customer` — requests/reads quote through checkout; forbidden: author amounts.
- `DSH` — supplies authenticated commercial evidence; forbidden: duplicate WLT arithmetic.
- `WLT` — computes/version-bounds quote and canonical readback.
**Surface semantics**
- `app-client` via DSH checkout readback and authorized diagnostics.
- `backend` and `database` — required WLT quote computation/evidence/version state.
- technical presentation binding — implementation evidence only.

### WLT_CAPTAIN_COLLATERAL

**Problem.** Captain collateral/exposure can be confused with available balance, COD capacity or debt and be released while obligations remain.

**Required outcome.** WLT owns versioned collateral policy, captain collateral positions and releasable excess as financial truth backed by a proven captured captain top-up/ledger source.

**Primary actors.** captain, authorized finance/operator, WLT system.

**Canonical ownership.** WLT collateral/wallet/ledger truth; DSH only consumes eligibility/readback needed for operations.

**Material surfaces.** app-captain readback, control-panel finance, dispatch eligibility integration when applicable.

**Durable states.** collateral policy enabled/disabled and versioned; collateral position `active → released`; release records reason/time and cannot silently mutate source funding history.

**Forbidden/negative invariants.**
- no collateral position without proven eligible captured funding source;
- no client/operator direct balance edit;
- no release while pending/held/COD reserve/outstanding debt or required minimum makes it ineligible;
- no DSH writer for collateral/wallet truth;
- no released position reused as active exposure.

**Failure/recovery.** policy disabled, invalid input/source, position not found, insufficient/restricted state, conflicting obligations; canonical WLT reread/reconciliation determines next legal action.

**Acceptance expectations.** wallet summary distinguishes available/pending/held/COD/collateral/debt; release is atomic/auditable and preserves ledger/source lineage.

**Target state.** WLT owns versioned collateral policy and positions with explicit backing source, exposure constraints and atomic release eligibility.
**Primary success measure.** collateral positions whose backing, active/released state and release eligibility reconcile to wallet/ledger obligations.
**Guardrail measures.** unbacked collateral; release with pending/held/COD/debt obligations; direct balance edit; released position reused; DSH collateral writer.
**Business invariants**
- every position references eligible captured WLT funding/ledger evidence;
- collateral is distinct from available, pending, held, COD reserve and debt;
- release is atomic, versioned and blocked by current obligations/minimum policy;
- DSH consumes eligibility/readback only.
**Actor responsibility envelope**
- `captain` — reads own collateral/exposure; forbidden: mutate balance or release eligibility directly.
- `finance operator` — applies authorized policy/release actions with audit; forbidden: bypass obligations.
- `WLT` — sole collateral/wallet/ledger writer.
**Surface semantics**
- `app-captain`, `control-panel`, and dispatch integration readback when applicable.
- `backend` and `database` — required WLT policy/position/ledger lineage.
- technical presentation binding — implementation evidence only.

### WLT_PROVIDER_PENALTIES

**Problem.** Captain/field penalties can become manual arbitrary balance edits or be reversed after their debt/wallet state has materially changed.

**Required outcome.** WLT applies a governed versioned penalty policy to an eligible captain/field source, posts the monetary effect through wallet/debt plus balanced ledger, and permits only state-safe reversal.

**Primary actors.** authorized operator/system, captain or field provider as affected actor/read-only consumer.

**Canonical ownership.** WLT penalty/debt/wallet/ledger truth; DSH may supply trusted incident/actor evidence.

**Material surfaces.** control-panel finance/incident workflow and bounded captain/field financial readback.

**Durable semantics.** policy is enabled/versioned with provider actor type, amount, currency and reason; penalty records source incident and split between wallet-applied amount and debt; reversal restores exact governed financial effect only when live debt state still matches the reversible snapshot.

**Forbidden/negative invariants.**
- no generic manual balance decrement;
- no unsupported actor type;
- no duplicate posting for same mutation identity;
- no reversal after partial settlement/state drift without explicit reconciliation;
- no non-WLT ledger writer;
- no penalty without reason/audit/source evidence.

**Failure/recovery.** wallet unavailable, policy disabled/invalid, debt state conflict, duplicate/idempotency conflict, reversal state drift; reconcile live wallet/debt before any new financial mutation.

**Acceptance expectations.** original and reversal postings balance, debt/wallet split is reproducible, audit/source lineage is preserved and affected readback is consistent.

**Target state.** WLT owns versioned captain/field monetary-penalty policy, posting/debt split and state-safe reversal from trusted source evidence.
**Primary success measure.** penalty/reversal operations with exact source lineage and balanced reproducible wallet/debt/ledger effects.
**Guardrail measures.** direct balance decrement; duplicate posting; unsupported actor; reasonless penalty; reversal after incompatible debt/state drift; non-WLT ledger write.
**Business invariants**
- penalty policy is versioned and actor/type/currency/reason scoped;
- one logical mutation identity yields one financial effect;
- wallet-applied and debt portions are balanced and auditable;
- reversal is permitted only against compatible live debt/state or after explicit reconciliation.
**Actor responsibility envelope**
- `operator/system` — initiates only authorized evidence-backed penalty/reversal intent; forbidden: arbitrary balance edit.
- `captain/field actor` — reads bounded affected financial outcome; forbidden: mutate policy/posting.
- `WLT` — sole penalty/debt/wallet/ledger writer and reconciler.
**Surface semantics**
- `control-panel` and bounded `app-captain`/`app-field` readback where applicable.
- `backend` and `database` — required WLT policy/posting/debt/reversal lineage.
- technical presentation binding — implementation evidence only.
