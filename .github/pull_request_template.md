## Summary

<!-- What exact authorized outcome does this PR produce? -->

## Exact candidate and authorized objective

<!-- Pin the candidate/ref used for verification. State the current human-authorized objective, material constraints, and any operation/environment boundary that matters. -->

## Affected cone and ownership

<!-- Which apps/services/packages/contracts/infra and pinned Governance owners are materially affected? Confirm one canonical owner/writer/contract provenance remains. -->

## Diagnosis and decision

<!-- What current evidence was inspected? What is the root cause? Which alternatives were considered, and why is this the smallest safe canonical solution? -->

## Migration / Cutover

<!-- If replacing an authority/path/contract/writer/data shape, describe truth preservation, migration/backfill/reconciliation, consumer cutover, old-write disablement and loser deletion. Use N/A only when proven. -->

## Deployable identity / runtime

<!-- If app/repository/build/runtime paths changed, confirm package/bundle/EAS/scheme/hosting/provider identities and runtime bindings were preserved or deliberately migrated. -->

## Dependencies / external references

<!-- For added/changed dependencies/providers/OSS: record why it is needed and the current license/security/supply-chain/maintenance review. Reference selection alone is not adoption approval. -->

## Verification

<!-- Exact checks/evidence executed against the same candidate. State the material claims, proof class, negative/failure/recovery coverage, and what remains unproven. -->

## Security / Secrets

<!-- Confirm no secret values, machine-local bindings, caller-authored trust or unnecessary PII are introduced. Describe authorization/privacy impact. -->

## Docs / knowledge

<!-- State whether pinned Governance/Docs or AGENTS.md changed. If knowledge was corrected, state the evidence that made the prior rule incomplete/stale/wrong. -->

## Negative space

<!-- What old authority, alias, wrapper, stale path, parallel writer, forbidden scope, donor residue or compatibility structure was actively searched for? -->

## Checklist

- [ ] Exact candidate and current authorized objective are explicit.
- [ ] Required truth and deployable/external identities are preserved.
- [ ] One canonical owner/writer/contract provenance remains.
- [ ] No secret values or machine-local bindings are committed.
- [ ] Migration/cutover and loser deletion are complete where applicable.
- [ ] New dependency/provider adoption passed current review where applicable.
- [ ] Material failure/recovery/negative cases and canonical readback are proven.
- [ ] No known losing/shadow authority remains in the affected cone.
- [ ] Green tools/CI are not presented as broader proof than they actually provide.
