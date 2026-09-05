# Frontend Development

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Full-stack contract

Frontend work begins from Product meaning and executable service contracts, not from a mock screen.

For every material interaction verify:

- visibility/enabled state;
- actor/role/object scope;
- validated input;
- handler/controller binding;
- canonical capability owner;
- contract/API/event call;
- loading/pending;
- duplicate action/idempotency behavior;
- backend/system effect;
- persisted/observable readback;
- error mapping;
- retry/recovery;
- final navigation/visible state.

`RENDERED != WIRED`, `CLICKABLE != FUNCTIONAL`, and `LOCAL_SUCCESS != PERSISTED_SUCCESS`.

## State

Local UI state may represent transient interaction. It must not become a second business state machine or fabricate durable success.

## Validation

Client validation improves UX but never replaces server/domain validation or authorization.

## Accessibility/RTL

Arabic/RTL is a first-class mode. Applicable web/mobile work must account for semantic labels, focus/keyboard behavior, large text, touch targets, directionality and platform constraints.

## Presentation placement and reuse

Surface-specific feature presentation lives with the consuming app by default. It obtains canonical semantics through service public contracts/clients and must not clone business state machines, permissions or financial calculations.

Use the design system for reusable **domain-neutral** visual primitives/patterns. Extract shared presentation only after real multi-host reuse proves a stable responsibility; do not create service-owned app-shaped frontend trees or a generic shared business layer.

Business-specific copy and presentation derivation may live with the app feature, but durable business meaning/state/authorization remains at the semantic service owner.
