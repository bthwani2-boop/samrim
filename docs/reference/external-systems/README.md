# BThwani External Reference System

DOCUMENT_CLASS: NONAUTHORITATIVE_REFERENCE_INDEX
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Purpose

This directory is a **reference/falsification corpus**, not a source of BThwani Product, architecture, dependency or execution authority.

Use it to answer bounded questions such as:

- which mature external systems demonstrate a relevant Product/domain pattern;
- which failure, security, migration, finance, UX or operational edge cases should be considered;
- which current external standards/tools may falsify a weak BThwani design;
- which implementation approaches are worth evaluating before adopting a dependency.

Reference selection is not adoption selection.

```text
REFERENCE EVIDENCE != PRODUCT AUTHORITY
REFERENCE EVIDENCE != TARGET TOPOLOGY
REFERENCE POPULARITY != DEPENDENCY ADMISSION
DONOR/OSS FEATURE BREADTH != ACTIVE_PRODUCT_SLICE
```

## Reference router

Load only the corpus able to change the current decision:

- `commerce-fulfillment.md` — commerce, catalog, cart/order, partner/store, dispatch/fulfillment and marketplace patterns.
- `finance-payments.md` — wallets, ledgers, payment/settlement/payout/reconciliation and financial-provider patterns.
- `identity-platform.md` — identity, authentication, sessions, MFA/passkeys, authorization-boundary and abuse-control patterns.
- `engineering-infrastructure.md` — repository/toolchain/contracts/data/runtime/CI/observability/release engineering references.
- `experience-design-ui-assurance.md` — UX, mobile/web interaction, accessibility, RTL/localization, Design System and visual-assurance references.

Historical donor extraction/convergence patterns are routed separately through `../donor-reconstruction-patterns.md`.

## Selection discipline

Choose references by the **question being falsified**, not by brand familiarity.

Prefer, in order when applicable:

1. authoritative standards/specifications/platform documentation for normative external behavior;
2. mature production-grade open-source systems demonstrating the exact responsibility;
3. official SDK/framework/runtime documentation for current implementation mechanics;
4. multiple independent examples when one repository may encode local trade-offs.

Stop collecting references when additional sources no longer change:

- required Product/System semantics;
- owner/boundary choice;
- failure/recovery model;
- security/privacy/financial invariant;
- UX/accessibility behavior;
- implementation/adoption decision;
- required test/falsification case.

More references after that point are noise.

## Extraction workflow

For a bounded task:

```text
1. DEFINE THE QUESTION / CURRENT ASSUMPTION
2. RESOLVE BTHWANI GOVERNANCE OWNER
3. SELECT ONLY RELEVANT REFERENCE CORPUS
4. EXTRACT MATERIAL SEMANTIC / FAILURE / UX / TEST ATOMS
5. CLASSIFY EACH ATOM:
   APPLICABLE | INAPPLICABLE | SUPERSEDED | NEEDS_DECISION | IMPLEMENTATION_OPTION
6. MAP APPLICABLE ATOMS TO THE BTHWANI OWNER
7. APPLY DEPENDENCY/TECHNOLOGY ADOPTION POLICY IF CODE/TOOLING IS PROPOSED
8. RECORD ONLY BTHWANI-RELEVANT CONCLUSIONS; DO NOT COPY REFERENCE TOPOLOGY
```

## What to extract

Extract only materially relevant information, for example:

- stable business concepts, invariants and state transitions;
- negative/forbidden states;
- cross-owner handoffs and readback expectations;
- concurrency/idempotency/retry/unknown-result behavior;
- migration/backfill/reconciliation/recovery patterns;
- authentication/authorization/privacy/security boundaries;
- financial conservation/reconciliation semantics;
- UX states, interaction recovery, accessibility and localization behavior;
- contract/schema/version-skew patterns;
- operational diagnostics and falsification tests.

Do not import:

- donor/vendor naming merely because it exists;
- service/package/folder topology without independent BThwani responsibility proof;
- extra Product breadth outside the authorized slice;
- compatibility layers with no real coexistence requirement;
- generic abstractions whose only justification is that another project uses them.

## Adoption boundary

A reference may justify **evaluation**, never automatic adoption.

Before adding a dependency/provider/tool/pattern, apply the current BThwani dependency/adoption, provider, security, runtime and delivery policies. Revalidate mutable facts such as:

- project maintenance/version/security state;
- license/terms;
- platform/store requirements;
- provider capability/pricing/availability;
- SDK/runtime compatibility.

Historical notes do not override current official sources.

## BThwani handoff

External evidence must terminate in a BThwani-owned disposition:

```text
REFERENCE FINDING
→ MATERIALITY
→ APPLICABLE BTHWANI SEMANTIC/POLICY OWNER
→ ACCEPT / REJECT / ADAPT / NEEDS_DECISION
→ IMPLEMENTATION OPTION WHEN RELEVANT
→ REQUIRED FALSIFICATION/TEST
```

The reference document itself never becomes the permanent rule owner.

## Prohibitions

```text
REFERENCE_AS_PRODUCT_AUTHORITY = FORBIDDEN
REFERENCE_AS_TARGET_TOPOLOGY = FORBIDDEN
VENDOR_NAME_AS_DOMAIN_OWNER = FORBIDDEN
COPYING_FEATURE_BREADTH_BY_DEFAULT = FORBIDDEN
REFERENCE_COUNT_AS_CONFIDENCE_METRIC = FORBIDDEN
STALE_LICENSE/SECURITY/PLATFORM_FACT_AS_CURRENT = FORBIDDEN
```

## Reference files

The files in this directory are intentionally domain-specific. Do not expand this README into a duplicated master catalog. Add a new reference file only when an existing domain corpus cannot represent a stable distinct question family without becoming incoherent.
