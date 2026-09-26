# HungerStation

EVIDENCE_CLASS: CACHED_EXTERNAL_BLACK_BOX_EVIDENCE
PRODUCT_AUTHORITY: NONE
CANONICAL_FILE_FOR_THIS_APP: YES
PARALLEL_REPORTS_ALLOWED: NO

## Identity / technical state
- Display name: `HungerStation`
- Package: `com.hungerstation.android.web`
- Launch Activity: `com.hungerstation.android.web/.hungeractivities.MainActivity` (resolved and launched on device)
- Device: `SM-S9280`
- Priority: `REGIONAL_HIGH_MATURITY_PRODUCT_EXEMPLAR`
- Role: Regional high-maturity product/UX benchmark; not a Yemen-fit authority.
- App version: `8.0.299` (installed package readback; versionCode `1527`)
- Review confidence: `PARTIAL_INTERACTIVE_BLACK_BOX_REVIEW`
- Freshness: `FRESH UNTIL MATERIAL CHANGE IS SUSPECTED OR THE CURRENT DECISION REQUIRES REVALIDATION`

## Evidence cache rules
Read this file before live inspection. Reuse still-current evidence; inspect relevant, stale or missing areas only; replace stale current facts; append one concise Review history entry. Never create a parallel report.

`COMPETITOR OBSERVATION != BTHWANI REQUIREMENT`.

## Mandatory black-box review method
A review is not complete from screenshots or visual browsing alone. For each material journey/screen/workspace, use normal authorized interaction on the real app/device and cover the applicable dimensions:

```text
PRODUCT / UX
BEHAVIORAL REVERSE ANALYSIS
LOGIC / VISIBLE RULES
INTERACTION / CONTROL COVERAGE
EXPERIMENTAL PATH COVERAGE
VISUAL
TECHNICAL / PLATFORM OBSERVATION
PERFORMANCE / RESPONSIVENESS
FAILURE / RECOVERY
OPERATIONAL FLOW
```

For every relevant route/screen:

```text
ENTER RELEVANT TAB / ROUTE
→ TAP RELEVANT BUTTONS / CTAs / ICONS / ROWS / CARDS
→ EXERCISE MENUS / SHEETS / DIALOGS / FILTERS / SORT / SEARCH / SELECTORS / TOGGLES
→ TEST BACK / CLOSE / CANCEL / CONFIRM / RETRY / REFRESH / SCROLL / PAGINATION / CAROUSEL WHEN PRESENT
→ TRY SAFE ALTERNATIVE INPUTS / PATHS
→ OBSERVE STATE BEFORE / AFTER
→ RECORD RESULT / FAILURE / RECOVERY / PERFORMANCE
```

Every relevant control is either exercised or recorded as `NOT_TESTED_WITH_REASON`. Do not cross an irreversible, paid, destructive or externally consequential boundary without explicit authority.

Do not decompile binaries, bypass protections, intercept secrets, or present hidden implementation as fact. Classify conclusions as `OBSERVED`, `STRONGLY_INFERRED`, `HYPOTHESIS`, or `NOT_TESTED`.

## Coverage matrix
| Dimension | Status |
|---|---|
| Shell / IA / Navigation / Home / Discovery | PARTIAL |
| Stores / Categories / Products / Media | PARTIAL |
| Search / Filters / Sort | PARTIAL |
| Cart / Checkout | PARTIAL |
| Orders / Tracking | NOT_REVIEWED |
| Account | PARTIAL |
| Promotions / Banners | PARTIAL |
| Product / UX | PARTIAL |
| Behavior / Logic / Visible State Machine | PARTIAL |
| Interaction / Buttons / Tabs / Controls | PARTIAL |
| Experimental Paths / Input Variations | PARTIAL |
| Loading / Empty / No Results / Error / Retry | NOT_REVIEWED |
| Offline / Conflict / Recovery | NOT_REVIEWED |
| RTL / Arabic / Accessibility | PARTIAL |
| Visual Hierarchy / Density / Media | PARTIAL |
| Technical / Platform Behavior | PARTIAL |
| Performance / Responsiveness / Jank / Latency | NOT_REVIEWED |
| State Persistence / Refresh / Relaunch | NOT_REVIEWED |

Allowed: `NOT_REVIEWED`, `CURRENT`, `STALE`, `PARTIAL`, `N/A`.

Do not mark an area `CURRENT` if only its visual layer was observed while material interaction, logic or state behavior remains untested.

## Current verified state
- Installed on `SM-S9280`; package readback reports version `8.0.299` / versionCode `1527`. The live launcher activity resolved to `com.hungerstation.android.web/.hungeractivities.MainActivity`.
- Launch displayed a Saudi delivery-location mismatch dialog and a year-long delivery/coupon sign-up promotion. Both were dismissed without confirming an order, changing location or registering.
- Search offers restaurants, groceries, pharmacies, flowers and gifts. Searching `burger` in Restaurants returned promoted stores and visible filters for newest, high rating, fastest delivery, featured, membership, offers, SAR price bands and recommended categories.
- Search result cards expose categories, delivery fee, distance, estimated time, price band, rating/review count, promotion and membership badges; some cards include product carousels.
- Store detail shows cover imagery, rating/count, delivery fee, ETA, minimum order, membership/promotion badges, category navigation and a basket-completion threshold.
- An offer product detail required choosing one of several bundle combinations and showed a discounted price before the add action. No option was selected and nothing was added.
- Search and store/product exploration used the app's prefilled Saudi delivery context; no address was recorded in this cache. No order, payment, account action or location change was made.

## Current observations
- The app uses a white/red/brown palette and full-bleed food photography. Arabic RTL layout is paired with familiar global brands and bilingual product/category text.
- Restaurant search results are dense but scannable: promotional and H+ badges, category text, free-delivery/voucher text, product previews, fee, distance, delivery-time range, price band and rating/review count.
- The filter sheet provides checkbox filters for new, 4.5+ rated, delivery within 30 minutes, Rewards, Premium, H+ and offers; it also exposes SAR price tiers and recommended categories.
- Store detail foregrounds operational terms (rating, minimum spend, delivery fee and ETA), then promotion and category/menu navigation. The bottom basket area communicates the remaining minimum-order amount.
- The opened promotional bundle has a required one-choice group, explicit alternatives, quantity/total and a discounted price before adding.

## Interaction / experiment evidence
- Tabs/routes entered: startup dialogs, search suggestions, restaurant search results, filter sheet, store detail, offer product detail.
- Buttons/controls exercised: dismiss sign-up offer, dismiss location mismatch with Back, search entry/submit, filter open/close, store card, product detail open/close.
- Paths/input variations tried: searched `burger`; opened filter choices without selecting/applying; opened a bundle product without selecting an option or adding it.
- States reached: location-mismatch prompt, guest discovery/search, filter sheet, populated store and a required-option offer item.
- Results observed: dialogs were dismissed without changing persisted location or account/order state; product detail remained pre-add.
- Unreached/not-tested items and reason: home content beneath location banner, category tabs beyond Restaurants, filter apply/clear, product item search, cart with items, checkout/payment, order lifecycle, account, favorites, cancellation/recovery, empty/error/offline states, refresh/relaunch and accessibility were not exercised.

## Logic / behavioral inferences
- The store and item presentation shows eligibility inputs (minimum order, fees, ETA, option requirement and promotion terms) before add/checkout; no calculation or final checkout behavior was tested.
- The initial location prompt distinguishes the saved delivery address from device location and offers change/confirm actions. Neither action was exercised.
- A required bundle group appears to enforce one choice; validation behavior when no choice is selected was not tested.

## Visual findings
- Strong food imagery, compact metadata chips and differentiated accent colors make promotions, membership, ratings and delivery terms easy to scan.
- Search/filter screens are RTL and keep query context while switching among service verticals; store detail uses a large photographic hero and a persistent basket threshold area.
- The launch experience stacked a location-mismatch prompt with an account-registration offer; no usability conclusion beyond the observed sequence is claimed.

## Technical / performance observations
- Launcher resolution, package version and foreground activities were observed on the live Android device. No app internals were inspected.
- No controlled latency, jank, offline, lifecycle or device-accessibility measurement was performed.

## Useful patterns
- Cross-vertical search navigation extends beyond restaurants to grocery, pharmacy, flowers and gifts.
- Store cards expose rating, review count, fee, distance, ETA, price level and promotions before entry; minimum spend remains visible in the store and basket context.
- Faceted filters include operational and merchandising criteria, with price band and category choices in one sheet.
- Product bundles reveal mandatory choice groups and discounted pricing before add; this is useful UX evidence, not a BThwani product requirement.

## Weaknesses / rejected patterns
- No confirmed product defect was established in this partial pass. The stored location did not match device location; we dismissed the prompt and did not test local-market serviceability.

## BThwani relevance
- Challenge only the current material BThwani decision; never use this file as Product or architecture authority.
- Strong additional challenge source for UX maturity, discovery, storefront, catalog presentation, search/filter, cart/checkout, order experience, design quality and performance patterns; not Yemen-market-fit authority.

## Unreviewed / stale areas
- Orders/tracking, account contents, favorites, categories other than Restaurants, item search, filter selection/application/clear, cart with items, checkout/payment, required-option validation, cancellation/refund/recovery, offline/conflict/retry, empty/error/loading states, refresh/relaunch persistence, accessibility and measured performance remain unreviewed.
- Search and store browsing reflect the device's prefilled Saudi delivery context and cannot be used as Yemen market-fit evidence.

## Local screenshots
- Local captures from the reviewed Android session; files are app-foldered under `local-photos/hungerstation/` and ignored by Git, so they remain on this machine.
- [Search results](local-photos/hungerstation/hungerstation-search-results.png)
- [Search filters](local-photos/hungerstation/hungerstation-search-filters.png)
- [Storefront](local-photos/hungerstation/hungerstation-storefront.png)
- [Bundle options](local-photos/hungerstation/hungerstation-bundle-options.png)

## Review history
### 2026-09-26 — Evidence file initialized / protocol hardened
- Recorded package identity only; launch activity remains unverified.
- Added mandatory interactive, experimental, logical, behavioral, visual, technical, performance and recovery review coverage.
- No unobserved finding was fabricated.
### 2026-09-26 — Live Android partial review
- Resolved and launched `com.hungerstation.android.web/.hungeractivities.MainActivity`, version `8.0.299`; sampled search, filters, store detail and a required-choice offer product.
- Dismissed the location mismatch and registration prompts without changing location or account state; did not add an item or place an order.
