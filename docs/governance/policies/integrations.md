# Providers and Integrations Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/integrations.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

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
