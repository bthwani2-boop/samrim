# Workforce Operations Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Trigger

Use for workforce profile/engagement/eligibility/readiness incidents affecting captain/field/other workforce-linked operations.

## Owners

Identity owns authentication/activation. Workforce owns workforce profile/engagement/eligibility. DSH owns operational assignment/task/fleet state. WLT owns financial truth.

## Diagnose

1. confirm actor identity and trusted scope;
2. read canonical Workforce profile/engagement/status;
3. read the consuming DSH operational state separately;
4. identify which owner is denying progress;
5. inspect correlation/audit evidence without copying sensitive documents.

## Recovery

Repair through the owner that owns the incorrect fact. Do not copy Workforce status into DSH or DSH assignment into Workforce to make the UI pass.

If an actor is authenticated but workforce-incomplete/suspended/ineligible, preserve that distinction.

## Verify

Re-read Workforce truth, then verify consuming operational surfaces observe the new allowed/denied result.
