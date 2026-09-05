# Quality, Testing and Verification

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
CURRENT_WORKFLOW_TRUTH_SOURCE: .github/workflows and repository scripts

## Principle

A green CI/test proves only the claim exercised. CI is evidence, not Product/System authority or closure.

Classify affected tests/fixtures/mocks/snapshots/guards as valid canonical spec, obsolete behavior, duplicate coverage, wrong-layer spec, losing-topology test, missing prevention or broken test infrastructure. Delete/refound obsolete assurance with the change.

## Evidence ladder

Use the smallest sufficient evidence class without substituting weaker proof:

- compile/typecheck/static analysis;
- schema/contract validation;
- unit/domain;
- database migration/invariant;
- integration;
- runtime smoke;
- end-to-end/journey;
- visual/accessibility;
- security/privacy;
- financial/reconciliation;
- release/deployment.

A material capability/increment follows the user/system action through owner, storage, transport, contract, generated binding, presentation, app composition, mutation and persisted/observable readback.

## Negative space

After cutover search for old writers/readers, stale exports/config, wrappers/aliases, obsolete tests/mocks, duplicate contracts and wrong-owner paths.

## CI guard discipline

A custom guard/script/workflow must enforce a unique durable invariant not already enforced better by compiler/schema/test/runtime tooling. Remove obsolete topology guards, debt baselines, pass-through wrappers and campaign-only checks when their role ends.

A red workflow is a finding to diagnose, not something to suppress merely to recover green status.

## Official standards reference routing

Use current official sources when a material security, accessibility, supply-chain or secure-development claim depends on them. These links are reference entrypoints, not frozen version authority:

- OWASP ASVS — https://owasp.org/www-project-application-security-verification-standard/
- OWASP MASVS / MASTG / MASWE — https://mas.owasp.org/MASVS/
- W3C WCAG — https://www.w3.org/WAI/standards-guidelines/wcag/
- NIST Secure Software Development Framework (SP 800-218) — https://csrc.nist.gov/pubs/sp/800/218/final
- SLSA specification — https://slsa.dev/spec/

Revalidate the current applicable version/profile at the decision or release point. External standards constrain engineering assurance; they do not create BThwani Product semantics.

## Documentation and knowledge verification

```powershell
pnpm docs:verify:all
pnpm knowledge:verify:all
```

Knowledge verification combines canonical ownership/invariant/authority checks, internal Markdown reference/orphan checks and adversarial high-risk agent knowledge-contract checks. CI keeps them separately visible for attribution.

Use current root verification entrypoints such as `pnpm workspace:verify`, repository structure/hygiene checks, docs/knowledge verification and integration runtime proof as applicable; exact command truth remains in `package.json`/scripts.

Dependency changes require appropriate package/version/license/security/maintenance review. Generated artifacts and lockfile changes remain reproducible and reviewable with their source.
