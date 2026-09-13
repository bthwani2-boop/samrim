## Summary

<!-- What exact authorized outcome does this PR produce? -->

## Exact candidate and authorized objective

<!-- Pin the candidate/ref used for verification. State the current human-authorized objective, material constraints, and any operation/environment boundary that matters. -->

## Affected cone and ownership

<!-- Which apps/services/packages/contracts/infra and pinned Governance owners are materially affected? Confirm one canonical owner/writer/contract provenance remains. -->

## Diagnosis and decision

<!-- What current evidence was inspected? What is the root cause? Which alternatives were considered, and why is this the simplest complete safe canonical solution? -->

## Governance impact

<!-- Keep exactly one final value before Ready for Review: GOVERNANCE_IMPACT=NONE | REVALIDATE_ONLY | UPDATE_REQUIRED | DEFECT_FOUND. If UPDATE_REQUIRED/DEFECT_FOUND, canonical Governance must converge before this implementation candidate deliberately repins it. -->

`GOVERNANCE_IMPACT=REVALIDATE_ONLY`

## Material quality census

<!-- These identifiers are owned by pinned governance/policy/QUALITY.md. Replace every TODO with exactly AFFECTED, PROVEN_UNAFFECTED, or N/A_WITH_REASON plus a concrete reason/evidence. No dimension may disappear silently. -->

- PRODUCT_BUSINESS: TODO — reason/evidence
- OWNERSHIP_ARCHITECTURE: TODO — reason/evidence
- DATA_MIGRATION: TODO — reason/evidence
- CONTRACT_API_EVENT: TODO — reason/evidence
- SECURITY_AUTHORIZATION: TODO — reason/evidence
- PRIVACY_PII_LOCATION: TODO — reason/evidence
- FINANCE: TODO — reason/evidence
- RELIABILITY_RECOVERY: TODO — reason/evidence
- PERFORMANCE_CAPACITY: TODO — reason/evidence
- OBSERVABILITY_AUDIT: TODO — reason/evidence
- UX_IA_CONTENT: TODO — reason/evidence
- ACCESSIBILITY_RTL_LOCALIZATION: TODO — reason/evidence
- VISUAL_IDENTITY_DESIGN_SYSTEM: TODO — reason/evidence
- PLATFORM_DEVICE: TODO — reason/evidence
- RUNTIME_CONFIG_INFRA: TODO — reason/evidence
- DEPENDENCY_SUPPLY_CHAIN: TODO — reason/evidence
- RELEASE_STORE_DEPLOYABLE_IDENTITY: TODO — reason/evidence
- VERIFICATION_EVIDENCE: TODO — reason/evidence
- GOVERNANCE_DOCS_RESIDUE: TODO — reason/evidence

## Migration / Cutover

<!-- If replacing an authority/path/contract/writer/data shape, describe truth preservation, migration/backfill/reconciliation, consumer cutover, old-write disablement and loser deletion. Use N/A only when proven. -->

## Deployable identity / runtime

<!-- If app/repository/build/runtime paths changed, confirm package/bundle/EAS/scheme/hosting/provider identities and runtime bindings were preserved or deliberately migrated. -->

## Dependencies / external references

<!-- For added/changed dependencies/providers/OSS: record why it is needed and the current license/security/supply-chain/maintenance review. For mutable official/platform facts record freshness/revalidation when material. Reference selection alone is not adoption approval. -->

## Verification

<!-- Exact checks/evidence executed against the same candidate. State the material claims, proof class, negative/failure/recovery coverage, and what remains unproven. For user-facing changes include design-readiness evidence, representative responsive/RTL/theme/accessibility/error states, and real browser/device journey proof where material. -->

`MATERIAL_DIMENSIONS_UNEXAMINED=0`
`AFFECTED_DIMENSIONS_WITHOUT_OWNER=0`
`AFFECTED_DIMENSIONS_WITHOUT_RULE=0`
`AFFECTED_DIMENSIONS_WITHOUT_REQUIRED_PROOF=0`
`KNOWN_MATERIAL_DEFECTS=0`
`KNOWN_MATERIAL_CONTRADICTIONS=0`
`DECISION_CRITICAL_UNKNOWNS=0`
`KNOWN_GOVERNANCE_DRIFT=0`

## Security / Secrets

<!-- Confirm no secret values, machine-local bindings, caller-authored trust or unnecessary PII are introduced. Describe authorization/privacy impact. -->

## Docs / knowledge

<!-- State the exact pinned Governance SHA. If knowledge changed, identify its merged canonical owner/commit and why the previous rule was incomplete/stale/wrong. Never pin a temporary Governance candidate. -->

## Negative space

<!-- What old authority, alias, wrapper, stale path, parallel writer, forbidden scope, donor residue, obsolete verifier, future breadth or compatibility structure was actively searched for and removed/rejected? -->

## Checklist

- [ ] Exact candidate and current authorized objective are explicit.
- [ ] Every pinned-Governance material quality dimension is resolved with reason/evidence.
- [ ] Required truth and deployable/external identities are preserved.
- [ ] One canonical owner/writer/contract provenance remains.
- [ ] No secret values or machine-local bindings are committed.
- [ ] Migration/cutover and loser deletion are complete where applicable.
- [ ] New dependency/provider adoption passed current review where applicable.
- [ ] Material failure/recovery/negative cases and canonical readback are proven.
- [ ] No known losing/shadow authority or Governance drift remains in the affected cone.
- [ ] Green tools/CI are not presented as broader proof than they actually provide.
