# NASS / ناس

EVIDENCE_CLASS: CACHED_EXTERNAL_BLACK_BOX_EVIDENCE
PRODUCT_AUTHORITY: NONE
CANONICAL_FILE_FOR_THIS_APP: YES
PARALLEL_REPORTS_ALLOWED: NO

## Identity / technical state
- Display name: `ناس (NASS)`
- Package: `com.teknokeys.nass`
- Launch Activity: `com.teknokeys.nass/.MainActivity`
- Device: `SM-S9280`
- Priority: `SUPPORTING_YEMEN_FIT`
- Role: Supporting Yemen-market reference.
- App version: `1.0.52` (installed package readback; versionCode `76`)
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
| Cart / Checkout | NOT_REVIEWED |
| Orders / Tracking | PARTIAL |
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
- Installed on `SM-S9280`; package readback reports version `1.0.52` / versionCode `76`.
- Guest home exposes a login action, search, a “Trending today” restaurant grid and bottom navigation for Home, Grocery, Orders, Rewards and Account.
- Search separates Stores and Items. Searching `chicken` produced store results; Items mode produced mixed Arabic/English food items with prices and imagery/placeholders.
- A restaurant listing showed cuisine filters, closest/free-delivery/highest-rated/favorites filters and store cards with rating, cuisine, open status and estimated time. Store detail showed a large cover, rating, hours, open state, prep time, cuisine categories and priced dishes with add controls.
- Grocery exposes categories and subcategories; Produce showed Fruits, Vegetables, Leafy greens and Dates plus a two-column item grid with package weights and prices.
- Orders and Rewards displayed explicit login gates. Login was not started, and Account was not opened.
- Item detail showed product name, unit, quantity, price and Add to Cart; no item was added.

## Current observations
- Home prioritizes popular restaurants in an image tile grid. Grocery is a separate shopping destination with category tiles and produce subcategories.
- Search results use separate Store/Item tabs. Item tiles show the restaurant label, product name, image and price; some titles were ellipsized, and at least one visible result used a placeholder/blank image treatment.
- Restaurant listing exposes filters for cuisine, nearest, free delivery, high rating and favorites. The opened store menu combines a hero image and operational summary with horizontal dish categories and image/price rows.
- Unauthenticated access permits discovery; Orders and Rewards require sign-in and show an explicit prompt.

## Interaction / experiment evidence
- Tabs/routes entered: Home, Search/Stores, Search/Items, Grocery, Produce subcategory, restaurant list, restaurant menu, product detail, Orders and Rewards.
- Buttons/controls exercised: search and submit, Stores/Items switch, Grocery tab/category, restaurant tile, store menu, product detail open/close, Orders and Rewards tabs.
- Paths/input variations tried: `chicken` search across store and item modes; switched Grocery to Produce; opened an item without adding it.
- States reached: guest discovery, store and product search results, grocery subcategories/products, menu, item detail, explicit login-gated Orders and Rewards.
- Results observed: search changed result type; login-gated sections showed sign-in prompt; no cart/order/account mutation occurred.
- Unreached/not-tested items and reason: Account, login, checkout/payment, cart contents, order detail/tracking, reward redemption, favorites changes, promotions destination, errors/retry, offline/conflict/recovery, refresh/relaunch and accessibility were not exercised.

## Logic / behavioral inferences
- Store and Item discovery are separate result types. Grocery has its own category hierarchy, distinct from restaurant cuisine categories.
- Orders and Rewards appear authenticated-only from the explicit gate; no authenticated behavior was tested.

## Visual findings
- White/gray surfaces with orange-red branding, strong Arabic RTL labels and image-led restaurant/product grids.
- Some item names truncate in the two-column search grid; at least one card showed a blank/placeholder image while another result had a loaded photograph. This is a visible presentation finding; its cause is unknown.
- Storefront gives substantial space to the cover image and operational summary before menu cards.

## Technical / performance observations
- Package/version and foreground activity were read from the live Android device. No app internals were inspected.
- No controlled latency, jank, offline, lifecycle or device-accessibility measurement was performed.

## Useful patterns
- Popular restaurant tiles provide a direct discovery entry without requiring search.
- Separate grocery and restaurant discovery paths match their different category structures.
- Store cards expose cuisine, open state and preparation estimate; store menu combines schedule, rating, preparation time, category and dish price.
- Login gates explain why Orders and Rewards are unavailable to guests.

## Weaknesses / rejected patterns
- Item search titles visibly truncate and one item image was not present in the captured results; this may obscure distinctions between similar products. Root cause was not established.

## BThwani relevance
- Challenge only the current material BThwani decision; never use this file as Product or architecture authority.

## Unreviewed / stale areas
- Account/login, cart with items, checkout/payment, order history and tracking, reward balance/redemption, notifications, favorites, promotion destinations, other grocery categories, validation/no-results/error/retry, offline/conflict/recovery, loading, refresh/relaunch persistence, accessibility and measured performance remain unreviewed.

## Local screenshots
- Local captures from the reviewed Android session; files are app-foldered under `local-photos/nass/` and ignored by Git, so they remain on this machine.
- [Home](local-photos/nass/nass-home.png)
- [Grocery](local-photos/nass/nass-grocery.png)
- [Restaurant menu](local-photos/nass/nass-restaurant-menu.png)
- [Item search results](local-photos/nass/nass-item-search-results.png)

## Review history
### 2026-09-26 — Evidence file initialized / protocol hardened
- Recorded only known technical identity.
- Added mandatory interactive, experimental, logical, behavioral, visual, technical, performance and recovery review coverage.
- No unobserved finding was fabricated.
### 2026-09-26 — Live Android partial review
- Inspected the installed `1.0.52` app on `SM-S9280`; sampled guest home, store/item search, grocery/produce, restaurant listing/menu and login gates.
- Did not log in, add products, open account-specific data or submit an order.
