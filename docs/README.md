# BThwani Developer Documentation

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_AND_OPERATIONS_GUIDANCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

CURRENT_COMMAND_TRUTH_SOURCE: LIVE_REPOSITORY_SCRIPTS_AND_CONFIG

## Start here

A developer new to BThwani should first read the small durable baseline:

1. `governance/GOVERNANCE.md`
2. `governance/project/PLATFORM.md`
3. `governance/project/GLOSSARY.md`
4. `governance/project/ACTORS-TRUST-AND-SCOPE.md`
5. `governance/product/PRD.md`
6. `governance/architecture/OWNERSHIP-AND-SOURCE-OF-TRUTH.md`
7. `development/getting-started.md`

Then load only the Product/policy owners material to the task. Prefer source-derived lookup instead of reading the entire capability/journey catalogs:

~~~text
pnpm knowledge:query -- capability <CAPABILITY_ID>
pnpm knowledge:query -- journey <J_ID>
pnpm knowledge:query -- owner <keyword-or-path>
~~~

Load `governance/product/FINANCIAL-MODEL.md` when money is affected, `governance/product/EXPERIENCE-AND-DESIGN.md` when a user/operator surface is affected, and the applicable engineering policy before changing its responsibility.

## What Docs owns

`docs/**` explains how humans develop, run, inspect and operate BThwani. It may summarize governance or executable configuration for usability, but it does not create Product/domain truth or current runtime truth.

```text
DOCS != PRODUCT GOVERNANCE
DOCS != EXECUTABLE CONFIG
DOCS != CURRENT ROUTE/SCHEMA REGISTRY
```

When a command, path, port or environment value conflicts with live scripts/configuration, the executable source wins and the documentation must be corrected.

## Documentation map

### Development handbook

Read in this order for normal onboarding:

1. `development/getting-started.md`
2. `development/repository-map.md`
3. `development/first-change.md`
4. `development/incremental-product-delivery.md` — non-authoritative guidance for implementing an already-authorized small canonical slice without disposable architecture

Then use the focused guide:

- `development/apps-and-routing.md`
- `development/frontend-development.md`
- `development/services-development.md`
- `development/database-and-migrations.md`
- `development/contracts-and-generation.md`
- `development/testing-and-verification.md`
- `development/configuration-and-secrets.md`
- `development/runtime.md`
- `development/runtime-profiles-and-integrations.md` — daily/focused/full development modes and provider/infrastructure responsibilities
- `development/providers-and-sandboxes.md`
- `development/mobile.md`
- `development/control-panel.md`
- `development/design-system.md`
- `development/observability-and-debugging.md`
- `development/ci-and-quality.md`
- `development/eas.md`
- `development/release-and-store-submission.md` — release candidate, mobile-store submission, compatibility and controlled launch
- `development/sentry.md`
- `development/repository-evidence.md`
- `development/leanctx.md`

### Lifecycle routing

Use this cross-topic map instead of a parallel lifecycle document tree:

| Question | Canonical route |
|---|---|
| Product outcome/actor/journey | PRD + `knowledge:query` capability/journey owner |
| donor/history truth | `reference/donor-reconstruction-patterns.md`; Orchestrator clean-target profile when executing reconstruction |
| architecture/ownership/topology | `governance/architecture/**` + focused development guide |
| code/data/contracts change | applicable Governance policy + focused `development/**` guide |
| Identity/access | capability owner + actors/trust model + security policy |
| UX/RTL/accessibility/design | experience/design governance + design-system guide |
| providers/finance | provider policy + financial model + capability owner |
| build/store/release | `development/release-and-store-submission.md` + delivery policy + executable build config |
| incident/recovery | `runbooks/README.md` |
| current evidence | repository-evidence/CI guides + Orchestrator verification owner when invoked |

Do not create another numbered lifecycle chapter that restates these owners.

### Runbooks

Additional cross-cutting recovery guides include `runbooks/systemic-platform-recovery.md`, `runbooks/communications-and-media.md`, and `runbooks/catalog-promotions-ratings.md`.

`runbooks/README.md` routes operational incidents to focused runbooks. Runbooks describe diagnosis/recovery only; they do not override domain owners or invent direct business/database mutations.

### Reference

`reference/external-systems/` contains non-authoritative external research. Reference selection is not dependency adoption.

`reference/donor-reconstruction-patterns.md` preserves non-authoritative historical donor extraction/convergence clues; it is never current topology or implementation authority.

`reference/target-operations/` contains future/conditional operating patterns that are intentionally excluded from current operational runbooks.

## Staleness rule

Every documentation change that mentions executable commands/paths/configuration must verify them against the same repository candidate. Historical commands, branch assumptions, deleted paths and implementation inventories must be removed rather than retained as compatibility prose.
