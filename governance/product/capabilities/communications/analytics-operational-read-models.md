# Analytics Operational Read Models

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/communications/analytics-operational-read-models.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: ANALYTICS_OPERATIONAL_READ_MODELS

## Scope

This file is the **sole editable durable semantic owner** of `ANALYTICS_OPERATIONAL_READ_MODELS`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### ANALYTICS_OPERATIONAL_READ_MODELS

**Problem.** Dashboards can silently turn stale/partial projections into transactional or financial truth.

**Required outcome.** Authorized operational analytics expose provenance, window/freshness and source-owner semantics without mutation authority.

**Primary actors.** authorized operator, partner/stakeholder for explicitly scoped summaries, system projection builder.

**Canonical ownership.** DSH operational-analytics projection responsibility owns projection build/read/rebuild lifecycle; every underlying metric fact remains owned by its canonical source domain.

**Material surfaces.** control-panel and explicitly authorized stakeholder summary views.

**Durable semantics.** metric/window/time basis/unit/currency/source owner/freshness are explicit; availability can be `available` or `no_data` rather than fabricated zero; drilldown never bypasses source authorization.

**Forbidden/negative invariants.**
- analytics cannot write transactional state;
- stale projection cannot authorize mutation;
- financial metric cannot bypass WLT-owned source;
- missing/partial data is not silently zero or “healthy”;
- cross-tenant/object leakage is forbidden.

**Failure/recovery.** lag, no data, incomplete ingestion, source mismatch, unauthorized dimension/drilldown; reconcile/rebuild from canonical sources.

**Acceptance expectations.** read model can be rebuilt, freshness is observable, source mismatch is surfaced, and operator actions navigate to canonical owner rather than mutating analytics storage.

**Target state.** A DSH operational-analytics projection owner builds authorized rebuildable read models with explicit provenance/freshness while each metric fact remains owned by its source domain.
**Primary success measure.** authorized metrics whose source owner/window/freshness are explicit and reproducible from canonical sources.
**Guardrail measures.** stale metric used to authorize mutation; financial metric not sourced from WLT; missing data rendered as zero; cross-scope drilldown leakage; non-rebuildable projection.
**Business invariants**
- DSH Analytics owns projection build/read lifecycle, not source transactional facts;
- every metric names source owner/time basis/unit/freshness;
- WLT remains source for authoritative financial facts;
- projections are rebuildable and never mutation/authorization writers.
**Actor responsibility envelope**
- `operator/stakeholder reader` — reads only authorized scoped metrics and follows owner drilldown; forbidden: mutate source through analytics storage.
- `projection builder` — ingests canonical facts with provenance/freshness; forbidden: invent missing truth.
**Surface semantics**
- `control-panel` and explicitly authorized stakeholder summaries — required where operational analytics is offered.
- `backend` and projection storage — required derived owner/readback/rebuild path.
- technical presentation binding — implementation evidence only.
