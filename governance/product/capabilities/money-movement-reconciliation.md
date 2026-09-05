# Money Movement Reconciliation Capabilities

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/money-movement-reconciliation.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md

## Scope

This owner defines only the durable capability semantics listed below. Capability taxonomy/schema/admission law remains in `../CAPABILITIES.md`; cross-capability journeys remain in `../JOURNEYS.md`.

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
