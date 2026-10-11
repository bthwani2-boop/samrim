# Partner Onboarding and Store Publication

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/partner/partner-onboarding-store-publication.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: PARTNER_ONBOARDING_STORE_PUBLICATION

## Outcome

A prospective Partner progresses through one DSH-owned joining lifecycle to one canonically bound Partner actor and one governed Store-publication result. The first-Store intake captures the owner name and contact phone; Store name; Service City; primary Commerce Vertical and commercial Store Type; written address and fixed map location; weekly working hours; one or more initially admitted fulfillment modes; and onboarding evidence type and number (verified against the physical document outside the app). No document photograph is required or collected for new cases. The Store profile image is the public Store logo used in customer-facing cards, listings and details, and may be added or improved after Store approval but before publication. An optional internal review photo of the physical premises belongs only to the joining case. Operator-facing notes are optional.

## Ownership

DSH owns joining-case, Field standing admission/eligibility, assignment, Partner/Store readiness, review/correction, submitted owner contact and first-Store intake facts, canonical Service City, primary Commerce Vertical, commercial Store Type, initial Store fulfillment-mode assignment, operator-authorized post-creation fulfillment-mode policy changes, Store ownership binding and Store-publication truth. DSH supplies canonical Store context, joining attribution and enabled fulfillment modes to WLT for the Store Commercial Agreement; WLT owns proposal, acceptance, approval and activation of financial terms. Identity alone creates/resolves `actor_id` and admits `partner`/`field` roles after an authorized DSH request. Catalog publication remains with `CENTRAL_CATALOG`; current Store opening/orderability after publication belongs to `STORE_OPERATIONAL_AVAILABILITY`.

## Invariants

- a joining case may exist before `partner` role admission and is never a second Partner identity;
- canonical Service City is required first-Store data on the joining case;
- primary Commerce Vertical is required first-Store data on the joining case and transfers to the Store atomically;
- commercial Store Type is required first-Store data, belongs to exactly one compatible primary Commerce Vertical, and transfers from the joining case to the Store atomically;
- DSH owns the active commercial Store Type registry and validates the selected type against its parent Commerce Vertical; type identity is a stable canonical code, not a localized label;
- commercial Store Type describes the Store business model and is independent of catalog product categories; it is never inferred from products or category assignments;
- each Store has its own commercial Store Type, while its financial terms belong to its Store-specific STORE_COMMERCIAL_AGREEMENT; Stores with the same Store Type may have different active terms;
- first-Store Service City, Commerce Vertical, commercial Store Type and fulfillment-mode policy are preserved through review, correction and resubmission and become canonical Store facts atomically at Store creation;
- the required first-Store intake includes a submitted owner name and contact phone, Store name, active Service City, primary Commerce Vertical, compatible commercial Store Type, written Store address, fixed map coordinates, weekly working hours and one or more fulfillment modes; the owner name is an onboarding fact and does not silently replace the Identity account profile;
- first-Store intake may capture the bound Partner owner's official-wallet provider preference; WLT resolves the destination only after Identity binding and never takes a separate wallet number or beneficiary name;
- onboarding proof requires exactly one supported proof type (commercial registration, identity document or passport (legacy freelance-work records remain readable)) and its number, verified through authorized in-person review; a document image is not a submission, correction or publication prerequisite. Verification and any permitted paper archive stay outside the digital joining form;
- the existing case-scoped encrypted document number remains private; only authorized participants may retrieve the unmasked number. Previously uploaded document images, if present, are historical sensitive records and must not be silently deleted or made public. New submissions do not upload document images;
- the public Store logo is a required visual asset **before publication**, not a Field intake, admission, review or Store-creation blocker. Field may attach it during intake; authorized Operators or Partners may add/replace it later through the governed Store media owner. A published Store must have a canonical active logo. The same logo is reused across Customer, Partner and Operator views; A separate optional case-only premises review photo is never public or copied to Store media;
- weekly working hours are expressed in the selected Service City's local time and support closed days and multiple opening intervals in a day; optional onboarding notes are available to the Operator reviewer and do not replace structured intake facts;
- at first-Store creation, accepted joining-case working hours initialize the canonical `STORE_OPERATIONAL_AVAILABILITY` schedule in the same transaction, including overnight windows; the intake and Store business-hours snapshot remain historical context, not a second authority for live orderability; later authorized Partner/Operator changes use the operational-availability owner only;
- owner contact, address, map location, working hours, fulfillment modes and other submitted first-Store facts are preserved through review/correction and copied into their canonical Store owner at creation; the case remains the auditable intake snapshot;
- first-Store Store Type may be corrected before Store creation only through the governed case-correction path;
- after Store creation, only an active authorized Operator path may change the Store's durable enabled fulfillment-mode policy; Partner surfaces cannot mutate that durable policy;
- Partner may change only the temporary operational availability allowed by `STORE_OPERATIONAL_AVAILABILITY`; pausing a mode never enables/disables the durable admitted mode policy;
- fulfillment-mode policy mutation remains DSH-owned, versioned, attributable and auditable; the Operator surface is an authorized host, not a second writer;
- Partner is not city-scoped; a Partner may own multiple Stores in the same or different Service Cities;
- a new Store cannot be created without an active canonical Service City;
- DSH joining eligibility may request Identity `partner` role admission; generic account input cannot create that role;
- `partner` role authenticates the Partner workspace, while Store ownership remains a separate DSH relationship;
- once bound to canonical `actor_id`, retries cannot silently rebind the case;
- `field` is Partner Acquisition and Onboarding Representative only;
- Field standing admission is a distinct DSH-owned fact: an authorized Operator creates the candidate and may suspend/restore it; DSH may request Identity `field` role admission only for an eligible, unbound candidate, which binds to one canonical Field `actor_id`;
- a Field admission candidate captures the person's submitted name and contact phone, Service City and official-wallet provider preference; Identity alone accepts the canonical identity name and verified phone, and the provider preference does not create a payout destination;
- Field may originate/progress authorized joining work but cannot create Identity actors/roles, approve its own submission or publish a Store;
- owner review is distinct from Field submission;
- only a bound Partner may correct and resubmit its `needs_correction` case as one governed atomic business transition; Operator does not impersonate that resubmission;
- Store publication is distinct from serviceability, catalog/offer eligibility and current operational orderability;
- customer-visible Store publication requires applicable Store publication, active Service City assignment and catalog publication gates; current orderability is evaluated separately;
- Store publication requires an active Store-specific `STORE_COMMERCIAL_AGREEMENT` for its enabled fulfillment modes, explicit acceptance by the bound Partner owner of the exact agreement version, and Finance approval; Store Type suggestions, Store creation and catalog readiness cannot substitute for these gates;
- Field may perform authorized initial catalog work only for its assigned, bound joining Store before Go-Live; after successful publication that write authority ends and the Partner becomes the ongoing Store catalog operator;
- a published Store may remain customer-discoverable as closed/paused when current Product/experience policy allows, but checkout may not treat publication as proof that the Store can accept orders now;
- trusted case/business scope is derived server-side, never granted by request input;
- mutations are concurrency-safe, idempotent and attributable.

## Reference-readiness and participant-admission boundaries

The following are **different admission/operation gates**, not one compulsory global bootstrap chain:

- **Field candidate and standing admission:** an authorized Operator, DSH Field-admission policy/eligibility and the selected active Service City scope (or an admitted all-cities scope), plus any currently required active official-wallet provider option. A complete shared Product catalog, Store, JoiningCase or Store-specific agreement is **not** a prerequisite for admitting or activating a Field actor.
- **Field JoiningCase intake/submission:** the Field actor must have current standing and permitted case scope; the first Store requires an active canonical Service City, one active Commerce Vertical and a compatible active Commercial Store Type, along with its admitted contact, evidence, location, schedule and fulfillment-mode facts. DSH validates actual registry records, not presentation labels or client selections as authority.
- **Partner role admission:** only the approved DSH joining/ownership or admitted Store-delegation eligibility may request the `partner` role from Identity; a candidate or phone input alone does not create Partner standing.
- **Store publication:** separate, later Store-specific agreement acceptance/Finance approval, admitted initial catalog readiness and final Operator readiness; creating a Field account, JoiningCase, Partner account or Store never implies publication or current orderability.

Preparation of shared categories and representative shared Products before Field onboarding may be chosen as `PROGRAM_ORDER` to make initial Store catalog work practical. It is **not** an additional hard dependency for standing Field admission or a requirement that every possible shared Product be pre-created. Keep existing valid cases, identities and versions when a reference registry gains values.

## Minimal lifecycle

```text
FIELD
→ Operator candidate admission
→ DSH Field standing admission / eligibility
→ authorized Identity Field role admission, activation and access
→ assigned JoiningCase, Field intake and submission

PARTNER
→ Operator initial admission of the submitted case
→ DSH Partner eligibility
→ authorized Identity Partner role admission and access
→ canonical draft Store + owner binding
→ bound Partner confirmation/correction of onboarding data
→ WLT Store-specific agreement proposal
→ bound Partner acceptance of the exact agreement terms
→ Finance approval and WLT activation
→ authorized initial catalog readiness
→ final Operator readiness
→ Store publication
```

The joining form collects evidence type and number only. Physical-document verification and any controlled paper retention happen outside the app when required. Historical digital evidence remains purpose-limited under DSH ownership until an explicitly authorized retention decision. Storefront profile imagery remains a separately governed public-facing media asset.

## Failure and recovery

Duplicate logical case, duplicate-actor risk, missing required Service City/vertical/type, incompatible Store Type/Vertical, stale version, unauthorized cross-case access, incomplete prerequisites, correction loop and retry conflict recover through canonical DSH/Identity readback. A suspended or stale Field admission cannot originate joining work; restoring DSH standing and the applicable Identity role is an explicit authorized recovery. Recovery never guesses a Store classification or rebinds a case/Field admission to a different actor.

## Material participants

Field acquisition/onboarding work, Operator review/admission work, Partner post-admission work, Client publication consequences and DSH/Identity owner runtimes are material consumers. Store orderability is separately read from `STORE_OPERATIONAL_AVAILABILITY`.
