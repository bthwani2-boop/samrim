# ADR 0004 — Identity and Workforce separation

ARTIFACT_CLASS: DURABLE_DECISION_RATIONALE
STATUS: SUPERSEDED
SUPERSEDED_BY: governance/decisions/0008-single-actor-domain-owned-participation.md
EXECUTION_AUTHORITY: NONE

## Historical context

This decision separated authentication/session truth from a proposed Workforce owner for employment/engagement/eligibility truth.

## Historical decision

Identity owned authentication/session/activation/permissions; Workforce was proposed as a peer owner for workforce person/engagement/profile/eligibility; DSH owned operational assignments; WLT owned financial truth.

## Supersession

ADR 0008 supersedes the architectural portion of this decision. The current model does not admit a Workforce service, module, or bounded context. Required captain/field/partner/client operational participation facts remain with DSH, Identity remains the single actor/authentication authority, WLT remains the financial authority, and `actor_id` is the single cross-boundary human identifier.
