# Software Delivery Policy Family

ARTIFACT_CLASS: DURABLE_POLICY_ROUTER
SEMANTIC_OWNER: governance/policies/delivery.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Scope and boundary

This policy owns **how an approved engineering change becomes an integrated, built, promoted and released software candidate**. It owns source identity, evidence freshness, remote qualification, review/integration, artifact provenance, environment promotion, deployment, native-store/OTA release, emergency release and release records.

It does **not** redefine Product semantics, architecture, database correctness, security/privacy, runtime reliability or frontend behavior. Those meanings remain with their specialized governance owners. Delivery asks whether the required evidence for those owners is current and attributable to the candidate being promoted.

No CI workflow, vendor, cloud, repository layout or current tool name is itself delivery policy authority.

## Normative language

- **MUST / MUST NOT** — required for the affected promotion/release claim.
- **SHOULD / SHOULD NOT** — default; deviation needs an explicit evidence-based reason.
- **MAY** — optional when appropriate.

Missing, stale, cancelled, ambiguous or materially incomplete required evidence is not PASS.

## Canonical lifecycle

```text
CHANGE INTENT
-> ENGINEERING IMPLEMENTATION + LOCAL EVIDENCE
-> REMOTE QUALIFICATION
-> REVIEW / INTEGRATION CANDIDATE
-> EXACT CANDIDATE VERIFIED
-> PROTECTED RELEASE SOURCE
-> CONTROLLED BUILD + IMMUTABLE ARTIFACT IDENTITY
-> STAGING / PRE-PRODUCTION QUALIFICATION when applicable
-> PRODUCTION / STORE READINESS
-> DEPLOYMENT / SUBMISSION / ROLLOUT
-> POST-DEPLOYMENT / POST-RELEASE EVIDENCE
-> RELEASE ACCEPTANCE SATISFIED
```

A phase is complete only when its exit claims are proven for the exact candidate. Documentation or a previous green run is not technical evidence for a changed candidate.

## Core delivery invariants

### Immutable candidate identity

Every promotion candidate is identified by immutable source identity, normally a full commit SHA. Branch names are routing labels, not evidence identity.

### Evidence freshness

Evidence is attributable to the candidate/materials/configuration/artifact it proves. If a materially relevant source, base/merge result, generated output, dependency graph, migration set, build input, security-sensitive configuration or binary changes, affected evidence becomes stale and is rerun.

### One release lineage

Production/store releases retain one attributable lineage:

```text
source identity
-> reviewed/integrated source
-> build inputs
-> build execution
-> artifact/binary identity
-> provenance/SBOM/signature where required
-> pre-production evidence
-> approval authority
-> production/store rollout
-> post-release evidence
```

### No hidden prerequisites

Undocumented machine edits, ad-hoc database changes, local package installs, manual generated-file changes, hidden environment tweaks or untracked source cannot be release prerequisites.

### No promotion with a known material defect

A known material defect in the effective release scope blocks promotion until corrected or handled by an explicitly authorized exception/risk process that is actually permitted for that class of defect. A label such as emergency does not erase non-waivable security, financial, data-integrity or platform obligations.

### Evidence classes are not interchangeable

Static analysis does not prove runtime behavior; unit tests do not prove deployment; deployment success does not prove Product journey health; store approval does not prove correctness/security; documentation does not prove implementation.

## Specialized policy owners

This file owns only the cross-cutting delivery lifecycle and invariants above. Specialized rules live in exactly one owner:

- governance/policies/delivery/change-qualification.md — local/remote qualification, review/integration and deployable identity preservation.
- governance/policies/delivery/build-promotion.md — build provenance, environments, migrations, staging, production deployment, recovery and web release.
- governance/policies/delivery/mobile-distribution.md — native/mobile store and OTA distribution requirements.
- governance/policies/delivery/emergency-and-audit.md — break-glass release, release records and delivery conformance.

Do not restate specialized rules here. References to governance/policies/delivery.md mean “enter the delivery policy family and load only the materially applicable specialized owner.”
