# BThwani Captain Balance Funding

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/finance/captain-balance-funding.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: CAPTAIN_BALANCE_FUNDING

## Outcome

A BThwani Captain may fund their single WLT-owned internal balance through an approved external Cash-In rail. The same balance supports governed COD collateral/exposure and other admitted Captain financial effects; top-up is not itself an earning or payout.

## Ownership

WLT owns the Captain FundingIntent, purpose-to-wallet resolution, provider event application, fee effect, internal balance credit and reconciliation. The external provider adapter owns transport and provider inquiry mechanics only.

## Invariants

- this capability applies only to a Captain whose BThwani-owned financial relationship is active;
- Store-affiliated Partner Captains, Partners and Field actors are not included by this admission;
- the Captain uses one WLT balance, not a separate top-up or COD wallet;
- provider identity never selects the internal wallet or ledger account; server-owned purpose maps the confirmed intent to the correct Captain wallet;
- provider success is accepted only with evidence sufficient for the approved provider contract;
- timeout/unknown outcomes remain unresolved until inquiry/reconciliation and cannot trigger an unsafe duplicate movement;
- each intent and provider event is idempotent and the balance credit posts exactly once;
- provider fee bearer is versioned policy and does not silently change the credited amount;
- Cash-In does not settle COD cash custody/remittance and does not authorize withdrawal;
- secrets and provider credentials never enter client authority.

## Failure and recovery

Duplicate/replayed event, timeout, unknown result, provider reversal, mismatched amount/reference and delayed confirmation reconcile before another credit is possible. WLT canonical readback resolves whether the Captain balance was credited.
