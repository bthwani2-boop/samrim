# BThwani — Governance owners and cutover

ARTIFACT_CLASS: GOVERNANCE_INDEX
SEMANTIC_OWNER: governance/README.md
GOVERNANCE_CUTOVER: NOT_READY
IMPLEMENTATION_ADMISSION: PROGRESSIVE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## What this directory means

This is the single active durable governance root. Each decision has one semantic owner. The index routes authority and defines global policy acceptance; it does not duplicate domain rules, engineering procedures or implementation state. Historical docs/governance, the read-only archive/legacy-pre-refoundation-20261114, ZIPs, research and dated reports are provenance, not active parallel policies. Preserve materially binding rights, obligations and source history through the relevant owner and [documentation index](../docs/README.md); silence in a reconstructed document does not retire a right.

## The canonical owner index

| Owner | Normative responsibility |
| --- | --- |
| [product.md](product.md) | Product admission, capability IDs, scope and exclusions |
| [platform.md](platform.md) | Actor/Store terminology, roles, resources and surfaces |
| [architecture.md](architecture.md) | Fact ownership, one writer/engine, service boundaries and policy architecture |
| [identity.md](identity.md) | Actor identity, sessions, global permissions and recovery |
| [stores.md](stores.md) | Store registration, relation, publication, availability and delegation |
| [catalog.md](catalog.md) | Product, Variant, Offer, inventory, media and catalogue readback |
| [commerce.md](commerce.md) | Serviceability, cart, Order, adjustment, communication and promotion |
| [fulfillment.md](fulfillment.md) | Method eligibility, dispatch, Captain membership, handoff, delivery and pickup |
| [finance.md](finance.md) | WLT fees, agreements, collection, balances, ledger and settlement |
| [hr.md](hr.md) | Scoped employee administration within DSH |
| [experience.md](experience.md) | Surface design, Arabic RTL, accessibility and recovery |
| [safety.md](safety.md) | Security, privacy, financial/data integrity, migration and risk assurance |
| [engineering.md](engineering.md) | Engineering law, refoundation, work lifecycle and acceptance |
| [journeys.md](journeys.md) | Cross-owner integration outcomes, handoffs and recovery proof |

[AGENTS.md](../AGENTS.md) is the execution entry, [repository structure](../REPOSITORY-STRUCTURE.md) owns placement, and [engineering references](../docs/reference/engineering-references.md) owns the external reference catalogue. Engineering Core owns reusable methodology. Spec Kit and owner contracts define implementation; CI verifies evidence. None is an alternative Product authority. No separate capability/journey census or status register.

## Authority and conflict protocol

The latest explicit human approval on the same subject supersedes conflicting earlier choices, not compatible obligations. Evaluate every decision and constraint against applicable evidence and official references. Distinguish approved target, current implementation, historical fact, inference and unresolved decision. Correct proven defects at their owner under [engineering law](engineering.md); cross-owner consumers link to the owner. Unresolved material authority or legal/financial rights fail closed only for the affected action. Do not guess defaults, infer authorization or retire obligations from absent source.

Actual implementation claims require source, contracts, relevant data and runtime proof at their owners. A document, scaffold, mock or approved policy is not implementation or legal compliance.

## Progressive capability admission — 2026-11-14 human approval

IMPLEMENTATION_ADMISSION: PROGRESSIVE authorizes analysis, design and implementation of existing and newly proposed capabilities through independently ready owner-backed increments. No preliminary per-capability ceremony or global governance cutover prerequisite. Resolve target meanings at their canonical owners, preserve source obligations and map increments to existing or admitted new Product IDs.

Apply the [capability acceptance law](engineering.md#capability-scoped-implementation-acceptance-before-global-cutover) and [safety](safety.md), with actual native tools and evidence routed by [AGENTS.md](../AGENTS.md). Before affected runtime integration verify isolated synthetic database/media state; never reuse donor volumes, live sessions, real funds or provider credentials. Accept each increment and journey only on its applicable criteria; keep unresolved scope open and continue independent authorized work. Protected effects, destructive actions, Git protection and external activation retain their own authority.

## What must be true before governance cutover

GOVERNANCE_CUTOVER: NOT_READY is unfinished semantic policy reconciliation, not an implementation ban or production readiness. Only this index records READY when all applicable conditions below are evidenced on the reviewed revision:

- Every active domain owner has been substantively reconciled with accepted decisions, material archived obligations and relevant original code, contracts and migrations. All admitted capability IDs route once to their substantive owners; every material right and subfeature is preserved or has a justified authorized disposition. File/heading counts and successful links alone are insufficient.
- Owner boundaries, policy values and consumer references agree; no active competing governance, duplicate writer/engine, unresolved critical business conflict or unbounded policy executor. Structural refoundation does not prove semantic completeness.
- Target commercial, architectural, security, migration and legal choices follow attributable human decisions, including 2026-11-13 and later superseding approvals. Preserve actual normative financial rules, threat model, payout/ledger formulas and protected migration strategy with applicable internal technical risk assessment. No extra outside consultant or independent staffing prerequisite merely to choose approved target policy. Mandatory operational segregation of duties remains binding.
- Actual consistency and reconciliation evidence identifies the exact reviewed revision and applicable approval. Neither historical routing evidence nor a self-asserted PASS establishes this. Record unresolved obligations and acceptance at their existing owner; no duplicate approval dossier or retired guard.

The [donor governance census](../docs/reference/DONOR-GOVERNANCE-SECTION-CENSUS.md) and [donor SQL source census](../docs/reference/DONOR-SERVICE-SQL-SOURCE-CENSUS.md) are historical evidence. Their unresolved substantive claims require actual reconciliation, not automatic acceptance or perpetual enforcement of superseded procedural restrictions.

## Cutover readiness is a policy decision, not a claim of implemented software

READY would establish that target policy is coherently reconciled for scoped implementation. It would not certify implemented applications, API parity, schema migrations, journeys, environment baseline, GitHub cutover or production. Apply engineering and safety acceptance to each affected scope, including actual internal critical-risk assessment, negative and adversarial cases, protected-record reconciliation, runtime and legal/contract evidence where applicable. Missing mandatory proof remains open. Never fabricate review/signature or treat policy approval, editing permission, Commit or Push as authority to merge, release or deploy.
