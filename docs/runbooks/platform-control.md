# Platform Control Operations Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
DOCUMENT_STATUS: CONDITIONAL_TARGET_GUIDANCE
USE_AS_CURRENT_OPERATIONAL_RUNBOOK: ONLY_AFTER_EXECUTABLE_PLATFORM_CONTROL_MATERIALIZATION

## Trigger

Use operationally only when exact-current executable evidence proves a materialized owner for the relevant Platform Control semantic responsibility and the governed action/readback being diagnosed. Until then, this file is target recovery guidance and must not imply that `services/platform-control`, contracts, migrations, or a rollout runtime already exist.

## Diagnose

Verify:

- exact semantic owner and exact executable writer/runtime;
- trusted operator context;
- current version;
- schema/type validation;
- rollout/audience state when material;
- maker/checker requirements;
- current canonical readback.

A configured value is not proof that every consumer applied it.

## Recovery

Use a new governed change/inverse/rollback operation only when that operation exists in the current executable owner and is legal for the current state/version. Do not edit domain tables or service-local copies to force consistency.

If the independent Platform Control service is not admitted/materialized, operate the actual rehomed control-plane owner proven by current executable architecture.

## Verify

Confirm the current executable canonical control-plane owner readback, intended consumer behavior, audit/correlation where required, and absence of unauthorized or stale competing configuration authorities.
