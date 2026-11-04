# Providers and Integrations Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/integrations.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Financial rail activation by environment

- **Local development (current phase):** use WLT's development-only Cash-In simulator/provider mock to exercise Customer and BThwani Captain funding, failures, retries, unknown outcomes and WLT ledger readback. This is synthetic accounting proof, not evidence of external funds or a certified provider integration. A live provider API, contract or credentials are **not prerequisites to completing local development**.
- **Local P0 financial proof:** exercise the admitted COD, internal-Wallet and Mixed payment paths, refunds/adjustments, commissions, Captain coverage and settlements as applicable, including authorization, idempotency, concurrency, balanced ledger entries and owner-backed recovery. Simulation does not waive those checks and does not prove real external transfer or reconciliation.
- **Governed Stage integration:** after a provider and its official test contract/environment are approved, verify server-side adapter, callback authenticity, timeout/unknown outcome, idempotency and reconciliation against official sandbox evidence. Without that integration, external Cash-In remains disabled on Stage; development mocks must not be enabled there.
- **Production activation:** never allow a development simulator/mock to credit actual customer or Captain funds. Real electronic Cash-In requires approved provider contracts, authenticated evidence, settlement reconciliation and independent financial/security review before enablement. An independently approved COD-only public launch may leave electronic Cash-In disabled; no UI or API may advertise it as available. WLT remains the sole owner of internal balance and ledger in every phase.
- These are **phase-specific acceptance gates**, not a requirement to build an unused provider adapter now or to promote local synthetic balances to shared/production data. Stage and Production transitions require separate authorization.

- External providers implement bounded semantic ports; availability never makes them Product/domain owners.
- External payment/wallet providers are rails around WLT-owned financial truth; provider balance or labels never become BThwani internal ledger truth.
- Normalize and validate external responses at the adapter boundary before owner state changes.
- Provider timeout/unknown result is represented explicitly and reconciled where effects may have occurred.
- A financial provider result that may have moved money remains `UNKNOWN` until query/reconciliation resolves it; a second movement is forbidden while duplicate effect remains possible.
- Refund, payout, reversal or query capability is never inferred from provider or product name; each capability is proven from the current provider contract at actual use.
- Provider identifiers are references, not replacements for BThwani canonical identity.
- Media and notification adapters own provider/storage/delivery mechanics only; the applicable DSH capability owns message/content/media relationship, publication/intent/read-state meaning.
- Adoption requires current need, fit, maturity/stability, compatibility, license/provenance, security/supply-chain, operational/recovery, migration/rollback and replaceability evidence as applicable.
- Newer or more popular is never adoption authority.
- Mutable provider/API/platform facts are revalidated at use from current primary sources.
- Discovery catalogs and OSS exemplars surface candidates; neither grants adoption authority.
