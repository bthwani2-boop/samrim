# Partner Onboarding and Store Publication

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/partner/partner-onboarding-store-publication.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: PARTNER_ONBOARDING_STORE_PUBLICATION

## Outcome

A prospective Partner progresses through one DSH-owned joining lifecycle to one canonically bound Partner actor and one governed Store-publication result. The first-Store intake captures the owner name and contact phone; Store name; Service City; primary Commerce Vertical and commercial Store Type; written address and fixed map location; one or more initially admitted fulfillment modes; and onboarding evidence type and number (verified against the physical document outside the app). No document photograph is required or collected for new cases. Each Store has a required public logo used in customer-facing cards and listings and a separate required public cover image used on its customer storefront; both may be added or improved after Store approval but before publication. Historical Field-origin Stores may retain an optional multi-image premises album on the canonical Store for authorized internal use only. These images are distinct from the optional joining-case review photo and never enter public Store projections. Operator-facing notes are optional.

## Ownership

DSH owns joining-case and Partner/Store readiness, review/correction, submitted owner contact and first-Store intake facts, canonical Service City, primary Commerce Vertical, commercial Store Type, initial Store fulfillment-mode assignment, operator-authorized post-creation fulfillment-mode policy changes, Store ownership binding and Store-publication truth. DSH supplies canonical Store context and enabled fulfillment modes to WLT for the Store Commercial Agreement; WLT owns proposal, acceptance, approval and activation of financial terms; an Operator with Partners permission may propose terms for an admitted Store independently of Field-origin joining cases. Identity alone creates/resolves `actor_id` and admits `partner` roles after an authorized DSH request. Catalog publication remains with `CENTRAL_CATALOG`; current Store opening/orderability after publication belongs to `STORE_OPERATIONAL_AVAILABILITY`.

## Invariants

- a joining case may exist before `partner` role admission and is never a second Partner identity;
- a prospective Partner may submit a first-Store application without Field or Operator initiation by authenticating an existing verified Identity `client` session, including through the Partner app's pre-role registration entrance. DSH verifies the live actor, role, enabled/security standing, canonical phone match and one immutable `applicant_actor_id` binding. `client` only proves the application owner's identity; it does not grant `partner` role, Store rights, publication or agreement acceptance;
- verified self-service intake has `origin=self_service`; it shares DSH joining-case constraints and the Operator review/admission path. Approval rechecks the originally bound canonical Identity actor and phone before provisioning `partner`, with no ownership rebind. Duplicate applications by that actor or the same contact phone fail closed; self-service case reads require the same actor and phone;
- canonical Service City is required first-Store data on the joining case;
- primary Commerce Vertical is required first-Store data on the joining case and transfers to the Store atomically;
- commercial Store Type is required first-Store data, belongs to exactly one compatible primary Commerce Vertical, and transfers from the joining case to the Store atomically;
- DSH owns the active commercial Store Type registry and validates the selected type against its parent Commerce Vertical; type identity is a stable canonical code, not a localized label;
- commercial Store Type describes the Store business model and is independent of catalog product categories; it is never inferred from products or category assignments;
- each Store has its own commercial Store Type, while its financial terms belong to its Store-specific STORE_COMMERCIAL_AGREEMENT; Stores with the same Store Type may have different active terms;
- first-Store Service City, Commerce Vertical, commercial Store Type and fulfillment-mode policy are preserved through review, correction and resubmission and become canonical Store facts atomically at Store creation;
- the required first-Store intake includes a submitted owner name and contact phone, Store name, active Service City, primary Commerce Vertical, compatible commercial Store Type, written Store address, fixed map coordinates and one or more fulfillment modes; the owner name is an onboarding fact and does not silently replace the Identity account profile;
- first-Store intake may capture the bound Partner owner's official-wallet provider preference; WLT resolves the destination only after Identity binding and never takes a separate wallet number or beneficiary name;
- onboarding proof requires exactly one supported proof type (commercial registration, identity document or passport (legacy freelance-work records remain readable)) and its number, verified through authorized in-person review; a document image is not a submission, correction or publication prerequisite. Verification and any permitted paper archive stay outside the digital joining form;
- the existing case-scoped encrypted document number remains private; only authorized participants may retrieve the unmasked number. Previously uploaded document images, if present, are historical sensitive records and must not be silently deleted or made public. New submissions do not upload document images;
- the public Store logo and a separate public Store cover image are required visual assets **before publication**, not a Field intake, admission, review or Store-creation blocker. Authorized Operators or Partners may add/replace them through the governed Store media owner; historical Field uploads remain preserved. After creation, media management is scoped to each canonical Store independently of its joining case: its owning Partner and authorized active Operator may read and replace the logo or cover, preserving version conflicts, upload recovery and provenance. A published Store must have both canonical active assets. The logo is reused as Store identity across Customer, Partner and Operator views; the cover is shown on the customer storefront. Historical Field premises photos form a multi-image Store-owned internal album, accessible only through authorized internal routes and never returned by public projections. The optional case-only premises review photo remains separate and is never public or copied to Store media;
- a Store may publish optional business-only contact phone, email and WhatsApp channels, maintained separately from the private JoiningCase owner contact. DSH owns this versioned and idempotent opt-in Store profile; only its bound Partner owner may edit it, a Partners-authorized Operator may review it and Client storefronts may read it only while that Store is publicly published and in an active Service City. Disabled WhatsApp numbers are withheld from public responses. No identity phone, protected intake detail, customer data or external payment/order route is copied into the public profile automatically;
- weekly working hours are expressed in the selected Service City's local time and support closed days and multiple opening intervals in a day; optional onboarding notes are available to the Operator reviewer and do not replace structured intake facts;
- at first-Store creation, accepted joining-case working hours initialize the canonical `STORE_OPERATIONAL_AVAILABILITY` schedule in the same transaction, including overnight windows; the intake and Store business-hours snapshot remain historical context, not a second authority for live orderability; later authorized Partner/Operator changes use the operational-availability owner only;
- owner contact, address, map location, chosen fulfillment modes and other first-Store intake facts remain auditable. Operating hours are optional during joining intake; when omitted the approved Store starts with an empty WEEKLY schedule (closed), never an inferred 24/7 schedule, and must receive an explicit operating schedule before publication;
- first-Store Store Type may be corrected before Store creation only through the governed case-correction path;
- after Store creation, only an active authorized Operator path may change the Store's durable enabled fulfillment-mode policy; Partner surfaces cannot mutate that durable policy;
- Partner may change only the temporary operational availability allowed by `STORE_OPERATIONAL_AVAILABILITY`; pausing a mode never enables/disables the durable admitted mode policy;
- fulfillment-mode policy mutation remains DSH-owned, versioned, attributable and auditable; the Operator surface is an authorized host, not a second writer;
- Partner is not city-scoped; a Partner may own multiple Stores in the same or different Service Cities;
- a new Store cannot be created without an active canonical Service City;
- DSH joining eligibility may request Identity `partner` role admission; generic account input cannot create that role;
- `partner` role authenticates the Partner workspace, while Store ownership remains a separate DSH relationship;
- once bound to canonical `actor_id`, retries cannot silently rebind the case;
- the retired `field` role and Field-origin case values are historical readback facts only;
- new first-Store joining work originates only from verified Partner self-service or authorized Operator intake. No new Field admissions, acquisition attributions or reward enqueues are permitted; historical cases and financial records remain readable;
- owner review is distinct from Field submission; the Partners Operator approves intake and creates the Store independently of the Finance permission and financial settlement policy. An approved case initially carries financial state `REQUIRED`; it is not financially active or eligible for publication. Only a separately authorized Finance action binds the active WLT settlement policy to that case through DSH, followed by WLT-backed financial profile activation. The Store-specific commercial agreement still independently requires the bound Partner's acceptance and Finance approval before publication; no approval silently accepts rates or terms;
- the bound Partner may correct and resubmit a `needs_correction` Field-originated case through the existing DSH atomic, versioned correction writer; retiring the Field app does not change the historical origin. The Operator cannot impersonate the Partner, approve its own correction, or change the case owner;
- Store publication is distinct from serviceability, catalog/offer eligibility and current operational orderability;
- customer-visible Store publication requires applicable Store publication, active Service City assignment and catalog publication gates; current orderability is evaluated separately;
- Store publication requires an active Store-specific `STORE_COMMERCIAL_AGREEMENT` for its enabled fulfillment modes, explicit acceptance by the bound Partner owner of the exact agreement version, and Finance approval; Store Type suggestions, Store creation and catalog readiness cannot substitute for these gates;
- The bound Partner manages the Store catalog before and after Go-Live through the Partner surface; joining-case authority alone does not grant Store catalog writes;
- a published Store may remain customer-discoverable as closed/paused when current Product/experience policy allows, but checkout may not treat publication as proof that the Store can accept orders now;
- trusted case/business scope is derived server-side, never granted by request input;
- mutations are concurrency-safe, idempotent and attributable.

## Reference-readiness and participant-admission boundaries

The following are **different admission/operation gates**, not one compulsory global bootstrap chain:

- **Current JoiningCase intake/submission:** verified prospective Partners use the self-service entrance or authorized Operators create the case. The first Store requires an active Service City, Commerce Vertical and compatible Commercial Store Type, along with contact, evidence, location and fulfillment modes. Omitted working hours initialize a CLOSED WEEKLY Store schedule and block publication until configured. DSH validates registry records, not presentation labels or client selections as authority. Field-origin writes are retired; existing cases keep their historical origin.
- **Partner role admission:** only the approved DSH joining/ownership or admitted Store-delegation eligibility may request the `partner` role from Identity; a candidate or phone input alone does not create Partner standing. Self-service first-Store applicants authenticate with the ordinary verified Identity client session for application submission only, with immutable applicant-actor binding and explicit Operator admission before Partner role provisioning.
- **Store publication:** separate, later Store-specific agreement acceptance/Finance approval, admitted initial catalog readiness and final Operator readiness; creating a Field account, JoiningCase, Partner account or Store never implies publication or current orderability.

Preparation of shared categories and representative shared Products before Partner onboarding may be chosen as `PROGRAM_ORDER` to make initial Store catalog work practical. It is **not** an additional hard dependency for Partner onboarding or a requirement that every possible shared Product be pre-created. Keep existing valid cases, identities and versions when a reference registry gains values.

## Minimal lifecycle

```text
PARTNER
→ verified self-service application or Operator-created intake
→ Operator initial admission of the submitted case
→ DSH Partner eligibility
→ authorized Identity Partner role admission and access
→ canonical draft Store + owner binding
→ bound Partner corrects returned onboarding data if requested (own session only)
→ WLT Store-specific agreement proposal
→ bound Partner acceptance of the exact agreement terms
→ Finance approval and WLT activation
→ authorized initial catalog readiness
→ final Operator readiness
→ Store publication
```

The joining form collects evidence type and number only. Physical-document verification and any controlled paper retention happen outside the app when required. Historical digital evidence remains purpose-limited under DSH ownership until an explicitly authorized retention decision. Storefront profile imagery remains a separately governed public-facing media asset.

## Failure and recovery

Duplicate logical case, duplicate-actor risk, missing required Service City/vertical/type, incompatible Store Type/Vertical, stale version, unauthorized cross-case access, incomplete prerequisites, correction loop and retry conflict recover through canonical DSH/Identity readback. Retired Field admission is not a recovery entrance. Partner and Operator admission recover through their current canonical DSH and Identity paths; recovery never guesses a Store classification or rebinds a case to a different actor.

## Material participants

Operator review/admission, prospective Partner self-service, Partner post-admission work, Client publication consequences and DSH/Identity owner runtimes are material consumers. Field acquisition attribution and historical earnings remain separate readback and finance concerns. Store orderability is separately read from `STORE_OPERATIONAL_AVAILABILITY`.
