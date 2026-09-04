# Special Requests and Support/Rescue Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Trigger

Use for special-request/order-rescue incidents requiring support/operator intervention across DSH and possibly WLT.

## Diagnose

1. identify canonical order/request and trusted actor/operator context;
2. inspect DSH lifecycle/state and allowed rescue actions;
3. inspect partner/store/captain handoff/assignment facts when relevant;
4. inspect WLT payment/refund/compensation state separately;
5. distinguish user-visible issue from canonical state defect.

## Recovery

Support may invoke only explicit domain-owner actions. Do not mutate order/dispatch/payment tables directly or fabricate completion to match a desired UI.

Financial compensation/refund/reversal remains WLT-owned.

## Verify

Prove DSH operational readback, WLT financial readback where affected, audit evidence and all required user/partner/captain/operator surface outcomes.
