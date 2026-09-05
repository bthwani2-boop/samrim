# Contracts and Generation

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Contract ownership

Each service owns the executable API/event schema for its public semantics.

Do not hand-maintain duplicate DTO/enum/status/action/operation registries when they can be generated from the canonical contract/domain source.

## Change sequence

For a material contract change:

1. update the canonical owner source;
2. validate schema/references;
3. generate deterministic outputs;
4. update affected consumers;
5. test only version-skew combinations that can occur in deployment;
6. remove obsolete generated/manual mirrors;
7. verify runtime/readback.

## Root contracts

Root `contracts/` is reserved for genuinely cross-service protocol primitives/catalog material. It must not become a business API dump.

## Compatibility

Internal consumers under atomic repository control should normally cut over together. Compatibility shims require a real consumer, bounded scope and deletion trigger.

## Generated artifacts

Generated files are reproducible outputs, not independent authorities. A generated-client mismatch is a contract-lineage defect.

Journey-ready contract lineage uses ordinary standards-compatible deterministic OpenAPI tooling rather than a private restricted parser/generator when mature tooling can represent the required contract faithfully. `governance/architecture/DATA-CONTRACTS-AND-INTEGRATIONS.md` owns the durable lineage rule; executable manifests/scripts remain the authority for the exact generator packages and commands installed on the current candidate.
