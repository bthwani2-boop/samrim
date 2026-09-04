# Platform Control Operations Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Trigger

Use for governed platform variable, rollout, change-set, approval or cross-surface configuration incidents.

## Diagnose

Verify:

- exact variable/change owner;
- trusted operator context;
- current version;
- schema/type validation;
- rollout/audience state;
- maker/checker requirements;
- current canonical readback.

A configured value is not proof that every consumer applied it.

## Recovery

Use a new governed change/inverse/rollback operation according to current semantics. Do not edit domain tables or service-local copies to force consistency.

## Verify

Confirm canonical Platform Control readback, intended consumer behavior and absence of unauthorized/stale competing configuration authorities.
