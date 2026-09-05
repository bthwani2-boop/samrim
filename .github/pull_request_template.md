## Summary

<!-- What canonical outcome does this PR produce? -->

## Exact candidate and authorized scope

<!-- Pin the candidate/ref used for verification. State PRODUCT_BREADTH and ACTIVE_PRODUCT_SLICE/FULL_TARGET authorization. Do not infer future Product breadth from LEVEL_4. -->

## Scope and ownership

<!-- Which apps/services/packages/contracts/infra/governance owners are materially affected? Confirm surface-specific feature UI remains app-owned and business/data/financial/authentication truth stays with its canonical owner. -->

## Migration / Cutover

<!-- If replacing an authority/path/contract/writer/data shape, describe migration, consumer cutover, old-write disablement and loser deletion. Use N/A only when proven. -->

## Deployable identity / runtime

<!-- If app/repository/build/runtime paths changed, confirm package/bundle/EAS/scheme/hosting/provider identities and runtime bindings were preserved or deliberately migrated. -->

## Dependencies / external references

<!-- For added/changed dependencies/providers/OSS: record why it is needed and the current license/security/supply-chain/maintenance review. Reference selection alone is not adoption approval. -->

## Verification

<!-- Exact checks/evidence executed against the same candidate. Cover only applicable layers: static/domain/integration/runtime/journey/security/financial/accessibility/build. State what each proof does and does not prove. -->

## Security / Secrets

<!-- Confirm no secret values, machine-local bindings, caller-authored trust or unnecessary PII are introduced. Describe authorization/privacy impact. -->

## Docs / knowledge

<!-- State whether Governance/Docs/agent routing changed. Confirm current implementation state remains sourced from executable code/runtime, not documentation. -->

## Negative space

<!-- What old authority, alias, wrapper, stale path, parallel writer, forbidden scope, donor residue or compatibility structure was actively searched for? -->

## Checklist

- [ ] Exact candidate and authorized Product breadth are explicit.
- [ ] Required truth is preserved.
- [ ] One canonical owner/writer/contract provenance remains.
- [ ] No secret values or machine-local bindings are committed.
- [ ] Migration/cutover is complete where applicable.
- [ ] Deployable identities/runtime bindings are preserved or deliberately migrated where applicable.
- [ ] New dependency/provider adoption passed current review where applicable.
- [ ] Losing authorities/residue are removed where applicable.
- [ ] Applicable verification and fresh re-census are complete.
- [ ] Green tools/CI are not presented as broader closure than they actually prove.
