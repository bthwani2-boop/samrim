# Quality Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/quality.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

Quality is proven against the material affected cone and the claims being made, not by a universal checklist or one green command.

## Material quality discovery taxonomy

The following identifiers are durable discovery dimensions. They help agents find what may matter; they are not a requirement to manufacture an entry for every clearly irrelevant dimension in every task.

QUALITY_DIMENSION: PRODUCT_BUSINESS
QUALITY_DIMENSION: OWNERSHIP_ARCHITECTURE
QUALITY_DIMENSION: DATA_MIGRATION
QUALITY_DIMENSION: CONTRACT_API_EVENT
QUALITY_DIMENSION: SECURITY_AUTHORIZATION
QUALITY_DIMENSION: PRIVACY_PII_LOCATION
QUALITY_DIMENSION: FINANCE
QUALITY_DIMENSION: RELIABILITY_RECOVERY
QUALITY_DIMENSION: PERFORMANCE_CAPACITY
QUALITY_DIMENSION: OBSERVABILITY_AUDIT
QUALITY_DIMENSION: UX_IA_CONTENT
QUALITY_DIMENSION: ACCESSIBILITY_RTL_LOCALIZATION
QUALITY_DIMENSION: VISUAL_IDENTITY_DESIGN_SYSTEM
QUALITY_DIMENSION: PLATFORM_DEVICE
QUALITY_DIMENSION: RUNTIME_CONFIG_INFRA
QUALITY_DIMENSION: DEPENDENCY_SUPPLY_CHAIN
QUALITY_DIMENSION: RELEASE_STORE_DEPLOYABLE_IDENTITY
QUALITY_DIMENSION: VERIFICATION_EVIDENCE
QUALITY_DIMENSION: GOVERNANCE_DOCS_RESIDUE

## Synthetic operational proof environment

Synthetic runtime proof state is evidence/development state, not Product truth. When an operational journey is claimed, its business state is created through the canonical owner and writer paths. A synthetic proof environment is isolated, reproducible and disposable; valid proven proof state may be reused, while untrusted state is discarded and rebuilt through canonical owners rather than repaired manually to manufacture a green result.

Material cross-role slice and end-to-end scenario proof connects the affected real surfaces to the same canonical identities and business state. Synthetic proof does not authorize Product or schema exceptions and must not create uncontrolled real-world effects. Direct persistence mutation does not substitute for a canonical business operation; it is limited to cases where persistence is the correct evidence producer for a database or fault/recovery claim.

The durable meanings for data, security, integrations and reliability remain owned by `docs/governance/policies/data.md`, `docs/governance/policies/security.md`, `docs/governance/policies/integrations.md` and `docs/governance/policies/reliability.md`; this policy defines only the cross-cutting proof-environment boundary.

For each material task:

```text
MATERIAL QUESTION
→ DISCOVER DIMENSIONS THAT CAN PLAUSIBLY CHANGE CORRECTNESS OR CLOSURE
→ RESOLVE EVERY SUCH DIMENSION
→ STOP ENUMERATING DIMENSIONS THAT ARE CLEARLY IRRELEVANT
```

A plausibly material dimension is resolved as one of:

```text
AFFECTED
PROVEN_UNAFFECTED
N/A_WITH_REASON
```

`UNEXAMINED`, `MAYBE`, `LATER` and silent omission are forbidden for a plausibly material dimension.

A ready Governance PR records the dimensions actually examined and the concrete reason/evidence for each. It does not repeat the entire catalog merely for ceremony.

## Material closure matrix and evidence independence

For a material outcome, closure reasoning covers the material cells produced by:

```text
SLICE / CAPABILITY
× MATERIAL SURFACE / ACTOR
× CANONICAL OWNER / WRITER / READBACK
× MATERIAL FULL-STACK LAYER
× REQUIRED PROOF
× RELEVANT CROSS-SLICE HANDOFF / E2E SCENARIO
```

The matrix is a reasoning and proof model, not a permanent backlog or mandatory new artifact. Start with the bounded slice and its cross-repository impact; include only cells that can materially affect the authorized outcome. Verify E2E scenarios at integration boundaries, without treating journey documents as a second implementation queue. Every material cell at closure resolves to exactly one of:

```text
PROVEN
PROVEN_UNAFFECTED
N/A_WITH_REASON
```

`UNKNOWN`, `ASSUMED`, `LATER`, `NOT_CHECKED` and silent omission are forbidden for a material closure cell.

Production implementation must not be the sole oracle for a material claim when an independent authority-appropriate oracle is available. Anchor expected truth in the applicable contract, invariant, canonical owner readback, independently derived expectation or external normative rule. Shared helpers may perform setup or transport, but a proof must not compute its expected result by reusing the same decision logic whose correctness it is meant to establish when that reuse could reproduce the same defect and create a false green.

Higher-consequence claims require proportionally independent negative, boundary, cross-role, failure or recovery evidence where those cases can materially falsify correctness.

## Durable owner split for user-facing quality

```text
UX_IA_CONTENT
ACCESSIBILITY_RTL_LOCALIZATION
→ docs/governance/policies/experience.md

VISUAL_IDENTITY_DESIGN_SYSTEM
→ docs/governance/policies/design.md

RENDERED / INTERACTION / DEVICE PROOF OBLIGATION
→ this docs/governance/policies/quality.md evidence model using the applicable semantic owners above
```

Visual implementation conforms to the durable Design policy through the consuming repository's canonical executable Design System where reusable meaning is admitted. App-specific composition remains local to the owning surface.

## Proof model

As applicable, prove:

- Product/business state-machine correctness and current user/business outcome;
- semantic owner, canonical writer/readback and architecture/boundary correctness;
- semantic sufficiency without overloaded fields, encoded naming conventions, UI-only business semantics, hidden exceptions or shadow truth;
- reversibility/evolution safety for materially costly-to-reverse identities, boundaries, persistent data shapes and public contracts;
- database/migration/retention/concurrency integrity;
- contract/event/generated-client consistency;
- authentication, authorization, abuse resistance and negative security cases;
- privacy/PII/location minimization and purpose limitation;
- money precision, idempotency, unknown-outcome and reconciliation semantics when financial effects exist;
- retry/timeout/recovery/restart/resume/concurrent-state correctness;
- performance/resource/capacity only to the scale materially claimed;
- observability/audit attribution sufficient for the affected outcome without unnecessary sensitive data;
- UX/information architecture/content clarity, shell/navigation where material, interaction states and recovery;
- accessibility, RTL/localization, text scaling, keyboard/screen-reader/touch behavior as applicable;
- brand/visual-system consistency through the canonical Design policy and executable Design System;
- native platform/device and responsive/adaptive behavior where claimed;
- runtime/config/infrastructure ownership and parity for the authorized environment;
- dependency maturity/license/security/provenance/maintenance when dependencies change;
- deployable identity when package/bundle/EAS/signing/deep-link/provider/store identity is affected;
- claim-fit static/unit/contract/database/integration/browser/device/runtime evidence;
- Governance/Docs convergence and absence of obsolete/shadow/losing paths after cutover.

A single tool may cover multiple dimensions. Tool count is not assurance strength. Duplicate proof that exercises materially the same oracle and failure surface adds no assurance by repetition; retain duplicate proof only when it has distinct material falsification value.

## Operational collection and scale proof

A claim that an operational collection or workflow is fit for sustained scale is proven at the materially expected operating envelope, not from a toy row count or an isolated component benchmark. Representative proof uses realistic record shape, column density, Arabic/Latin/numeric content, target-class hardware and network conditions when those factors can materially change the result.

As applicable, challenge the complete pipeline rather than only rendering: canonical query cost and correctness; transferred payload; browser memory and client processing; DOM/rendering cost; server-owned filtering/sorting/counting across the full represented result set; bounded paging or incremental retrieval; stable record identity; selection scope; detail-and-return context preservation; long-running or bulk action behavior; conflict/partial-failure/recovery; responsive widths; RTL; keyboard and accessibility.

Virtualization can prove/render a smaller DOM, but it does not by itself prove that an oversized dataset is safe to fetch, process or authorize on the client. Conversely, a server-driven collection does not prove acceptable UX merely because the database query is bounded. Evidence follows the actual bottlenecks and the scale claim being made.

Do not impose one arbitrary maximum row count, one pagination mechanism or one benchmark threshold on unrelated resources. The expected operational envelope is derived from the material Product/workload claim and must include enough headroom to falsify the design where capacity is part of the claim.

## Real-device and rendered proof

When correctness depends on OS/device behavior, use representative real-device evidence for the material claim, including restart/resume, foreground/background behavior, weak/offline reconnect, permissions, location/background restrictions, deep-link/notification handoff, text scaling/accessibility and canonical readback as applicable.

For user-facing work, rendered quality is correctness. Representative evidence covers the materially affected IA/shell/navigation, adaptive sizes, RTL, appearance, accessibility, applicable loading/empty/forbidden/conflict/offline/error/recovery states and actual interaction path.

A screenshot alone is not cross-surface or end-to-end proof. Static type/source checks do not override visibly, structurally or interactively defective behavior.

## External assurance

Use current primary/assurance/experience evidence from `docs/reference/**` only when it can materially change the decision or proof. Mutable upstream status is revalidated at use.

## Closure

For the exact authorized candidate/cone, closure requires:
- zero plausibly material dimensions left unresolved;
- zero material closure cells left unresolved;
- zero affected dimensions without owner/invariant/required proof;
- zero known material defect or contradiction;
- zero decision-critical unknown;
- zero stale required evidence;
- zero known material evolution dead end;
- zero unjustified shadow/residue.

This is current material closure, not permanent infallibility.
