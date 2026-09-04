# Control Panel Development

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE

## Role

Control Panel is the trusted operator deployable host. It owns operator navigation/shell/composition, not Identity/Workforce/DSH/WLT/Platform Control domain semantics.

## Before adding an operator action

Prove:

- exact operator permission;
- trusted operator context;
- object/business scope;
- maker/checker separation when required;
- canonical owner mutation;
- version/conflict protection when required;
- audit event;
- canonical readback;
- failure/recovery semantics.

## Financial/admin sensitivity

Financial read permission does not imply mutation/approval permission. Broad operator-role labels cannot replace exact permissions.

## UI

Operator tables/forms/search/filtering are presentation concerns. Domain eligibility, state transitions and validation remain server-owned.
