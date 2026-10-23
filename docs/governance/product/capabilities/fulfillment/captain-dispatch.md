# Captain Dispatch

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/fulfillment/captain-dispatch.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: CAPTAIN_DISPATCH

## Outcome

A ready `BTHWANI_CAPTAIN` Store Order may receive up to three concurrent DSH dispatch offers to eligible Captains, but at most one active assignment. The first valid, transactionally committed acceptance wins; all other open offers are superseded with capacity and financial exposure reconciled. Partner Captain dispatch remains separately governed.

## Ownership

DSH owns Captain standing operational eligibility/availability, dispatch offer, assignment and reassignment truth. WLT owns COD exposure/hold and other financial effects.

## Admission boundary

DSH establishes standing Captain operational eligibility before authorized Identity role admission. A transient delivery assignment is not standing role admission.

Store-affiliated Partner Captain eligibility belongs to `STORE_CAPTAIN_MEMBERSHIP` and does not silently place that relationship into the platform Captain dispatch pool.

## Invariants

- only a ready `BTHWANI_CAPTAIN` order is platform-dispatchable;
- the Captain app has three primary tabs: Home, Wallet and Account. Home is a full-height map that displays privacy-safe opportunity circles while idle and the canonical Store/Customer destination during an assigned mission; delivery actions remain on the internally reachable Deliveries route. Incoming offers are short non-modal floating cards on Home, never a full-screen interruption of active navigation; offers expire when not accepted and are suppressed while a mission is active or its state cannot be verified. An availability Switch writes through to DSH, and a separate device GPS status Switch reflects Android permissions/services. GPS activation requests OS permission/service enablement; deactivation opens OS location settings (no simulated silent OS toggle). Disabling GPS while available requires stopping dispatch availability first;
- ranking nearby available Captains may use an authorized, recent foreground GPS fix kept only as their latest dispatch presence; it never authorizes Client live tracking, delivery movement logs, or publication of Captains' positions in opportunity maps;
- an **active BTHWANI_CAPTAIN mission** may publish only the most recent authenticated Captain location for authorized Operations staff supervising that exact active order. This mission fix is separate from dispatch presence; it is not Client/Partner/Field tracking and it must not flow to opportunity heatmaps, notifications or movement-history logs. The Captain sees that mission location is shared with Operations while active;
- DSH accepts mission fixes only from the bearer-authenticated assigned Captain, with fresh event times, monotonic sequences and bounded accuracy. It stores no route trail, hides stale or lost fixes and hides location immediately when assignment is no longer active; the periodic retention worker physically purges old and terminal mission fixes;
- Android foreground mission tracking can be used only while the Captain app is active. Mission tracking after leaving the app requires a separately proven native background-location implementation with permissions, persistent notification and device testing; it must not be claimed to work from Expo Go or a foreground-only implementation. Android may stop background location after the app is terminated, so Operations displays a stale/lost signal rather than fictitious movement;

- DSH retains at most one foreground dispatch fix per available Captain. A fix older than 15 minutes is ineligible for dispatch and map aggregation and is physically purged by DSH's retention worker, run at startup and every minute (normal deletion lag up to one minute). Going offline, suspension or winning an assignment clears it immediately. Exact fixes are accessible only to the authorized Captain's own submission path and internal DSH dispatch ranking; the Captain map and authorized Operator map receive only thresholded coarse cells. No Client, Partner, Field or other Captain can read another Captain's exact dispatch fix;
- both Captain and Operator opportunity maps reject aggregate samples more than 3 minutes old or over 1 minute in the future and remove circles on any refresh failure; an empty privacy-safe result never implies zero demand;
- an outstanding offer reserves availability but does not erase fresh dispatch presence needed for immediate redistribution after rejection or expiry; the assigned winner's dispatch presence is cleared, and explicit offline/suspension also clears it;
- pre-acceptance offer details disclose only the coarse service-city delivery area, never the Customer's full address or destination coordinates; only the assigned Captain may read the precise delivery task;
- the Captain home and Operator Operations map overlay geographic circles for recent 30-minute platform delivery demand (orange) and available Captains' coarse density (teal) together by default without layer-selection tabs; the Captain presence input is only the latest authorized dispatch fix, not routes. Require a minimum safe number of independent Stores/orders or Captains before publishing any cell; never expose individual Captain coordinates, Customer delivery destinations, raw counts, live offers or guaranteed assignments;
- one platform-dispatch batch creates no more than three concurrent offers to distinct eligible available Captains;
- only an eligible available Captain with required financial exposure capacity may accept an applicable COD offer;
- one order has at most one active assignment, regardless of competing acceptances;
- successful assignment supersedes all losing open offers and restores their available capacity and financial holds through their owning services;
- capacity, eligibility and financial authorization are owner-backed and enforced under concurrency;
- only the authenticated offered Captain may accept/reject the live offer;
- expiry and rejection are durable decisions;
- reassignment before pickup is canonical and must reconcile any prior financial hold; after custody begins, ordinary reassignment is forbidden;
- no surface computes final dispatch authority.

## Failure and recovery

No eligible Captain, insufficient governed exposure, timeout, decline, stale offer, concurrent assignment, financial-hold failure, reassignment conflict and offline state preserve one assignment truth. Unknown cross-owner effects reconcile before another assignment/hold creates duplicate liability.
