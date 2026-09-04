# ADR 0004 — Identity and Workforce separation

ARTIFACT_CLASS: DURABLE_DECISION_RATIONALE
STATUS: ACTIVE
EXECUTION_AUTHORITY: NONE

## Context
Authentication/session truth and employment/engagement/eligibility truth have different security/lifecycle semantics. Modeling captain/field/employee as mutually exclusive identity types conflates axes.

## Decision
Identity owns authentication/session/activation/permissions. Workforce owns person/engagement/profile/eligibility. DSH owns operational roles/assignments; WLT owns financial identity/truth.

## Alternatives
Single combined identity/workforce service/model; separate captain/field identities.

## Consequences
A person can hold orthogonal engagements/operational roles without creating parallel authentication authorities.

## Supersession
A later ADR may supersede this decision only by explicitly accounting for migration, ownership and affected Product/System truth.
