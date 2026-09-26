# Etlobni / اطلبي

EVIDENCE_CLASS: CACHED_EXTERNAL_BLACK_BOX_EVIDENCE
PRODUCT_AUTHORITY: NONE
CANONICAL_FILE_FOR_THIS_APP: YES
PARALLEL_REPORTS_ALLOWED: NO

## Identity / technical state
- Display name: `اطلبي`
- Package: `com.etlobni`
- Launch Activity: `com.etlobni/.MainActivity`
- Device: `SM-S9280`
- Priority: `MEDIUM_YEMEN_FIT`
- Role: Medium-priority Yemen-market reference.
- App version: `1.2.0` (installed package readback; versionCode `10236`)
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
- Installed on `SM-S9280`; package readback reports version `1.2.0` / versionCode `10236`.
- Home presents a purple branded shell, a location selector, help/how-to entry, `انفعني` service promotion, a rewards sign-up prompt and image-led categories for supermarket, restaurants, sweets/cafes, shops, produce, meat/chicken and pharmacy.
- Bottom navigation exposes Account, Orders, Cart, Search and Home.
- Restaurant listing exposes category, nearest, new, favorites and all filters, promotional carousel and a list/grid choice. Rows show rating, address, distance, estimated time and a percentage badge.
- Restaurant detail exposes rating, distance and time, order history/favorites/hours links, menu categories, minimum order and cashback copy, item search, and a product list/grid toggle.
- Product detail shows product options/title, optional preparation notes, total, quantity and Add to Cart action. The dialog opened with a default quantity; Add to Cart was not pressed.
- Bottom-tab Search has separate Restaurants and Item tabs. Searching `chicken` displayed restaurant matches with rating, distance, time and offer metadata; Item mode displayed chicken products with prices.
- A launch-time promotional modal invited the user to play for prizes; it was closed without opening the promotion.
- The home `انفعني` banner opened a form for delivering goods between locations. The visible form includes origin/destination location controls, optional sender/recipient information, immediate/scheduled timing, a delivery-type selector (default `توصيل أغراض`), a details field, optional image attachment and `Save and Continue`. No location/data was entered and the CTA was not submitted.
- The Cart tab showed the explicit empty-cart illustration/message. The Account tab exposed profile/address/order-related sections; personal contents were not inspected. No order/cart mutation was made.

## Current observations
- The home and discovery screens use Arabic RTL layout, white surfaces, bright purple branding, large promotional/category imagery and a persistent five-destination bottom bar.
- Restaurant listing combines a large offer carousel with category/sort tabs and cards containing location, ETA, rating and offer/cashback percentage. Restaurant storefront also supports a grid/list presentation toggle.
- Restaurant menus show category tabs and minimum-order/cashback information near product search. Product detail includes item notes, quantity and total before the add action.
- Search returns restaurant and item result sets in distinct tabs while retaining the entered query during the tested `chicken` search.
- On relaunch, a full-screen prize promotion appeared with a `Play now` action; it was dismissed without joining or submitting anything. The Home surface also showed referral/reward and free-delivery promotions.
- The `انفعني` route describes point-to-point goods delivery and presents address, sender/recipient, timing, delivery type, details, optional image and continuation controls in one form. Only the blank form was observed; no request was created.
- Cart displayed an empty state. Account entry revealed profile/address/order destinations, but no account-specific content was opened.

## Interaction / experiment evidence
- Tabs/routes entered: Home, restaurant list, restaurant storefront, product detail, bottom-tab Search, restaurant results and item results, `انفعني` form, Cart tab and Account tab.
- Buttons/controls exercised: restaurant category card, store row, item card, search field/submit, Restaurants/Item tabs, `انفعني` banner, promo modal close, Cart and Account tabs, back/close navigation.
- Paths/input variations tried: searched `chicken`; changed result type from restaurants to products; opened one product detail without pressing Add to Cart.
- Additional paths: dismissed the launch-time prize promotion; opened the blank `انفعني` request form and returned without selecting addresses, entering details, attaching media or continuing; viewed empty Cart and Account destinations without opening private profile/order data.
- States reached: populated home and restaurant list, restaurant menu, product detail with notes/quantity/total, restaurant and item search results, promo modal, blank service form, empty cart and Account tab.
- Results observed: search result type changed to products matching the chicken query; the Cart tab was empty. No request, order or cart mutation was made.
- Unreached/not-tested items and reason: branch/address selection, service form submission and scheduling, category-specific error state, item addition, checkout/payment, order history/detail/tracking, profile/address contents, notifications, favorites mutation, offline/conflict/retry, refresh/relaunch and accessibility were not exercised.

## Logic / behavioral inferences
- Search visibly partitions restaurant results from item results and preserves the tested query across those two tabs.
- Store list and storefront both expose separate ways to browse categories; storefront also shows its own minimum order and cashback context. Internal eligibility/calculation rules were not tested.
- Product notes and quantity are gathered in a detail step before the add action; no cart transition was observed.
- The `انفعني` path visibly collects route details and offers immediate or scheduled execution before a continuation step; validation, pricing and fulfillment rules were not tested.
- Cart can be opened as a bottom-tab destination and showed an empty state; account exposes further profile/address/order surfaces, whose contents were not examined.

## Visual findings
- Arabic RTL hierarchy is clear across home categories, restaurant discovery and product detail. Purple is the main action/brand color; orange badges call out monetary/promotional information.
- Images dominate home categories and promotional banners; the opened product detail surfaced a generic brand placeholder image rather than a unique product image.
- Store result cards use a dense mix of address, rating, distance, ETA and percentage offer metadata; storefront product browsing supports grid and list density.

## Technical / performance observations
- Package/version and foreground activity were read from the live Android device. No app internals were inspected.
- No controlled latency, jank, offline, lifecycle or device-accessibility measurement was performed.

## Useful patterns
- Unified category-led home plus search destination allow entry by service category or text.
- Store cards surface distance, ETA, rating and a monetary/offer badge before opening the store.
- Search separates store and item result types; menu detail exposes optional item notes and a computed total before adding.
- Storefront grid/list toggle gives users a choice between visual browsing and denser scanning.

## Weaknesses / rejected patterns
- No confirmed behavioral defect was established in this partial pass. Account, cart, order, error/recovery and accessibility states remain unexamined.

## BThwani relevance
- Challenge only the current material BThwani decision; never use this file as Product or architecture authority.

## Unreviewed / stale areas
- Location/address selection and service submission/scheduling, help content, paid/promotion destinations, item addition, checkout/payment, order history/detail/tracking, profile/address contents, notifications, favorites, empty/error/retry beyond the empty Cart state, offline/conflict/recovery, loading, refresh/relaunch persistence, accessibility and measured performance remain unreviewed.

## Local screenshots
- Local captures from the reviewed Android session; files are app-foldered under `local-photos/etlobni/` and ignored by Git, so they remain on this machine.
- [Home](local-photos/etlobni/etlobni-home.png)
- [Restaurant list](local-photos/etlobni/etlobni-restaurant-list.png)
- [Product detail](local-photos/etlobni/etlobni-product-detail.png)
- [Item search results](local-photos/etlobni/etlobni-item-search-results.png)
- [Launch-time prize promotion](local-photos/etlobni/etlobni-home-followup-20260926.png)
- [Home after dismissing promotion](local-photos/etlobni/etlobni-home-promo-dismissed-followup-20260926.png)
- [`انفعني` blank delivery form](local-photos/etlobni/etlobni-infe3ni-entry-followup-20260926.png)
- [Empty Cart tab](local-photos/etlobni/etlobni-cart-tab-followup-20260926.png)

## Review history
### 2026-09-26 — Evidence file initialized / protocol hardened
- Recorded only known technical identity.
- Added mandatory interactive, experimental, logical, behavioral, visual, technical, performance and recovery review coverage.
- No unobserved finding was fabricated.
### 2026-09-26 — Live Android partial review
- Inspected the installed `1.2.0` app on `SM-S9280`; sampled home, restaurant discovery/menu, product detail and restaurant/item search.
- Did not add items to the cart, open account-specific cart/order state, or submit an order.
### 2026-09-26 — Moderate home/service/account delta
- Reopened the installed app and reviewed its launch promotion, `انفعني` blank request form, empty Cart and Account entry at a summary level.
- Closed the promotion and left the form without selecting locations, entering data, attaching an image or continuing. The Account tab's personal/order details and Orders tab were not examined.
- Added local-only links to the new screenshots; no cart/order/account mutation was made.
