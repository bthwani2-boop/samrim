# Platform Engineering and Delivery Lifecycle Guide

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_AND_OPERATIONS_GUIDANCE  
EXECUTION_AUTHORITY: NONE  
PRODUCT_SEMANTIC_AUTHORITY: NONE  
CURRENT_IMPLEMENTATION_AUTHORITY: LIVE_REPOSITORY_SOURCE_AND_RUNTIME  
MUTABLE_EXTERNAL_POLICY_AUTHORITY: CURRENT_OFFICIAL_PLATFORM/STORE_DOCUMENTATION

## 1. Purpose

This guide describes a rigorous end-to-end method for taking a multi-surface full-stack platform from an empty target repository to production operation and public mobile-store distribution when a legacy/donor system already exists.

It is a working guide, not a second source of Product truth, architecture authority, release authority, or campaign execution authority.

Authority remains with:

- `governance/**` for durable Product/System/Engineering meaning;
- executable source/contracts/configuration for current implementation state;
- `tools/prompting/bthwani-orchestrator/**` for the active refoundation campaign;
- current official Apple/Google/platform documentation for mutable store and platform rules.

When this guide conflicts with a canonical semantic owner, executable source, or current official platform rule, this guide is stale and must be corrected.

## 2. Core engineering model

The preferred lifecycle is:

```text
PIN DONOR EVIDENCE
+ DEFINE PRODUCT TRUTH
+ DEFINE NON-GOALS
+ DEFINE OWNERSHIP / TRUST / DATA BOUNDARIES
        ↓
BUILD THE MINIMUM JOURNEY-READY SUBSTRATE
        ↓
PROVE IT WITH ONE REPRESENTATIVE REAL VERTICAL SLICE
        ↓
DELIVER BUSINESS JOURNEYS VERTICALLY
        ↓
HARDEN SECURITY / RELIABILITY / OPERATIONS
        ↓
QUALIFY RELEASE CANDIDATES
        ↓
BETA / STORE REVIEW / CONTROLLED RELEASE
        ↓
PRODUCTION OBSERVATION / SUPPORT / INCIDENT RESPONSE
        ↓
CONTINUOUS JOURNEY DELIVERY
```

The two failure modes to avoid are:

```text
BUILD_EVERYTHING_HORIZONTALLY
→ integrate late
→ discover incompatible assumptions
```

and:

```text
BUILD_NO_FOUNDATION
→ start journeys immediately
→ refound architecture every week
```

The target state before broad feature development is a **journey-ready platform**: enough technical substrate exists that the next real journey requires its own Product/UX/domain/data/API/surface/test work, not another repository/auth/config/migration/build-system redesign.

## 3. Product vision, authorized slice, and deferred scope

A complete Product vision and incremental delivery are not opposites.

```text
TARGET_PRODUCT_VISION
        !=
AUTHORIZED_PRODUCT_SCOPE
        !=
ACTIVE_PRODUCT_SLICE
        !=
CURRENT_IMPLEMENTATION_STATE
```

Use two independent controls:

```text
QUALITY DEPTH  = how completely/correctly the authorized work is closed
PRODUCT BREADTH = how much Product functionality is authorized now
```

A Level-4-quality slice can therefore be intentionally small.

```text
SMALL BREADTH
+ CANONICAL OWNER/DATA/CONTRACT/RUNTIME
+ COMPLETE REQUIRED SURFACES/READBACK
+ FAILURE/SECURITY/TEST EVIDENCE
= VALID VERTICAL INCREMENT
```

Do not interpret “incremental” as permission to create disposable domain models, `v1` tables, fake APIs, temporary state machines, placeholder Product screens, shadow DTOs, or compatibility structures that must later be refounded.

A surface may also be **host-ready but business-deferred**: its deployable identity, bootstrap, authentication/session binding, shell, runtime configuration, and build proof can exist while its domain features remain deliberately absent.

When an active slice reaches its fixed point:

```text
FREEZE THE PROVEN BASELINE
→ RUN CUMULATIVE AFFECTED REGRESSION
→ STOP PRODUCT EXPANSION
→ ACTIVATE THE NEXT SLICE DELIBERATELY
```

Do not auto-activate the next feature simply because it appears next in the long-term roadmap.

### Slice admission gate

Before activating another Product slice, prove:

```text
PREVIOUS_BASELINE_REQUIRED_EVIDENCE=GREEN
NEW_SLICE_HAS_CLEAR_PRODUCT_OUTCOME
CANONICAL_OWNER/WRITER=KNOWN
NO_SECOND_SOURCE_OF_TRUTH_REQUIRED
NO_DISPOSABLE_ARCHITECTURE_REQUIRED
DONOR/EXTERNAL_EVIDENCE_CONE_IS_ACQUIRABLE
SLICE_CAN_CLOSE_VERTICALLY_AT_REQUIRED_QUALITY_DEPTH
```

Then implement the new slice and re-run every prior proof invalidated by shared owners, contracts, data, runtime, packages, or hosts.

## 4. Non-negotiable principles

1. **Donor is evidence, not target topology.**
2. **Product meaning precedes directory structure.**
3. **One durable fact has one canonical owner and one governed writer.**
4. **Use the minimum necessary number of deployable/runtime boundaries.**
5. **Repository strategy and runtime architecture are separate decisions.**
6. **A capability closes vertically across every materially affected layer and consumer.**
7. **Security, privacy, data evolution, accessibility, observability, and release engineering start before launch.**
8. **Static green does not prove runtime correctness; runtime green does not prove security, data migration, financial, or release correctness.**
9. **Public mobile clients require backward-compatible server evolution across their real support window.**
10. **External-provider timeout/ambiguity is not success and is not failure until authoritative evidence resolves it.**
11. **Build and release artifacts require attributable immutable identity and controlled inputs.**
12. **Mutable store/platform requirements are revalidated at every release.**
13. **Do not create framework/registry/event-bus/cache/service complexity before a concrete requirement proves it.**
14. **Parallel development is allowed; partial horizontal closure is not.** Independent journeys may proceed concurrently only when worksets, ownership, migration, integration, and verification boundaries are explicit. Each claimed outcome still closes as a complete vertical unit.

## 5. Reference baseline

Use context-appropriate standards rather than inventing a private assurance system.

Recommended baseline:

- NIST SP 800-218 Secure Software Development Framework (SSDF) for secure-development practices.
- OWASP ASVS 5.x for web/backend application-security verification requirements.
- OWASP MASVS + MASTG/MASWE for mobile security verification and testing.
- WCAG 2.2, normally Level AA where applicable for web accessibility, plus native platform accessibility semantics.
- OpenAPI or another machine-verifiable canonical interface description for HTTP APIs when appropriate.
- OpenTelemetry or equivalent standard telemetry interfaces when tracing/metrics are required.
- SLSA concepts for build provenance/attestation where supported and material.
- Platform-native Apple/Android security, privacy, permission, signing, and store requirements.
- Jurisdiction-specific legal/privacy/financial advice where the business model requires it; store compliance is not legal compliance.

Reference links are listed at the end of this guide.

---


## Lifecycle module map

Continue by need rather than loading the entire lifecycle every time:

1. `01-foundation-scope-and-donor.md` — authority/success definition, donor census, Product capabilities/actors/journeys.
2. `02-architecture-security-and-technical-foundation.md` — domain/data/runtime boundaries, threat/privacy design, repository/CI, environments, migrations, contracts, backend chassis.
3. `03-identity-experience-and-journey-ready.md` — Identity/access, UI/UX foundation, app shells, representative walking skeleton and repeatable journey loop.
4. `04-integrations-finance-and-verification.md` — providers, async work, notifications, financial systems and verification architecture.
5. `05-build-release-and-operations.md` — secure build, production infrastructure, staging, beta, stores, release choreography, launch/support and continuous delivery.
6. `06-evidence-gates-and-templates.md` — canonical gates, donor/journey templates, premature-complexity rejection and references.

These modules are human guidance only. The Orchestrator decides execution/closure and Governance owns durable meaning.
