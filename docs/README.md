# BThwani Human Documentation

DOCUMENT_CLASS: HUMAN_DOCUMENTATION_INDEX
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
CURRENT_COMMAND_TRUTH_SOURCE: LIVE_REPOSITORY_SCRIPTS_AND_CONFIG

## 1. Purpose

Docs explain how humans develop, inspect, release and operate BThwani. They do not define Product/domain meaning, current implementation state or execution/closure law.

~~~text
DOCS != GOVERNANCE
DOCS != EXECUTABLE CONFIG
DOCS != CURRENT IMPLEMENTATION INVENTORY
DOCS != ORCHESTRATOR
~~~

When a command/path/configuration statement conflicts with executable source, source wins and Docs must be corrected.

## 2. Start here

1. `governance/GOVERNANCE.md`
2. `governance/project/PLATFORM.md`
3. `governance/project/GLOSSARY.md`
4. `governance/project/ACTORS-TRUST-AND-SCOPE.md`
5. `governance/product/PRD.md`
6. `governance/architecture/OWNERSHIP-AND-SOURCE-OF-TRUTH.md`
7. `development/README.md`

Use source-derived semantic lookup:

~~~text
pnpm knowledge:query -- capability <CAPABILITY_ID>
pnpm knowledge:query -- journey <J_ID>
pnpm knowledge:query -- owner <keyword-or-path>
~~~

## 3. Development guidance

`development/README.md` is the only development-guide router.

It routes:

- workflow/onboarding/evidence;
- backend/service/contract/data work;
- frontend/app-host/routing/design-system work;
- mobile/Expo/EAS;
- runtime/configuration/providers;
- observability/Sentry;
- quality/testing/verification;
- release/store submission.

Do not recreate a flat development handbook or numbered lifecycle tree.

## 4. Operations

`runbooks/README.md` is the only runbook router. Runbooks describe current diagnosis/containment/recovery through canonical operational interfaces.

Future or conditional mechanisms that do not exist in the executable repository do not belong in current runbooks.

## 5. References

`reference/external-systems/` is non-authoritative external evidence/falsification material.

`reference/donor-reconstruction-patterns.md` is non-authoritative donor/history guidance.

Reference material never authorizes Product scope, target topology, dependency adoption or current implementation state.

## 6. Staleness law

Docs must not preserve obsolete branch names, local-machine paths, retired repository topology, historical commands or deleted knowledge structures as current guidance.

If the executable mechanism disappears, either update the guide to the current mechanism or delete the obsolete guidance.
