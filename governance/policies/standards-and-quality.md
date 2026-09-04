# Engineering Standards, Best-Practice Adequacy, and Quality Policy

ARTIFACT_CLASS: DURABLE_QUALITY_POLICY
SEMANTIC_OWNER: governance/policies/standards-and-quality.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Standards-grounded treatment gate

Functional success or symptom removal is insufficient for a material engineering defect/change. The resulting treatment must be the **correct, simplest durable solution appropriate to the actual context**, consistent with current materially applicable authoritative engineering/platform standards, Product/System semantics, repository constraints and the owning technology.

Evaluate dimensions only when material:

`correctness | architecture | ownership | API/contract design | data integrity/migrations | security/privacy | concurrency/idempotency | reliability/recovery | performance/resource lifecycle | accessibility/RTL | maintainability | testability | observability | dependency hygiene | clean-state reproducibility`.

## Selection law

When more than one treatment is valid, prefer the one maximizing:

```text
Cause Removal
+ Canonical Simplicity
+ Strong Invariants
+ Minimal Necessary Complexity
+ Lowest Long-Term Entropy
+ Safe Migration/Cutover
+ Full Consumer Consistency
+ Verifiable Failure/Recovery Behavior
```

Do not select the smallest diff or fastest local patch when it exports complexity, duplicated authority, migration debt, hidden operational risk or future maintenance entropy to the system.

## Best Practice is context-bound

```text
BEST_PRACTICE != LATEST_PATTERN
BEST_PRACTICE != MORE_ABSTRACTION
BEST_PRACTICE != MORE_LAYERS
BEST_PRACTICE != NEW_DEPENDENCY
BEST_PRACTICE != REWRITE

VALID_PRACTICE = CONTEXT_FIT + MATERIAL_BENEFIT + PROVEN_NEED + CORRECT_AUTHORITY
```

Forbidden as justification by themselves:

- cargo-cult patterns;
- premature abstraction;
- speculative generalization;
- architecture astronautics;
- unnecessary layering/wrapping;
- dependency-for-convenience when existing capability is sufficient;
- rewrite-for-cleanliness;
- optimization without measured/material need;
- local simplification that creates downstream duplication or parallel truth.

An abstraction/service/package/dependency exists only when it has necessary purpose, clear owner, real consumer, unique value and lower total system entropy than the simpler alternative.

## External standards and official guidance

Use current authoritative standards/vendor/platform documentation when it can materially change a design decision, prevent a known class of defect or is required for release/compliance. Examples include NIST secure-development guidance, OWASP application/API/mobile guidance, SLSA/supply-chain guidance, W3C accessibility standards, language/runtime/database/framework official guidance and current Apple/Google platform rules when applicable.

External standards do not invent BThwani Product semantics. Mutable version numbers/rules are revalidated when a decision/release depends on them rather than copied into governance as eternal facts.

## Quality and testability

Design important behavior so its invariants and failure/recovery paths can be falsified. Tests are evidence, not Product/capability governance, and should target the authority/behavior they prove without hard-coding obsolete implementation structure as semantics.

Do not weaken tests/scanners or create a fake-green compatibility path to accept a design that remains wrong. Conversely, do not introduce a large test/guard framework when focused existing evidence gives equivalent assurance more simply.

## Suppressions and intentional conditions

A warning/test/scanner finding may not be hidden merely to obtain green. Material suppression/ignore/allowlist requires either a proven false positive or an explicitly authorized intentional condition whose risk/behavior is understood.

The suppression must use the narrowest sufficient scope, live at the correct owner, preserve visibility of unrelated paths, record enough rationale for future re-evaluation and have an expiry/removal trigger when temporary. A broad exclusion that hides required analysis, or a local disable used instead of correcting the authoritative defect, is not acceptable evidence.

A tool or implementation actor cannot manufacture business/security risk acceptance merely because a finding is inconvenient.

## Dependency hygiene

Dependencies/tooling must provide material capability not reasonably owned already, be compatible with platform/security/licensing/supply-chain requirements, remain lockable/reproducible and have clear removal/update ownership. Remove unused/obsolete/duplicate dependencies after consumer/build/runtime proof.

## Assurance outputs

CI, static analyzers, security scanners, reviews and similar systems are **evidence producers**, not Product/System authority. Consume material findings, warnings, execution limitations and coverage gaps; correlate/deduplicate them; correct the actual Product/code/data/runtime owner.

Do not turn ordinary Product engineering into an assurance-control-plane side project merely because one scanner/workflow is imperfect. Repair assurance machinery when it is itself the objective or when a proven indispensable evidence blocker leaves no materially adequate route to the required claim. Never create bypasses or shadow assurance systems.

## Adequacy before completion

A material change/defect is not standards-grounded complete until evidence supports, as applicable:

```text
CAUSE_REMOVED
+ CORRECT_OWNER_AND_LAYER
+ CONTEXT_APPROPRIATE_BEST_PRACTICE
+ APPLICABLE_STANDARDS_SATISFIED
+ NO_SIMPLER_EQUIVALENT_CORRECT_DESIGN
+ NO_NEW_PARALLEL_TRUTH
+ NO_UNJUSTIFIED_COMPLEXITY
+ COMPLETE_MATERIALLY_AFFECTED_SET_CONSISTENT
+ FAILURE_AND_RECOVERY_BEHAVIOR_VERIFIABLE
+ NO_KNOWN_MATERIAL_RESIDUE_TIED_TO_CHANGE
```

A change that works functionally but leaves a known materially fragile design, violates an applicable standard, or replaces the defect with unjustified structural debt requires further correction.


## External reference and dependency-adoption law

External systems may be used as adversarial references for missing invariants, edge cases, state machines, failure modes, security rules, financial rules and test scenarios without granting them BThwani ownership.

```text
REFERENCE_SELECTION != DEPENDENCY_ADOPTION_SELECTION
DONOR_VALUE != DONOR_AUTHORITY
GOOD_REFERENCE != RIGHT_TO_COPY_TOPOLOGY
```

Before direct code reuse or dependency/runtime adoption, verify the exact current component/version, license, maintenance health, security/supply-chain posture, stack fit, operational cost, ownership fit, replacement/exit cost and whether the same requirement is already owned more simply. Unknown/no-license code is reference-only by default.

Whole-platform replacement is forbidden by default unless the current BThwani owner/stack is independently proven to be the root defect and replacement passes the full adoption/migration gate. Research stops once the material question is sufficiently resolved and no high-risk unknown remains.
