# BThwani — Pinned donor governance section census (not semantic approval)

ARTIFACT_CLASS: NON_AUTHORITATIVE_SOURCE_INVENTORY
SEMANTIC_OWNER: docs/reference/DONOR-GOVERNANCE-SECTION-CENSUS.md
STATUS: SOURCE_HEADING_CENSUS_ONLY
GOVERNANCE_CUTOVER: NOT_READY
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Provenance and strict limitations

- Donor: `D:\samrim`, branch `41`, HEAD `426d67b47beb8c66b09acd8c7394086b53ac5aae`.
- Candidate: `D:\samrim-refoundation-clean-20261112`, HEAD `d4f542df68533b06d42aa3a1a8b3338fd5a757c9`.
- Read-only census of exactly 14 donor domain-owner Markdown files, paired with their 14 same-named draft target owners. Donor README, separate historical plans, source code, ZIPs and six approved discussion sequences have not been reconciled by this artifact.
- A heading is only a navigation aid. An exact title match does not prove semantic parity; a renamed or missing title does not prove the underlying decision is absent.
- Rows are individually pinned to source Git blob and 1-based line number. **All semantic dispositions remain REVIEW_PENDING** until the material text below each heading, approved decisions and owner contract are compared.
- No automatic KEEP/RETIRE/COMPLETE status is derived from wording; unheaded paragraphs and all deeper implementation artifacts require separate review.

## Navigation-only summary

| Donor domain | Donor headings | Target headings | Literal matching headings | Donor Git blob | Target owner |
| --- | ---: | ---: | ---: | --- | --- |
| `product` | 7 | 5 | 0 | `6a22dfc44dd9ea5b89f13dad61f4bb6434c44c0e` | `governance/product.md` |
| `platform` | 6 | 4 | 1 | `94050e7f56d957c411331407615b20ec0c9fb86b` | `governance/platform.md` |
| `architecture` | 13 | 7 | 0 | `650fa58a0a9e0ee50a322266fcd2de028f15a0db` | `governance/architecture.md` |
| `identity` | 12 | 4 | 0 | `bc68ed1256c3b493b5c4366b1bc47dedb47b668a` | `governance/identity.md` |
| `stores` | 37 | 8 | 0 | `53f4a7adccac72e8026a22513d47f7dc4bf182ce` | `governance/stores.md` |
| `catalog` | 19 | 7 | 0 | `82395ab4cccef9c373f9dc980ae01a649b5e3067` | `governance/catalog.md` |
| `commerce` | 46 | 15 | 0 | `8dac1479ba410a0dd50dd55e06015618d4c3b935` | `governance/commerce.md` |
| `fulfillment` | 28 | 9 | 0 | `e9898c400d4249b460dd3a3b478b2a5ed1713a2f` | `governance/fulfillment.md` |
| `finance` | 44 | 24 | 0 | `319d71afe28686f8b1c8ad3e06289fe81cf3f532` | `governance/finance.md` |
| `hr` | 11 | 3 | 0 | `decf9fe861166552db27c72ed02d595d824204ef` | `governance/hr.md` |
| `experience` | 27 | 13 | 0 | `651424bffb32280177afcb41e378c380bf6b332d` | `governance/experience.md` |
| `safety` | 3 | 7 | 0 | `24dd35f1bddfc2129422183b4c81e6b43bcaa23f` | `governance/safety.md` |
| `engineering` | 23 | 13 | 0 | `c38edd07e1227a596cd5e41edf3f0bf36c525db0` | `governance/engineering.md` |
| `journeys` | 64 | 19 | 0 | `509dbe59c6b19fbca1d05d7afb2cafa417af11fc` | `governance/journeys.md` |
| **TOTAL** | **340** | **138** | **1** | — | **14 domain owners** |

## Source-heading evidence by owner

YES/NO is only about **exact Markdown heading literal**, not fulfillment of any business, legal, security, financial or technical requirement.

### product

Donor `docs/governance/product.md` (Git blob `6a22dfc44dd9ea5b89f13dad61f4bb6434c44c0e`); target draft `governance/product.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 8 | ## Purpose | NO | REVIEW_PENDING |
| 14 | ## Current approved Product target | NO | REVIEW_PENDING |
| 47 | ## Minimum complete and evolvable model | NO | REVIEW_PENDING |
| 57 | ## Admitted capabilities | NO | REVIEW_PENDING |
| 88 | ## Product-wide invariants | NO | REVIEW_PENDING |
| 119 | ## Explicit current non-goals | NO | REVIEW_PENDING |
| 127 | ## Capability admission law | NO | REVIEW_PENDING |

### platform

Donor `docs/governance/platform.md` (Git blob `94050e7f56d957c411331407615b20ec0c9fb86b`); target draft `governance/platform.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 8 | ## Platform definition | NO | REVIEW_PENDING |
| 14 | ## Human Actor model | NO | REVIEW_PENDING |
| 43 | ### User terminology versus deployed identifiers | NO | REVIEW_PENDING |
| 49 | ### Refoundation naming cutover | NO | REVIEW_PENDING |
| 53 | ## Surface model | YES | REVIEW_PENDING |
| 61 | ## Canonical terms | NO | REVIEW_PENDING |

### architecture

Donor `docs/governance/architecture.md` (Git blob `650fa58a0a9e0ee50a322266fcd2de028f15a0db`); target draft `governance/architecture.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 8 | ## Bounded owners | NO | REVIEW_PENDING |
| 53 | ## Architecture selection | NO | REVIEW_PENDING |
| 57 | ## Mandatory single-owner and single-engine law | NO | REVIEW_PENDING |
| 69 | ## Adapter boundary | NO | REVIEW_PENDING |
| 77 | ## Surface boundary | NO | REVIEW_PENDING |
| 83 | ## Canonical writer/readback law | NO | REVIEW_PENDING |
| 98 | ## Canonical identity evolution law | NO | REVIEW_PENDING |
| 104 | ## Cross-boundary contracts | NO | REVIEW_PENDING |
| 122 | ## Trust-boundary validation | NO | REVIEW_PENDING |
| 139 | ## Data ownership | NO | REVIEW_PENDING |
| 145 | ## Runtime/configuration | NO | REVIEW_PENDING |
| 156 | ## Responsibility-shaped implementation boundaries | NO | REVIEW_PENDING |
| 162 | ## Repository boundary | NO | REVIEW_PENDING |

### identity

Donor `docs/governance/identity.md` (Git blob `bc68ed1256c3b493b5c4366b1bc47dedb47b668a`); target draft `governance/identity.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 8 | ## IDENTITY_ACTIVATION_SESSIONS — Identity Activation Sessions | NO | REVIEW_PENDING |
| 12 | ### Outcome | NO | REVIEW_PENDING |
| 16 | ### Ownership | NO | REVIEW_PENDING |
| 20 | ### Role-specific lifecycle | NO | REVIEW_PENDING |
| 30 | ### Client identity across the marketplace and Store websites | NO | REVIEW_PENDING |
| 39 | ### Invariants | NO | REVIEW_PENDING |
| 55 | ### Operator invariants | NO | REVIEW_PENDING |
| 59 | ### Failure and recovery | NO | REVIEW_PENDING |
| 63 | ### Material participants | NO | REVIEW_PENDING |
| 67 | ### Operator Finance permission | NO | REVIEW_PENDING |
| 71 | ### Operator Platform Policies permission | NO | REVIEW_PENDING |
| 75 | ### Operator workspace permission boundaries | NO | REVIEW_PENDING |

### stores

Donor `docs/governance/stores.md` (Git blob `53f4a7adccac72e8026a22513d47f7dc4bf182ce`); target draft `governance/stores.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 8 | ## PARTNER_ONBOARDING_STORE_PUBLICATION — Partner Onboarding and Store Publication | NO | REVIEW_PENDING |
| 12 | ### Outcome | NO | REVIEW_PENDING |
| 17 | ### Ownership | NO | REVIEW_PENDING |
| 20 | ### Current Store enrollment availability policy | NO | REVIEW_PENDING |
| 26 | ### Current direct-registration and Store invariants | NO | REVIEW_PENDING |
| 40 | ### Historical evidence protection | NO | REVIEW_PENDING |
| 44 | ### Store-specific readiness and publication | NO | REVIEW_PENDING |
| 53 | ### Further Stores: one DSH create command, two authorized entry points | NO | REVIEW_PENDING |
| 59 | ### Current direct Merchant registration and Store lifecycle | NO | REVIEW_PENDING |
| 69 | ### Failure and recovery | NO | REVIEW_PENDING |
| 73 | ### Material participants | NO | REVIEW_PENDING |
| 77 | ## STORE_RELATION_MODEL — Store Relation Model | NO | REVIEW_PENDING |
| 81 | ### Outcome | NO | REVIEW_PENDING |
| 85 | ### Ownership and relation semantics | NO | REVIEW_PENDING |
| 91 | ### Shared Store presentation contract | NO | REVIEW_PENDING |
| 97 | #### Approved Client Web storefront composition | NO | REVIEW_PENDING |
| 105 | #### One mutation, consistent eligible reads | NO | REVIEW_PENDING |
| 115 | ### Relation conversion — governed target, not yet activated | NO | REVIEW_PENDING |
| 121 | ### Publication and rollout boundary | NO | REVIEW_PENDING |
| 131 | ### Delivery boundary | NO | REVIEW_PENDING |
| 139 | ## STORE_OPERATIONAL_AVAILABILITY — Store Operational Availability | NO | REVIEW_PENDING |
| 143 | ### Outcome | NO | REVIEW_PENDING |
| 147 | ### Ownership | NO | REVIEW_PENDING |
| 151 | ### Invariants | NO | REVIEW_PENDING |
| 168 | ### Minimal state semantics | NO | REVIEW_PENDING |
| 181 | ### Failure and recovery | NO | REVIEW_PENDING |
| 185 | ### Material participants | NO | REVIEW_PENDING |
| 189 | ### Explicit non-goals | NO | REVIEW_PENDING |
| 193 | ## STORE_SCOPED_ACCESS_DELEGATION — Store-Scoped Access Delegation | NO | REVIEW_PENDING |
| 197 | ### Outcome | NO | REVIEW_PENDING |
| 201 | ### Ownership | NO | REVIEW_PENDING |
| 205 | ### Surface/session contract | NO | REVIEW_PENDING |
| 227 | ### Permission model | NO | REVIEW_PENDING |
| 237 | ### Invariants | NO | REVIEW_PENDING |
| 252 | ### Failure and recovery | NO | REVIEW_PENDING |
| 256 | ### Proof boundary | NO | REVIEW_PENDING |
| 261 | ### Store owner-created member accounts — approved 2026-10-21 | NO | REVIEW_PENDING |

### catalog

Donor `docs/governance/catalog.md` (Git blob `82395ab4cccef9c373f9dc980ae01a649b5e3067`); target draft `governance/catalog.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 8 | ## CENTRAL_CATALOG — Central Catalog | NO | REVIEW_PENDING |
| 12 | ### Outcome | NO | REVIEW_PENDING |
| 25 | ### Ownership and verticals | NO | REVIEW_PENDING |
| 43 | ### Reference classification and sequencing boundaries | NO | REVIEW_PENDING |
| 67 | ### Shared catalog taxonomy and data definitions | NO | REVIEW_PENDING |
| 90 | ### Product and ProductVariant | NO | REVIEW_PENDING |
| 123 | ### Identifiers and media | NO | REVIEW_PENDING |
| 130 | ### StoreOffer and StorefrontSection | NO | REVIEW_PENDING |
| 170 | ### Restaurant modifiers | NO | REVIEW_PENDING |
| 180 | ### Customer visibility and read model | NO | REVIEW_PENDING |
| 203 | ### Minimal Store product-entry path — one catalog engine | NO | REVIEW_PENDING |
| 213 | ### Operator and Partner operations | NO | REVIEW_PENDING |
| 237 | ### Evolution and migration invariants | NO | REVIEW_PENDING |
| 249 | ### Failure, security and proof invariants | NO | REVIEW_PENDING |
| 270 | ## CUSTOMER_STORE_CATALOG — Customer Store Catalog | NO | REVIEW_PENDING |
| 274 | ### Outcome | NO | REVIEW_PENDING |
| 278 | ### Ownership | NO | REVIEW_PENDING |
| 282 | ### Invariants | NO | REVIEW_PENDING |
| 293 | ### Failure and recovery | NO | REVIEW_PENDING |

### commerce

Donor `docs/governance/commerce.md` (Git blob `8dac1479ba410a0dd50dd55e06015618d4c3b935`); target draft `governance/commerce.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 8 | ## SERVICEABILITY_ADDRESSES — Serviceability and Addresses | NO | REVIEW_PENDING |
| 12 | ### Outcome | NO | REVIEW_PENDING |
| 16 | ### Ownership | NO | REVIEW_PENDING |
| 20 | ### Admitted policy: CITY_SCOPE_V2_RADIUS_30KM | NO | REVIEW_PENDING |
| 46 | ### Invariants | NO | REVIEW_PENDING |
| 57 | ### Location Core and Service City relationship | NO | REVIEW_PENDING |
| 72 | ### Failure and recovery | NO | REVIEW_PENDING |
| 76 | ## CART_CHECKOUT — Cart and Checkout | NO | REVIEW_PENDING |
| 80 | ### Outcome | NO | REVIEW_PENDING |
| 84 | ### Ownership | NO | REVIEW_PENDING |
| 88 | ### Invariants | NO | REVIEW_PENDING |
| 104 | ### Financial boundary | NO | REVIEW_PENDING |
| 108 | ### Failure and recovery | NO | REVIEW_PENDING |
| 112 | ### Material participants | NO | REVIEW_PENDING |
| 116 | ## MULTI_STORE_CHECKOUT — Multi-Store Checkout | NO | REVIEW_PENDING |
| 120 | ### Outcome | NO | REVIEW_PENDING |
| 124 | ### Ownership | NO | REVIEW_PENDING |
| 128 | ### Invariants | NO | REVIEW_PENDING |
| 139 | ### Failure and recovery | NO | REVIEW_PENDING |
| 143 | ## ORDER_LIFECYCLE — Order Lifecycle | NO | REVIEW_PENDING |
| 147 | ### Outcome | NO | REVIEW_PENDING |
| 151 | ### Ownership | NO | REVIEW_PENDING |
| 155 | ### Invariants | NO | REVIEW_PENDING |
| 180 | ### Order adjustment boundary | NO | REVIEW_PENDING |
| 194 | ### Lifecycle boundary | NO | REVIEW_PENDING |
| 198 | ### Failure and recovery | NO | REVIEW_PENDING |
| 202 | ## ORDER_CONVERSATION — Order Conversation | NO | REVIEW_PENDING |
| 206 | ### Outcome | NO | REVIEW_PENDING |
| 210 | ### Ownership | NO | REVIEW_PENDING |
| 214 | ### Invariants | NO | REVIEW_PENDING |
| 231 | ### Failure and recovery | NO | REVIEW_PENDING |
| 235 | ## COMMERCE_PROMOTIONS — Commerce Promotions | NO | REVIEW_PENDING |
| 239 | ### Outcome | NO | REVIEW_PENDING |
| 243 | ### Ownership | NO | REVIEW_PENDING |
| 247 | ### Current admitted forms | NO | REVIEW_PENDING |
| 257 | ### Scope and lifecycle | NO | REVIEW_PENDING |
| 263 | ### Funding | NO | REVIEW_PENDING |
| 267 | ### Invariants | NO | REVIEW_PENDING |
| 280 | ### Customer readback | NO | REVIEW_PENDING |
| 284 | ### Failure and recovery | NO | REVIEW_PENDING |
| 288 | ### Proof boundary | NO | REVIEW_PENDING |
| 292 | ## DISCOVERY_CONTENT — Discovery Content | NO | REVIEW_PENDING |
| 296 | ### Outcome | NO | REVIEW_PENDING |
| 300 | ### Ownership | NO | REVIEW_PENDING |
| 304 | ### Invariants | NO | REVIEW_PENDING |
| 322 | ### Failure and recovery | NO | REVIEW_PENDING |

### fulfillment

Donor `docs/governance/fulfillment.md` (Git blob `e9898c400d4249b460dd3a3b478b2a5ed1713a2f`); target draft `governance/fulfillment.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 8 | ## STORE_CAPTAIN_MEMBERSHIP — Store Captain Membership | NO | REVIEW_PENDING |
| 12 | ### Outcome | NO | REVIEW_PENDING |
| 16 | ### Ownership | NO | REVIEW_PENDING |
| 20 | ### Minimal lifecycle | NO | REVIEW_PENDING |
| 32 | ### Invariants | NO | REVIEW_PENDING |
| 45 | ### Failure and recovery | NO | REVIEW_PENDING |
| 50 | ### Store owner-created Captains — approved 2026-10-21 | NO | REVIEW_PENDING |
| 56 | ## CAPTAIN_DISPATCH — Captain Dispatch | NO | REVIEW_PENDING |
| 60 | ### Outcome | NO | REVIEW_PENDING |
| 64 | ### Ownership | NO | REVIEW_PENDING |
| 68 | ### Admission boundary | NO | REVIEW_PENDING |
| 77 | ### Invariants | NO | REVIEW_PENDING |
| 101 | ### Failure and recovery | NO | REVIEW_PENDING |
| 105 | ## STORE_CAPTAIN_HANDOFF — Store to Captain Handoff | NO | REVIEW_PENDING |
| 109 | ### Outcome | NO | REVIEW_PENDING |
| 113 | ### Ownership | NO | REVIEW_PENDING |
| 117 | ### Invariants | NO | REVIEW_PENDING |
| 129 | ### Failure and recovery | NO | REVIEW_PENDING |
| 133 | ## FINAL_MILE_DELIVERY — Final Mile Delivery | NO | REVIEW_PENDING |
| 137 | ### Outcome | NO | REVIEW_PENDING |
| 141 | ### Ownership | NO | REVIEW_PENDING |
| 145 | ### Invariants | NO | REVIEW_PENDING |
| 162 | ### Failure and recovery | NO | REVIEW_PENDING |
| 166 | ## CUSTOMER_PICKUP — Customer Pickup | NO | REVIEW_PENDING |
| 170 | ### Outcome | NO | REVIEW_PENDING |
| 174 | ### Ownership | NO | REVIEW_PENDING |
| 178 | ### Invariants | NO | REVIEW_PENDING |
| 187 | ### Failure and recovery | NO | REVIEW_PENDING |

### finance

Donor `docs/governance/finance.md` (Git blob `319d71afe28686f8b1c8ad3e06289fe81cf3f532`); target draft `governance/finance.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 10 | ## Financial Integrity Policy | NO | REVIEW_PENDING |
| 14 | ### Money representation | NO | REVIEW_PENDING |
| 35 | ### Financial ownership and conservation | NO | REVIEW_PENDING |
| 57 | ### External funding and internal balance | NO | REVIEW_PENDING |
| 74 | ### Captain COD coverage and wallet settlement | NO | REVIEW_PENDING |
| 101 | ### Fees, discounts and commissions | NO | REVIEW_PENDING |
| 109 | ### Refunds, payouts and settlement | NO | REVIEW_PENDING |
| 137 | ### Store payout-recipient routing | NO | REVIEW_PENDING |
| 147 | ### Beneficiary settlement intake before external transfer | NO | REVIEW_PENDING |
| 153 | ### Cross-owner reliability | NO | REVIEW_PENDING |
| 167 | ### Finance access | NO | REVIEW_PENDING |
| 171 | ## STORE_COMMERCIAL_AGREEMENT — Store Commercial Agreement | NO | REVIEW_PENDING |
| 175 | ### Outcome | NO | REVIEW_PENDING |
| 179 | ### Ownership | NO | REVIEW_PENDING |
| 183 | ### Approved Store commercial models | NO | REVIEW_PENDING |
| 206 | ### Invariants | NO | REVIEW_PENDING |
| 226 | ### Failure and recovery | NO | REVIEW_PENDING |
| 230 | ## ORDER_PAYMENT_COLLECTION — Order Payment and Collection | NO | REVIEW_PENDING |
| 234 | ### Outcome | NO | REVIEW_PENDING |
| 238 | ### Ownership | NO | REVIEW_PENDING |
| 242 | ### Collection responsibility and custody gates | NO | REVIEW_PENDING |
| 248 | ### Invariants | NO | REVIEW_PENDING |
| 277 | ### Failure and recovery | NO | REVIEW_PENDING |
| 281 | ## CUSTOMER_BALANCE_FUNDING — Customer Balance Funding | NO | REVIEW_PENDING |
| 285 | ### Outcome | NO | REVIEW_PENDING |
| 289 | ### Ownership | NO | REVIEW_PENDING |
| 293 | ### Invariants | NO | REVIEW_PENDING |
| 303 | ### Failure and recovery | NO | REVIEW_PENDING |
| 307 | ## CAPTAIN_BALANCE_FUNDING — BThwani Captain Balance Funding | NO | REVIEW_PENDING |
| 311 | ### Outcome | NO | REVIEW_PENDING |
| 315 | ### Ownership | NO | REVIEW_PENDING |
| 319 | ### Invariants | NO | REVIEW_PENDING |
| 332 | ### Failure and recovery | NO | REVIEW_PENDING |
| 336 | ## PARTNER_CAPTAIN_EARNINGS_SETTLEMENT — Partner and Captain Earnings Settlement | NO | REVIEW_PENDING |
| 340 | ### Outcome | NO | REVIEW_PENDING |
| 344 | ### Ownership | NO | REVIEW_PENDING |
| 348 | ### Invariants | NO | REVIEW_PENDING |
| 378 | ### Minimal recipient-assignment state semantics | NO | REVIEW_PENDING |
| 390 | ### Failure and recovery | NO | REVIEW_PENDING |
| 394 | ## CUSTOMER_BALANCE_MANUAL_WITHDRAWAL — Customer Balance Manual Withdrawal Exception | NO | REVIEW_PENDING |
| 398 | ### Outcome | NO | REVIEW_PENDING |
| 402 | ### Ownership | NO | REVIEW_PENDING |
| 406 | ### Invariants | NO | REVIEW_PENDING |
| 418 | ### Failure and recovery | NO | REVIEW_PENDING |

### hr

Donor `docs/governance/hr.md` (Git blob `decf9fe861166552db27c72ed02d595d824204ef`); target draft `governance/hr.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 8 | ## EMPLOYEE_HR — BThwani Employee HR (EMPLOYEE_HR) | NO | REVIEW_PENDING |
| 12 | ### Actors and identity | NO | REVIEW_PENDING |
| 16 | ### Admission and operator privileges | NO | REVIEW_PENDING |
| 20 | ### Employment data and privacy | NO | REVIEW_PENDING |
| 24 | #### Manual attendance initial implementation | NO | REVIEW_PENDING |
| 36 | ### Attendance, compensation and custody | NO | REVIEW_PENDING |
| 42 | ### Experience and safe evolution | NO | REVIEW_PENDING |
| 46 | #### HR-requested versus Identity-granted permissions | NO | REVIEW_PENDING |
| 65 | #### Single employee; conditional operator access | NO | REVIEW_PENDING |
| 80 | #### Employment lifecycle and safe operator offboarding | NO | REVIEW_PENDING |
| 95 | #### HR employee audit readback | NO | REVIEW_PENDING |

### experience

Donor `docs/governance/experience.md` (Git blob `651424bffb32280177afcb41e378c380bf6b332d`); target draft `governance/experience.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 8 | ## Experience and Interaction Policy | NO | REVIEW_PENDING |
| 14 | ### BThwani experience contract | NO | REVIEW_PENDING |
| 28 | ### Store interface presentation — one Client application | NO | REVIEW_PENDING |
| 34 | ### Effort-minimal experience at operational scale | NO | REVIEW_PENDING |
| 46 | ### Information architecture and application shell | NO | REVIEW_PENDING |
| 71 | #### Merchant management experience — one Expo app on mobile and web | NO | REVIEW_PENDING |
| 79 | #### Operator Policies work center: one composition, canonical owners | NO | REVIEW_PENDING |
| 85 | #### Operator operations-at-scale contract | NO | REVIEW_PENDING |
| 126 | ### Interaction and platform adaptation | NO | REVIEW_PENDING |
| 138 | ### State, feedback, recovery and truth | NO | REVIEW_PENDING |
| 148 | ### Arabic, RTL and localization | NO | REVIEW_PENDING |
| 167 | ### Accessibility | NO | REVIEW_PENDING |
| 176 | ### Evidence | NO | REVIEW_PENDING |
| 202 | ## Design and Visual Identity Policy | NO | REVIEW_PENDING |
| 225 | ### Visual character | NO | REVIEW_PENDING |
| 231 | ### Brand anchors and color semantics | NO | REVIEW_PENDING |
| 249 | #### Compiled defaults and governed Studio overrides | NO | REVIEW_PENDING |
| 255 | ### One Studio authoring workflow, one publication authority | NO | REVIEW_PENDING |
| 265 | ### Typography and numeric expression | NO | REVIEW_PENDING |
| 273 | ### Spacing, density and hierarchy | NO | REVIEW_PENDING |
| 285 | ### Shape, surfaces, elevation and depth | NO | REVIEW_PENDING |
| 293 | ### Iconography, imagery and media | NO | REVIEW_PENDING |
| 299 | ### Motion | NO | REVIEW_PENDING |
| 305 | ### Light and dark appearance | NO | REVIEW_PENDING |
| 311 | ### Cross-platform expression | NO | REVIEW_PENDING |
| 315 | ### Design-system boundary | NO | REVIEW_PENDING |
| 335 | ### Evidence and change control | NO | REVIEW_PENDING |

### safety

Donor `docs/governance/safety.md` (Git blob `24dd35f1bddfc2129422183b4c81e6b43bcaa23f`); target draft `governance/safety.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 8 | ## Security Policy | NO | REVIEW_PENDING |
| 22 | ## Data Policy | NO | REVIEW_PENDING |
| 42 | ## Reliability Policy | NO | REVIEW_PENDING |

### engineering

Donor `docs/governance/engineering.md` (Git blob `c38edd07e1227a596cd5e41edf3f0bf36c525db0`); target draft `governance/engineering.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 8 | ## Change and Delivery Policy | NO | REVIEW_PENDING |
| 24 | ### Refoundation readiness, feature preservation and evidence | NO | REVIEW_PENDING |
| 32 | ### Full-system refoundation acceptance | NO | REVIEW_PENDING |
| 42 | ### Structural cleanup within refoundation slices | NO | REVIEW_PENDING |
| 48 | ### Admission of operator-editable policies | NO | REVIEW_PENDING |
| 64 | ### Policy defaults, runtime eligibility and owner-backed bootstrap | NO | REVIEW_PENDING |
| 72 | ## Quality Policy | NO | REVIEW_PENDING |
| 87 | ## Performance, Capacity and Scalability | NO | REVIEW_PENDING |
| 89 | ### Purpose and admission | NO | REVIEW_PENDING |
| 95 | ### Measurement and optimization order | NO | REVIEW_PENDING |
| 101 | ### Data and database boundaries | NO | REVIEW_PENDING |
| 109 | ### Caches, search and asynchronous work | NO | REVIEW_PENDING |
| 117 | ### Request, media and user-facing efficiency | NO | REVIEW_PENDING |
| 125 | ### Runtime, deployment and failure domains | NO | REVIEW_PENDING |
| 135 | ### Observability, security, release and recovery | NO | REVIEW_PENDING |
| 143 | ### Closure | NO | REVIEW_PENDING |
| 147 | ## Providers and Integrations Policy | NO | REVIEW_PENDING |
| 149 | ### Financial rail activation by environment | NO | REVIEW_PENDING |
| 170 | ## Knowledge Policy | NO | REVIEW_PENDING |
| 172 | ### Durable knowledge | NO | REVIEW_PENDING |
| 181 | ### Evidence routing | NO | REVIEW_PENDING |
| 201 | ### Technology opportunity and stability | NO | REVIEW_PENDING |
| 220 | ### External reference curation | NO | REVIEW_PENDING |

### journeys

Donor `docs/governance/journeys.md` (Git blob `509dbe59c6b19fbca1d05d7afb2cafa417af11fc`); target draft `governance/journeys.md`.

| Donor line | Exact source heading | Literal heading in target? | Semantic review |
| ---: | --- | --- | --- |
| 8 | ## End-to-end scenario boundary | NO | REVIEW_PENDING |
| 28 | ## MANAGED_PARTICIPANT_ADMISSION — admitted managed actor becomes usable | NO | REVIEW_PENDING |
| 39 | ### Frontstage and handoffs | NO | REVIEW_PENDING |
| 52 | ### Failure / recovery | NO | REVIEW_PENDING |
| 56 | ### Negative space | NO | REVIEW_PENDING |
| 60 | ## PARTNER_TO_VISIBLE_STORE — direct registration to customer-visible Store | NO | REVIEW_PENDING |
| 71 | ### Frontstage and handoffs | NO | REVIEW_PENDING |
| 88 | ### Failure / recovery | NO | REVIEW_PENDING |
| 92 | ### Negative space | NO | REVIEW_PENDING |
| 96 | ## STORE_ORDERABILITY — published Store to current ability to accept orders | NO | REVIEW_PENDING |
| 107 | ### Frontstage and handoffs | NO | REVIEW_PENDING |
| 117 | ### Failure / recovery | NO | REVIEW_PENDING |
| 121 | ### Negative space | NO | REVIEW_PENDING |
| 125 | ## CATALOG_TO_CUSTOMER_OFFER — canonical catalog to customer-safe assortment | NO | REVIEW_PENDING |
| 136 | ### Frontstage and handoffs | NO | REVIEW_PENDING |
| 147 | ### Failure / recovery | NO | REVIEW_PENDING |
| 151 | ### Negative space | NO | REVIEW_PENDING |
| 156 | ## DISCOVERY_TO_COMMERCE_ENTRY — governed discovery and promotion to valid target | NO | REVIEW_PENDING |
| 167 | ### Parallel lanes | NO | REVIEW_PENDING |
| 177 | ### Failure / recovery | NO | REVIEW_PENDING |
| 181 | ### Negative space | NO | REVIEW_PENDING |
| 185 | ## SINGLE_STORE_ORDER_CREATION — Client intent to canonical Store Order | NO | REVIEW_PENDING |
| 196 | ### Frontstage and handoffs | NO | REVIEW_PENDING |
| 208 | ### Supporting financial subflow | NO | REVIEW_PENDING |
| 212 | ### Failure / recovery | NO | REVIEW_PENDING |
| 216 | ### Negative space | NO | REVIEW_PENDING |
| 220 | ## BTHWANI_CAPTAIN_DELIVERY — Store readiness to delivered by platform Captain | NO | REVIEW_PENDING |
| 231 | ### Frontstage and handoffs | NO | REVIEW_PENDING |
| 248 | ### Failure / recovery | NO | REVIEW_PENDING |
| 252 | ### Negative space | NO | REVIEW_PENDING |
| 256 | ## PARTNER_CAPTAIN_DELIVERY — Store-affiliated Captain fulfillment | NO | REVIEW_PENDING |
| 267 | ### Supporting membership subflow | NO | REVIEW_PENDING |
| 277 | ### Failure / recovery | NO | REVIEW_PENDING |
| 281 | ### Negative space | NO | REVIEW_PENDING |
| 285 | ## CUSTOMER_PICKUP — Partner readiness to customer pickup | NO | REVIEW_PENDING |
| 296 | ### Frontstage and handoffs | NO | REVIEW_PENDING |
| 306 | ### Failure / recovery | NO | REVIEW_PENDING |
| 310 | ### Negative space | NO | REVIEW_PENDING |
| 314 | ## MULTI_STORE_ORCHESTRATION — parent checkout to independent Store Orders | NO | REVIEW_PENDING |
| 325 | ### Orchestration | NO | REVIEW_PENDING |
| 337 | ### Failure / recovery | NO | REVIEW_PENDING |
| 341 | ### Negative space | NO | REVIEW_PENDING |
| 345 | ## ORDER_COMMUNICATION — order-scoped participant collaboration | NO | REVIEW_PENDING |
| 356 | ### Parallel lane | NO | REVIEW_PENDING |
| 360 | ### Failure / recovery | NO | REVIEW_PENDING |
| 364 | ### Negative space | NO | REVIEW_PENDING |
| 368 | ## FIRST_THREE_ORDER_CONTACT — bounded Operations confirmation | NO | REVIEW_PENDING |
| 378 | ### Decisions and limits | NO | REVIEW_PENDING |
| 386 | ## ORDER_SCOPED_OPERATIONS_EXCEPTION — bounded investigation and ownership | NO | REVIEW_PENDING |
| 405 | ## ORDER_ADJUSTMENT_EXCEPTION_REFUND — legal order change or exception to reconciled result | NO | REVIEW_PENDING |
| 416 | ### Order adjustment branch | NO | REVIEW_PENDING |
| 430 | ### Exception branches | NO | REVIEW_PENDING |
| 434 | ### Failure / recovery | NO | REVIEW_PENDING |
| 438 | ### Negative space | NO | REVIEW_PENDING |
| 442 | ## PARTNER_COMMISSION_REMITTANCE — Partner receivable to reconciled closure | NO | REVIEW_PENDING |
| 453 | ### Failure / recovery | NO | REVIEW_PENDING |
| 457 | ### Negative space | NO | REVIEW_PENDING |
| 461 | ## BENEFICIARY_SETTLEMENT — earned entitlement to reconciled payout | NO | REVIEW_PENDING |
| 472 | ### Frontstage and handoffs | NO | REVIEW_PENDING |
| 487 | ### Failure / recovery | NO | REVIEW_PENDING |
| 491 | ### Negative space | NO | REVIEW_PENDING |
| 495 | ## Supporting subflows and cross-cutting lanes | NO | REVIEW_PENDING |
| 533 | ## Scenario routing without duplicate census | NO | REVIEW_PENDING |
| 537 | ## End-to-end integration proof boundary | NO | REVIEW_PENDING |

## Outstanding acceptance work

1. For each material donor paragraph, reconcile its original meaning against the owner draft and the latest approved human decision. Record source line, disposition (KEEP/REFRAME/SUPERSEDE/APPROVED_RETIRE/UNRESOLVED), target owner and rationale in the existing temporary execution plan, not a second normative policy root.
2. Review historical finance/collection terms, security/privacy, protected SQL/migration and legal obligations independently before changing governance approval.
3. Separately inspect donor code/contracts, six discussion sequences, archived controls and other unheaded requirements; this navigation-only report does not cover them.
4. Do not activate services, SQL, Docker or financial workflows based on this census.

SOURCE_SECTION_CENSUS_PASS owners=14 donor_headings=340 target_headings=138 literal_matches=1 semantic_review=NOT_RUN

## 2026-11-13 — Manual owner-level semantic triage after latest human approval

**Scope and evidence boundary:** The original 340 nested headings above are not automatically 340 independent new Product requirements. The source is an archival reference; latest explicit human approval of FIN/SEC/MIG/LEGAL target policies supersedes inconsistent older recommendations. The 14 target owners and the 26 admitted capabilities were compared at owner/capability level against the pinned donor source headings, domain text and current owner targets. The table below names material meanings that have a located target home, not a claim that all 340 source paragraphs, every old contract or live data have been read/approved. The heading-row REVIEW_PENDING markers remain as evidence of that limit, rather than being replaced mechanically by PASS.

| Donor owner | Source scope | Material semantic placement confirmed in target | Distinct cutover proof still required |
| --- | --- | --- | --- |
| product | 7 source headings | One Product admission census of 26 IDs, owner routing, direct/marketplace relation, bounded recipient and 2026-11-13 human-approved exclusions | Per-subfeature source semantic parity, historical source/decision chronology |
| platform | 6 nested headings | Identity Actor versus DSH Store, high-level role vocabulary versus Store-grant scopes, original external app identifiers versus new internal naming | Verify all historic distributed role/contract consumers during implementation |
| architecture | 13 headings | Exclusive Identity/DSH/WLT writer, trust-boundary order, DSH bounded HR, no duplicate engine, idempotent cross-owner handoff, scoped projections | Proof of live ownership, schema and consumer cutover belongs to implementation |
| identity | 12 nested headings | One Actor, protected original Root Owner, finite scoped Operator permissions, independent Store-grant admission, Passkey recovery and role-session boundaries | Actual Identity subject/credential and cross-account tests NOT_RUN |
| stores | 37 nested headings | One Store-create command, relation publication versus orderability, signed WLT terms, delegated acceptance/revocation, stable public Store URL; relation/business type/primary vertical are now independently named | Real Store data classification migration, accepted agreements and multi-Store ACL tests NOT_RUN |
| catalog | 19 nested headings | Shared Product/Variant and StoreOffer, Store-type taxonomy, identifiers, variable-measure case, import/quick price, customer-visible decision and 30-day popularity | Exact source identifier taxonomy/override and public visibility runtime NOT_RUN |
| commerce | 46 nested headings | Service City 30-km initial source policy, idempotent Store Order, mixed payment owner boundary, immutable adjustments, multi-child isolation, private chat, promotions and discovery | Exact source details/negative concurrency and financial owner readback NOT_RUN |
| fulfillment | 28 nested headings | Three admitted methods, Store Captain consent, three-offer source limit as configurable policy, privacy-safe location, single winning assignment, two-sided handoff and one-time delivery/pickup proof | Real assignment/custody/COD race and native privacy proof NOT_RUN |
| finance | 44 nested headings | WLT single money writer, integer YER ledger conservation, gross exposure versus cash-only reserve, Cash-In gross/net fee, beneficiary status, settlement intake, manual external transfer evidence, historical remittance protection | Contract/provider fees, actual ledger/Balance/SQL and settlement reconciliation NOT_RUN |
| hr | 11 nested headings | Bounded DSH company/Merchant employee facts, Identity-only privileged access, append-only attendance, unknowable absence and audited offboarding | No real HR/Identity consent and ACL integration proof yet |
| experience | 27 nested headings | One semantic brand source/Tamagui/Ant renderer, Arabic RTL/AA, correct scale and registries, scoped Studio/Policies, Merchant Store distinctions and live UI evidence boundary | Live browser/Android/iOS and real usability/accessibility proof NOT_RUN |
| safety | 3 source headings | Fail-closed cross-actor/Store, Root Owner privacy, one WLT ledger, safe protected SQL backup/replay, strict data and incident ownership | Actual private data, restore, grants and financial proof NOT_RUN |
| engineering | 23 nested headings | Stage-aware source/contract/migration admission, limited infrastructure, policy-backed parameters, operator contracts, Go/Expo version preservation and acceptance evidence | Real Go/SQL/product and final release proof belong to future executable stage |
| journeys | 64 nested headings | Sixteen admitted named cross-owner journeys, Owner transitions, unknown/retry, contact/exception/remittance/settlement subflows, no duplicate Product census | Deep cross-owner executable E2E and missing donor paragraphs not independently proved |

**New concrete gap repaired in this pass:** The original Store onboarding distinct `relationModel`, `commercialStoreTypeId` and `primaryVerticalId` meanings were not all explicitly named in the current target Store/UX owner. They are now recorded independently in `governance/stores.md` and `governance/experience.md` with source-preservation tests; this was a real semantic correction, not a mass renaming.

**Remaining semantic acceptance:** An owner/capability-level trace is *partial documentary evidence*, not full section-by-section concordance. Before calling `GOVERNANCE_CUTOVER: READY`, resolve the remaining historical nested-heading clauses and conflicting accepted-agreement details, with explicit rationale for anything intentionally retired. Do not convert `REVIEW_PENDING` into a numerical `PASS` by copying names. This prevents the source census from becoming a second policy authority.

## 2026-11-14 — Source H2-group dispositions (human-approved target, documentary concordance)

**Decision rule.** The exact source-heading census above remains historical evidence, not a second rule book. Each of the **81 donor level-2 sections** and its nested headings is grouped below with a source line, selected disposition and *one authoritative target owner*; this does not imply 81 new Product capabilities. RETAIN preserves valid meaning, REFOUND means retained meaning rebuilt around one new legal owner/engine, MERGE combines duplicates within an existing owner, REPLACE follows an explicit newer human target rule, HISTORICAL preserves binding existing records while retiring the source workflow. A group decision is not literal line-by-line proof of every nested paragraph; particularly material exception facts still require authoritative owner contract or protected real-record verification.

| Donor owner and H2 line | Source H2 section | Decision | Canonical destination / critical resolution |
| --- | --- | --- | --- |
| product 8 | Purpose | RETAIN | product.md: one Product admission owner, not source implementation inventory |
| product 14 | Current approved Product target | REFOUND | product.md: one Store, relation MARKETPLACE/DIRECT, no separate Direct checkout engine |
| product 47 | Minimum complete and evolvable model | RETAIN | product.md: complete admissible meaning without speculative prebuilding |
| product 57 | Admitted capabilities | RETAIN | product.md: exactly 26 stable ID assignments |
| product 88 | Product-wide invariants | REFOUND | product.md: immutable Order snapshot, distinct relation/fee/collector/fulfillment, money owner |
| product 119 | Explicit current non-goals | RETAIN | product.md: deliberate non-admissions with exception-only lawful historic liabilities |
| product 127 | Capability admission law | RETAIN | product.md: latest human admission, owner/readback/failure gate |
| platform 8 | Platform definition | RETAIN | platform.md: actors/resources/surfaces are separate |
| platform 14 | Human Actor model | REFOUND | platform.md: canonical Customer/Merchant/Captain/Operator and bounded delivery recipient |
| platform 53 | Surface model | REFOUND | platform.md: current Customer/Merchant/Captain/Operator hosts and original external app IDs |
| platform 61 | Canonical terms | REPLACE | platform.md: Merchant vs Store; old partner role codes remain compatible but not new actor |
| architecture 8 | Bounded owners | RETAIN | architecture.md: Identity DSH WLT authoritative writers and DSH bounded employee role |
| architecture 53 | Architecture selection | RETAIN | architecture.md: smallest accurate solution, no mandatory layers |
| architecture 57 | Mandatory single-owner and single-engine law | RETAIN | architecture.md: one Store, Catalog, Order, pricing, ledger engine each |
| architecture 69 | Adapter boundary | RETAIN | architecture.md: provider transport is never owner truth |
| architecture 77 | Surface boundary | RETAIN | architecture.md: UI is composition only |
| architecture 83 | Canonical writer/readback law | RETAIN | architecture.md: owner mutation and committed readback |
| architecture 98 | Canonical identity evolution law | RETAIN | architecture.md: historic IDs cannot silently change business meaning |
| architecture 104 | Cross-boundary contracts | RETAIN | architecture.md: durable idempotent handoff, partial-outcome recovery |
| architecture 122 | Trust-boundary validation | RETAIN | architecture.md: parse, validate, normalize, authorize at canonical owner |
| architecture 139 | Data ownership | RETAIN | architecture.md: separate persisted truth and bounded references |
| architecture 145 | Runtime/configuration | RETAIN | architecture.md: no shadow runtime and real readiness evidence |
| architecture 156 | Responsibility-shaped implementation boundaries | RETAIN | architecture.md: cohesion without duplicate engine |
| architecture 162 | Repository boundary | RETAIN | architecture.md: path placement remains REPOSITORY-STRUCTURE responsibility |
| identity 8 | IDENTITY_ACTIVATION_SESSIONS | REFOUND | identity.md: one permanent Actor, verifiable role/session, original protected Root Owner, Passkey and finite permissions |
| stores 8 | PARTNER_ONBOARDING_STORE_PUBLICATION | REFOUND | stores.md: directly verified Merchant, one Store-create command, minimum City/type/vertical, separate approval/publication |
| stores 77 | STORE_RELATION_MODEL | REPLACE | stores.md: MARKETPLACE/DIRECT replaces old relation-code presentation without erasing historical meaning |
| stores 139 | STORE_OPERATIONAL_AVAILABILITY | RETAIN | stores.md: publication distinct from actual opening, schedule, pause and per-mode eligibility |
| stores 193 | STORE_SCOPED_ACCESS_DELEGATION | REFOUND | stores.md: one current Identity Actor with individually accepted DSH Store grants, never a fifth role |
| catalog 8 | CENTRAL_CATALOG | RETAIN | catalog.md: single DSH Product/Variant/Offer registry; ServiceCity, vertical, Store type and category separate |
| catalog 270 | CUSTOMER_STORE_CATALOG | RETAIN | catalog.md: same customer-safe eligible Offer read, distinct completed-Order popularity and favorites |
| commerce 8 | SERVICEABILITY_ADDRESSES | RETAIN | commerce.md: owned addresses and same active city with donor 30-km inclusive initial policy, DSH validates |
| commerce 76 | CART_CHECKOUT | RETAIN | commerce.md: current quote and immutable Store-scoped confirmation; financial allocation WLT |
| commerce 116 | MULTI_STORE_CHECKOUT | RETAIN | commerce.md: parent composition but independent child Orders/payment/cancellations |
| commerce 143 | ORDER_LIFECYCLE | RETAIN | commerce.md: one Store Order, attributable immutable adjustment, cancellation and recovery |
| commerce 202 | ORDER_CONVERSATION | RETAIN | commerce.md: private per-recipient Order messages/media, no generic chat writer |
| commerce 235 | COMMERCE_PROMOTIONS | RETAIN | commerce.md: DSH eligibility, WLT funding, no duplicated price engine |
| commerce 292 | DISCOVERY_CONTENT | RETAIN | commerce.md: DSH approved versioned content targets and bounded media |
| fulfillment 8 | STORE_CAPTAIN_MEMBERSHIP | RETAIN | fulfillment.md: consent-based one Store/Captain relation, no auto Captain role |
| fulfillment 56 | CAPTAIN_DISPATCH | REFOUND | fulfillment.md: single winner, actual WLT COD eligibility, operator-controlled timeouts/offer limits |
| fulfillment 105 | STORE_CAPTAIN_HANDOFF | RETAIN | fulfillment.md: two-sided exactly-once custody |
| fulfillment 133 | FINAL_MILE_DELIVERY | RETAIN | fulfillment.md: authorized assigned Captain proof, privacy-safe tracking and financial reconciliation |
| fulfillment 166 | CUSTOMER_PICKUP | RETAIN | fulfillment.md: Store readiness and one-time customer release, no fictitious Captain custody |
| finance 10 | Financial Integrity Policy | REFOUND | finance.md: integer YER and WLT-only balance/ledger; original COD liabilities preserved |
| finance 171 | STORE_COMMERCIAL_AGREEMENT | REFOUND | finance.md: either relation may have COMMISSION or SUBSCRIPTION; accepted effective terms |
| finance 230 | ORDER_PAYMENT_COLLECTION | REFOUND | finance.md: COD/Wallet/Mixed, distinct source/collector/beneficiary, idempotent cash-only reserve |
| finance 281 | CUSTOMER_BALANCE_FUNDING | RETAIN | finance.md: external funding rail proof, gross credit, net provider settlement and expense |
| finance 307 | CAPTAIN_BALANCE_FUNDING | RETAIN | finance.md: one platform-Captain wallet, no phantom Store Captain account |
| finance 336 | PARTNER_CAPTAIN_EARNINGS_SETTLEMENT | RETAIN | finance.md: correct recipient, one intake, no duplicate payout, actual statement reconciliation |
| finance 394 | CUSTOMER_BALANCE_MANUAL_WITHDRAWAL | RETAIN | finance.md: bounded Operations intake, independently authorized Finance release and reconciliation, no self-service |
| hr 8 | EMPLOYEE_HR | REFOUND | hr.md: one bounded DSH employee engine for company and Merchant staff with Identity-only access granting and no automatic payroll |
| experience 8 | Experience and Interaction Policy | REFOUND | experience.md: one Expo/Tamagui client renderer, Operator Ant, Arabic RTL, privacy, minimal fields and real recovery |
| experience 202 | Design and Visual Identity Policy | REFOUND | experience.md: one brand root, semantic themes, bounded Studio, WCAG and renderer-specific consumers |
| safety 8 | Security Policy | RETAIN | safety.md: least privilege, default deny, session and resource isolation |
| safety 22 | Data Policy | RETAIN | safety.md: protected identities, money, media, contracts, retention and owner-controlled backup |
| safety 42 | Reliability Policy | RETAIN | safety.md: verified idempotent recovery, no fabricated ready/success |
| engineering 8 | Change and Delivery Policy | REFOUND | engineering.md: latest stage-aware authorized work, source/consumer census and safe cutover |
| engineering 72 | Quality Policy | RETAIN | engineering.md: negative and owner-backed tests, evidence classes separate |
| engineering 87 | Performance, Capacity and Scalability | RETAIN | engineering.md: measured load first; conditional indexes, cache, search, queue and replica |
| engineering 147 | Providers and Integrations Policy | RETAIN | engineering.md: local synthetic rails separate from officially accepted real providers |
| engineering 170 | Knowledge Policy | RETAIN | engineering.md: durable canonical policy owner and dated external references |
| journeys 8 | End-to-end scenario boundary | RETAIN | journeys.md: cross-owner proof lens, never new capability catalog |
| journeys 28 | MANAGED_PARTICIPANT_ADMISSION | RETAIN | journeys.md: one canonical verified role and lawful session |
| journeys 60 | PARTNER_TO_VISIBLE_STORE | REFOUND | journeys.md: direct Merchant, unpublished Store, then WLT agreement and DSH publication |
| journeys 96 | STORE_ORDERABILITY | RETAIN | journeys.md: publication and actual orderability separate |
| journeys 125 | CATALOG_TO_CUSTOMER_OFFER | RETAIN | journeys.md: current canonical StoreOffer and Store visibility |
| journeys 156 | DISCOVERY_TO_COMMERCE_ENTRY | RETAIN | journeys.md: authorized promotion/content destination |
| journeys 185 | SINGLE_STORE_ORDER_CREATION | RETAIN | journeys.md: one DSH Order and WLT allocation |
| journeys 220 | BTHWANI_CAPTAIN_DELIVERY | RETAIN | journeys.md: assignment, WLT COD, custody and completion |
| journeys 256 | PARTNER_CAPTAIN_DELIVERY | RETAIN | journeys.md: separately accepted affiliation and fulfillment, same DSH engine |
| journeys 285 | CUSTOMER_PICKUP | RETAIN | journeys.md: distinct customer release proof |
| journeys 314 | MULTI_STORE_ORCHESTRATION | RETAIN | journeys.md: independent child Orders and financial effects |
| journeys 345 | ORDER_COMMUNICATION | RETAIN | journeys.md: per-recipient private media/read scopes |
| journeys 368 | FIRST_THREE_ORDER_CONTACT | REFOUND | journeys.md: 2026-11-14 new mapping to ORDER_LIFECYCLE, unlike unmapped donor |
| journeys 386 | ORDER_SCOPED_OPERATIONS_EXCEPTION | REFOUND | journeys.md: 2026-11-14 new mapping to ORDER_LIFECYCLE and ORDER_PAYMENT_COLLECTION |
| journeys 405 | ORDER_ADJUSTMENT_EXCEPTION_REFUND | RETAIN | journeys.md: adjustment/resolution through DSH and WLT |
| journeys 442 | PARTNER_COMMISSION_REMITTANCE | RETAIN | journeys.md: Store-collected commission receivable closure belongs to WLT |
| journeys 461 | BENEFICIARY_SETTLEMENT | RETAIN | journeys.md: beneficiary verification and reconciled transfer |
| journeys 495 | Supporting subflows and cross-cutting lanes | MERGE | journeys.md: bounded concurrent subflows under existing Order/Finance ownership |
| journeys 533 | Scenario routing without duplicate census | RETAIN | journeys.md: no 27th Product capability |
| journeys 537 | End-to-end integration proof boundary | RETAIN | journeys.md: implemented E2E proof separately required |

**Compatibility and history:** The old source file, all deeper heading rows with exact donor blob/line references and legally binding state remain untouched. Old field-acquisition, alternate Direct engines and redundant presentation/writers are not revived; they are explicitly excluded by current `product.md` and `architecture.md`. This group crosswalk supports current source-to-target inspection; it does not assert that original subscriptions, official payment terms, applied SQL versions, Root Owner records or 340 separate paragraph-level runtime invariants have been proven.
