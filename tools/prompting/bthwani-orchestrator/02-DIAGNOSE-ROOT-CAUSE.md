# Diagnose Required Truth and Root Cause

OWNER_ROLE: REQUIRED_TRUTH_CAUSAL_GRAPH_ROOT_RANKING
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: BEFORE_SELECTION_OR_AFTER_MATERIAL_CANDIDATE_CHANGE

## 1. Diagnosis objective

Find the highest safe causal root that must change to make the current authorized outcome canonical.

Do not diagnose from repository shape alone. Resolve required meaning first from current human decisions, Governance, executable target truth and—when relevant—donor/history/reference evidence.

## 2. Scope-directed evidence census

Start from:

~~~text
AUTHORIZED OUTCOME
→ CANONICAL OWNER/WRITER/READBACK
→ AFFECTED DATA/CONTRACT/RUNTIME
→ REQUIRED CONSUMERS/SURFACES
→ MIGRATION/CUTOVER DEPENDENCIES
→ INVALIDATED PRIOR EVIDENCE
~~~

Expand outward only when evidence shows a shared writer, ancestor/root, systemic mechanism or cross-cutting dependency.

For `FULL_TARGET`, repository-wide census is valid.

## 3. Required-truth view

Before selecting a fix establish, as applicable:

- actor/role/persona and authorization scope;
- capability/journey outcome;
- canonical owner/writer/readback;
- durable state/invariants;
- data/contract/event/provider effects;
- migration/compatibility obligations;
- UX/surface consequences;
- security/privacy/financial requirements;
- negative/forbidden states;
- required historical/donor truth.

Current shape does not gain authority by existing.

## 4. Finding lifecycle

A finding is evidence, not treatment.

~~~text
OBSERVED
→ CLASSIFIED
→ LINKED TO CAUSAL GRAPH
→ ROOT / DESCENDANT / SYMPTOM / NONMATERIAL / OUT-OF-SCOPE
→ SELECTED OR DEFERRED WITH REASON
→ TREATED
→ VERIFIED
~~~

Renaming, documenting, mapping, deprecating or moving a defect is not treatment.

## 5. Parent/root escalation

If multiple defects share an ancestor, owner, writer, package/runtime mechanism or historical compensation, test whether the ancestor is the stronger root.

Do not demolish an ancestor merely because many descendants are bad; require evidence that ancestor semantics/boundary/ownership itself is wrong or causes material recurring tax.

## 6. Root ranking

Rank candidates by causal leverage, not file count:

~~~text
SAFETY / IRREVERSIBILITY
+ BLOCKING POWER
+ AUTHORITY/WRITER CORRECTION
+ NUMBER/IMPORTANCE OF DESCENDANT DEFECTS REMOVED
+ MIGRATION/CUTOVER SIMPLIFICATION
+ REGRESSION RISK REDUCTION
+ REQUIRED-SCOPE MATERIALITY
- UNCERTAINTY
- UNCONTROLLED EXTERNAL DEPENDENCY
~~~

A lower local fix loses when a higher proven root would make it obsolete.

## 7. Patch-versus-refound diagnosis

Prefer targeted correction when the owner/boundary/model is fundamentally correct.

Prefer demolition/refoundation when the current structure is the defect: wrong owner, duplicate writer, wrong bounded context, compatibility architecture with no live need, framework/abstraction with no justified responsibility, or architecture that makes correct behavior materially harder.

## 8. Structural-prerequisite promotion

A structural finding is promoted ahead of semantic mutation only when it is a proven causal prerequisite of the authorized work.

No global structural gate exists.

~~~text
UNRELATED STRUCTURAL DEBT → OUTSIDE ACTIVE SLICE
CAUSAL STRUCTURAL PREREQUISITE → CURRENT GRAPH
REPOSITORY-WIDE STRUCTURAL ROOT → CURRENT GRAPH ONLY WHEN PROVEN OR FULL_TARGET
~~~

## 9. Source-of-defect / source-of-fix

For the selected root explicitly identify:

~~~text
SOURCE_OF_DEFECT
REQUIRED_SOURCE_OF_FIX
CANONICAL_TARGET
TRUTH_TO_PRESERVE
AFFECTED_CONE
MIGRATION/CUTOVER NEED
EXPECTED LOSERS/DELETIONS
EVIDENCE NEEDED TO FALSIFY THE FIX
~~~

Do not begin mutation while a ranking-relevant unknown can still change target or safe cutover.

## 10. Donor/history diagnosis

Donor and Git history are evidence corpora, not live authorities.

Extract semantic atoms only when they can materially change the current root:

~~~text
ATOM
→ CURRENTLY REQUIRED?
→ OWNER?
→ PRESERVE / ADAPT / REJECT / SUPERSEDED
→ EVIDENCE / REASON
~~~

Do not globally exhaust donor history for a bounded active slice.

## 11. Journey/operational trace

For user/system behavior trace the complete material path from action through trusted scope, owner, durable/external effect, readback and final visible/system state. Include operator/reconciliation/recovery surfaces only when the journey materially requires them.

## 12. Causal-frontier output

Diagnosis emits only:

~~~text
CURRENT_CAUSAL_GRAPH
RANKED_ROOT_FRONTIER
HIGHEST_SAFE_AUTHORIZED_ROOT_OR_NONE
REQUIRED_AFFECTED_CONE
RANKING_RELEVANT_UNKNOWNS
~~~

Movement belongs to `05`; mutation belongs to `03`.

## 13. Patch-loop breaker

If repeated local fixes expose the same upstream owner/model/boundary defect, stop patching descendants and promote the shared cause for ranking.

~~~text
REPEATED SYMPTOM FIXES + SAME CAUSAL OWNER
→ RE-DIAGNOSE HIGHER ROOT
~~~
