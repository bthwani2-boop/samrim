# Emergency Release and Audit Policy

ARTIFACT_CLASS: DURABLE_ENGINEERING_POLICY
SEMANTIC_OWNER: governance/policies/delivery/emergency-and-audit.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_POLICY_ROUTER: governance/policies/delivery.md

## Emergency / break-glass release

An emergency path may reduce latency but does not erase immutable source/artifact identity, minimum applicable testing/security/data requirements, authorization, controlled rollout or post-deploy verification.

Record incident/severity reason, exact candidate, risks intentionally accepted by an authorized owner, minimum non-waivable evidence, release owner and follow-up restoration of any legitimately deferred evidence. Temporary bypasses are removed after the emergency.

## Release records and auditability

Every production/store release has one authoritative durable release record in an approved system. It identifies as applicable source/integration identity, artifact/binary IDs, provenance/SBOM/attestation, migration/configuration revision, pre-production evidence, security/quality evidence, approvals, deployment/store identifiers, rollout strategy, previous known-good release, recovery reference and post-release result.

Do not duplicate logs/screenshots/reports in Git merely to create an archive when their authoritative system already retains them.

For an audit, every applicable delivery control resolves to exactly one of:

`PASS | FAIL | NEEDS_EVIDENCE | N/A_PROVEN`.

Silence, missing evidence or unknown status is never converted to PASS.

## Release conformance

A release is conformant only when the exact released candidate/artifact/binary and materially affected Product/Engineering/Security/Data/Runtime/Delivery claims have current evidence, required rollout/post-release observation is complete, no known material release blocker remains and release identity/evidence are attributable.
