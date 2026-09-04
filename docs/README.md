# BThwani Developer Documentation

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_AND_OPERATIONS_GUIDANCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_COMMAND_AUTHORITY: LIVE_REPOSITORY_SCRIPTS_AND_CONFIG

## Start here

A developer new to BThwani should read in this order:

1. `governance/GOVERNANCE.md`
2. `governance/project/PLATFORM.md`
3. `governance/project/GLOSSARY.md`
4. `governance/project/ACTORS-TRUST-AND-SCOPE.md`
5. `governance/product/PRD.md`
6. `governance/product/CAPABILITIES.md`
7. `governance/product/JOURNEYS.md`
8. `governance/architecture/OWNERSHIP-AND-SOURCE-OF-TRUTH.md`
9. `governance/product/FINANCIAL-MODEL.md` when money is affected
10. `governance/product/EXPERIENCE-AND-DESIGN.md` when a user/operator surface is affected
11. the applicable engineering policy
12. `development/getting-started.md`

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

Then use the focused guide:

- `development/apps-and-routing.md`
- `development/frontend-development.md`
- `development/services-development.md`
- `development/database-and-migrations.md`
- `development/contracts-and-generation.md`
- `development/testing-and-verification.md`
- `development/configuration-and-secrets.md`
- `development/runtime.md`
- `development/providers-and-sandboxes.md`
- `development/mobile.md`
- `development/control-panel.md`
- `development/design-system.md`
- `development/observability-and-debugging.md`
- `development/ci-and-quality.md`
- `development/eas.md`
- `development/sentry.md`
- `development/repository-evidence.md`
- `development/leanctx.md`

### Runbooks

`runbooks/README.md` routes operational incidents to focused runbooks. Runbooks describe diagnosis/recovery only; they do not override domain owners or invent direct business/database mutations.

### Reference

`reference/external-systems/` contains non-authoritative external research. Reference selection is not dependency adoption.

## Staleness rule

Every documentation change that mentions executable commands/paths/configuration must verify them against the same repository candidate. Historical commands, branch assumptions, deleted paths and implementation inventories must be removed rather than retained as compatibility prose.
