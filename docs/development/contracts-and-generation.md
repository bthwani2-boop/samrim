# Contracts and Generation

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE

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

During the current refoundation, the journey-ready target standardizes normal OpenAPI generation rather than maintaining a private restricted parser/generator. The target toolchain is described in `tools/prompting/bthwani-refoundation/targets/contracts-and-protocols.md`; executable manifests/scripts remain the authority for what is actually installed and runnable on the current candidate.
