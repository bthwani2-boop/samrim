# Tawseel One / توصيل ون

EVIDENCE_CLASS: CACHED_EXTERNAL_BLACK_BOX_EVIDENCE
PRODUCT_AUTHORITY: NONE
CANONICAL_FILE_FOR_THIS_APP: YES
PARALLEL_REPORTS_ALLOWED: NO

## Identity / technical state
- Display name: `توصيل ون`
- Package: `com.smartapps.tawseel`
- Launch activity: `com.smartapps.tawseel/.MainActivity`
- Device used: Samsung `SM-S9280`
- Installed version readback: `2.0.63` (versionCode `263`)
- Review confidence: `PARTIAL_INTERACTIVE_BLACK_BOX_REVIEW`
- Freshness: `FRESH UNTIL MATERIAL CHANGE IS SUSPECTED OR THE CURRENT DECISION REQUIRES REVALIDATION`
- Method boundary: ordinary visible interaction on the installed app only; no binary decompilation, code extraction, network interception, or hidden implementation claims.

## Evidence cache rules
Read this file before live inspection. Reuse still-current evidence; inspect only relevant stale or missing areas; replace stale current facts; append one concise Review history entry. Never create a parallel report.

`COMPETITOR OBSERVATION != BTHWANI REQUIREMENT`.

Every material control below is either described as exercised or recorded as `NOT_TESTED_WITH_REASON`. Paid, destructive, personal-data-changing and externally consequential paths were not crossed.

## Coverage matrix
| Dimension | Status | Evidence boundary |
|---|---|---|
| Shell / IA / Navigation / Home / Discovery | PARTIAL | Main tabs, home, category grid and selected routes sampled |
| Stores / Categories / Products / Media | PARTIAL | Several categories and store/menu states; not every vertical or merchant |
| Search / Filters / Sort | PARTIAL | Store/product mode, selected queries, filters and no-result state |
| Cart / Checkout | PARTIAL | Temporary cart item added then removed; checkout controls inspected without order submission |
| Orders / Tracking | PARTIAL | Orders and cart tabs/status filters viewed; no transaction detail or repeat action |
| Account | PARTIAL | Profile, addresses, city picker, balance, help, contact and privacy routes sampled |
| Promotions / Banners | PARTIAL | Offers list, a promotion's branch choices and a branch menu sampled |
| Product / UX | PARTIAL | Visible hierarchy and several core interactions sampled |
| Behavior / Logic / Visible State Machine | PARTIAL | Selected before/after states observed; no backend semantics inferred |
| Interaction / Buttons / Tabs / Controls | PARTIAL | Controls listed in interaction evidence; many lower-priority categories and external actions remain untested |
| Experimental Paths / Input Variations | PARTIAL | No-result/product search, empty coupon validation and delivery/pickup toggle sampled |
| Loading / Empty / No Results / Error / Retry | PARTIAL | Empty cart, search, custom-order validation and loading message observed; error/retry coverage incomplete |
| Offline / Conflict / Recovery | NOT_REVIEWED | No network interruption or concurrent conflict induced |
| RTL / Arabic / Accessibility | PARTIAL | Arabic RTL rendered states observed; screen-reader and systematic accessibility checks not performed |
| Visual Hierarchy / Density / Media | PARTIAL | Screenshots capture representative home, search, menu, account and subscription screens |
| Technical / Platform Behavior | PARTIAL | Package/version/activity read from device; no internal implementation inspected |
| Performance / Responsiveness / Jank / Latency | NOT_REVIEWED | No controlled measurement performed |
| State Persistence / Refresh / Relaunch | PARTIAL | A data-refresh action completed; notification badge change was observed but causality and content freshness were not established; no relaunch/persistence test |

Allowed statuses: `NOT_REVIEWED`, `CURRENT`, `STALE`, `PARTIAL`, `N/A`. Do not mark an area `CURRENT` when material interaction, logic or state behavior remains untested.

## Current verified state
- The four persistent destinations are Home, Orders, Subscriptions and Account. The home header includes search, notifications and contact entry points.
- Home shows working-hours/open status, promotional banners, category tiles, offer filters (`All`, `Closest`, `New`, `Favorites`) and store cards with visible status, distance/category/benefit badges and favorite controls. The Favorites view was observed empty after the review cleanup.
- The category grid contained 21 visible groups. Restaurants, Pro, global shops, pickup and `وصل لي` were opened. The remaining groups (spices/nuts, sweets/juice/pastries, fruit/vegetables, honey/dates/nuts, supermarkets, chicken/meat/fish, fastest restaurants, home projects, perfume/beauty, accessories, cleaning, pharmacies, antiques/gifts/home goods, stationery/bookstores, online shops and clothes) were not individually reviewed.
- Pro filtering exposed an offer and a `Subscribe now` action. Global shops showed SHEIN and a manual/custom order entry route. The custom-order submission and product-add action were not used.
- The offers list exposed restaurant promotions. One promotion opened branch choices; a branch menu showed discounted and original prices. No offer purchase was made.
- Search separates Stores and Products, offers category choices and `All`/`Closest`/`New`/`Favorites` filters. A `pizza` product search returned an explicit no-results state with a `وصل لي` alternative. A `chicken` store search showed Chicken Hut; product search showed matching products, including results associated with a closed store, so availability was not established. When the inherited filter was `Favorites`, results were empty until `All` was selected.
- Store detail showed rating count, price-parity text, open state and Delivery/Self-pickup controls. A sampled menu exposed Favorites/Most ordered/Appetizers/Meat groups, product prices, favorites, quantity controls and item-option rows. Pickup showed a pickup-location panel and `Open map`; the map link was not opened. An item detail and a weighted-product option sheet showed distinct variants/prices.
- A temporary variant was added to the cart, its quantity was observed, then that item was removed through its line-item delete control. The cart returned to its explicit empty state. A favorite control was also exercised during review and then reverted; Favorites was verified empty afterward. These were review-only temporary mutations; no item or favorite remained in the observed state.
- With the temporary cart item, checkout exposed fulfillment, coupon, saved-address change, notes, schedule, payment, recommendations, Edit Cart and Execute Order controls. Switching Delivery to Pickup changed the displayed total and payment label to Jib Wallet; switching back restored the prior delivery selection and cash-on-delivery label. No prices or account/order identifiers are retained here. The item was then removed; `Execute Order` and `Delete All Items` were not activated.
- Checkout coupon entry and blank apply/discount validation were sampled; no coupon was entered or applied. Saved address manager opened without changing an address. Notes entry opened without saving text. Schedule picker showed date choices and time slots; Back exited without confirming a schedule. Wallet-method sheet listed Jib, Jawali, Haseb, ONE Cash, Cash and Flosak; no method was selected. Expanding recommendations showed products without adding one.
- Orders opened with `My Orders` and `My Carts` tabs. Delivery/self-pickup and status filters were visible. Delivery showed an existing delivered order with a Repeat Order control; no transaction detail or repeat action was opened. Pickup showed no orders; My Carts showed no cart.
- Account menu exposes profile, My Orders, Subscriptions/Pro, Balance, Addresses, Change City, Contact Us, Privacy Policy, Share App, How to use app and Update App Data. Lower rows were reached by scrolling.
- Profile showed editable name/phone, address label, optional contact number and an embedded map. Address management showed saved-address Edit/Delete/Add controls; edit and blank add routes displayed map-based forms. No profile/address data was changed, added or deleted. The city picker showed Sana’a, Aden, Ibb, Mukalla, Taiz-Al-Hawban, Marib, Dhamar and Taiz-city; no city was selected.
- Balance displayed a balance area and Add Balance route. The top-up screen showed amount entry and Jib, Jawali, Haseb/Kuraimi, ONE Cash, Cash, Flosak, Bayes and Easy wallet payment options. No amount or payment was entered.
- Contact screen showed WhatsApp, call, Facebook, Instagram and YouTube options; none was opened. Share App opened the Android share chooser, which was dismissed without copying or sending anything. Privacy Policy opened a browser custom tab on `tawseel.app`; visible text described collecting account identifiers and location for delivery and using personal information to provide/improve service. This is a content observation, not a legal assessment.
- How to use app listed six tutorial topics: delivery usage, offers, restaurant hours, repeat orders, rating orders and changing area. The first opened a YouTube in-app activity with an ad; no like/share/follow action was taken. The other tutorials were not opened.
- Pro offer text showed 500 Yemeni riyals for three months, up to 12 orders, nearby-area free delivery and a qualifying 2,000+ order condition; a participating-restaurants list showed 241 restaurants. The payment-setting sheet offered first-order payment, balance and wallets. Coupon entry rejected a blank attempt with an empty-coupon message. The initial account state showed auto-renew checked; it was not toggled. Terms pages described default auto-renew/cancellation, benefit period, refund limits, transfer/stacking restrictions and complaint support; this is a paraphrase of displayed terms, not legal advice.
- `Update App Data` displayed a loading message about preparing data for the first time and returned to Home. The unread badge changed from 1 to 3 around this sequence; whether the refresh caused that change is unverified, and no content freshness result was measured.

## Interaction / experiment evidence
- Entered routes: Home, category grid, selected categories, promotion list/branch/menu, store menu and pickup mode, product detail/options, store/product search, temporary cart and checkout, Orders/My Carts, Subscriptions/Pro, profile, address forms, city picker, balance/top-up, help, contact, privacy and share chooser.
- Exercised controls: main tabs; search entry/submit/clear/back, store/product switch and selected filters; category/store/promotion cards; product options and quantity; favorite toggle with cleanup; cart add/remove; delivery/pickup selector with reversal; coupon blank validation; address manager entry; notes and schedule entry/back; wallet-method list; recommendation expansion; order/cart/status/fulfillment tabs; profile/account routes; share chooser dismissal; subscription payment/coupon entry; and Update App Data.
- Alternate paths: `pizza` no-result and `chicken` results; switching inherited Favorites filter to All; delivery versus pickup; empty coupon; schedule Back; transient cart line removal; favorite removal; help tutorial entry followed by Back.
- Explicitly not exercised: final order submit, delete-all, repeat order, transaction detail/cancel/tracking, payment or balance top-up, subscription purchase, auto-renew change, coupon application with a valid code, saved-address edit/save/add/delete, city change, profile save, custom-order submission, map destination, contact calls/messages/social links, share recipient/send, notifications list, or other external consequential actions. Reasons include paid/destructive/account-state change or crossing an external contact/share boundary.
- Cleanup/readback: temporary cart item removed and empty-cart state observed; temporary favorite reverted and Favorites empty state observed; delivery selection reverted; no order, payment, subscription, address, profile or city change was submitted.

## Logic / behavioral inferences
- `OBSERVED`: store and product search are separate visible modes; a filter selection affects visible search results.
- `OBSERVED`: product options expose separately priced selectable variants before cart; cart line quantity and removal are visible.
- `OBSERVED`: checkout's visible payment label and total react to the selected delivery/pickup mode; the displayed state was reversible in this sampled session.
- `OBSERVED`: Pro presents an offer, payment-choice sheet, coupon input and checked auto-renew control in the sampled account state.
- `HYPOTHESIS`: the notification badge increase may be related to the app-data refresh; timing alone does not establish causation.
- No hidden service/API or durable backend behavior is inferred from the UI.

## Visual findings
- Arabic RTL interface with red/orange emphasis, image-led promotional/category areas, store rows and a persistent four-destination navigation bar.
- Home and offers use banners/cards; store/menu views combine status, approximate distance, price/category details and action controls.
- Search no-result and empty cart use explicit Arabic messages and a mascot; `وصل لي` provides an alternate route from selected empty/search states.
- Account, wallet and subscription surfaces contain account-specific information. Their screenshots remain local and ignored by Git.

## Technical / performance observations
- Package, version, versionCode and foreground activity were read from the attached Android device.
- No binary internals, source, APIs, credentials or network traffic were inspected.
- No controlled latency, jank, offline, conflict, lifecycle/relaunch or TalkBack/accessibility measurement was performed.

## Useful patterns
- Discovery cards make store state, approximate distance and service/offer badges visible before opening a store.
- Store/product search separation, visible filters and explicit empty results support discovery.
- Variant prices and quantity controls are shown before checkout; an empty cart has a direct return-to-shopping action.
- Checkout exposes fulfillment, notes, schedule, address, coupon and payment choices in one route; the visible price/payment state reacted to the sampled fulfillment toggle.

## Weaknesses / rejected patterns
- No confirmed product defect was established in this partial review.
- Product results associated with a closed store make availability ambiguous in the sampled search; this is an observation requiring broader context, not a confirmed defect.
- Blank coupon rejection and a general loading message were observed; successful coupon, refresh correctness and failure/retry behavior remain untested.
- No finding is made about legal compliance, accessibility, operational reliability or performance.

## BThwani relevance
Use only to challenge an active BThwani decision. Any candidate pattern must be compared with pinned Governance and current BThwani implementation; this competitor file is evidence, never product or architecture authority.

## Unreviewed / stale areas
- The 16 category groups listed above were not opened individually; merchant and promotion coverage is representative only.
- Notification contents were not opened to avoid changing unread state. Order detail/tracking/cancel/repeat, all-order states and pagination remain unreviewed.
- Paid subscription and top-up, auto-renew change, final order submit, valid coupon, delete-all and custom-order submission remain untested.
- Address/profile save and destructive address actions, city change, map selection, external contact/share destination and additional help tutorials remain untested.
- Offline/error/retry/conflict, relaunch persistence, measured responsiveness and formal accessibility remain unreviewed.

## Local screenshots
All 46 PNG captures below are under `local-photos/tawseel-one/`. That folder's `.gitignore` ignores every capture and allows only `.gitignore`; the screenshots are local evidence and must not be staged, committed, uploaded or pushed. Some account/checkout images may show private on-device content; keep them local.

### Home, discovery, store, search and cart
- [All categories](local-photos/tawseel-one/tawseel-one-all-categories.png)
- [All offers](local-photos/tawseel-one/tawseel-one-all-offers.png)
- [Pro filter offer](local-photos/tawseel-one/tawseel-one-tawseel-pro-filter.png)
- [Global shops](local-photos/tawseel-one/tawseel-one-global-stores.png)
- [SHEIN custom order form](local-photos/tawseel-one/tawseel-one-shein-custom-order.png)
- [Wassel Li form](local-photos/tawseel-one/tawseel-one-wassel-li-form.png)
- [Wassel Li order types](local-photos/tawseel-one/tawseel-one-wassel-li-order-types.png)
- [Wassel Li empty validation](local-photos/tawseel-one/tawseel-one-wassel-li-empty-validation.png)
- [Promotion storefront](local-photos/tawseel-one/tawseel-one-promotion-storefront.png)
- [Promotion branch choices](local-photos/tawseel-one/tawseel-one-promotion-branches.png)
- [Promotion pizza category](local-photos/tawseel-one/tawseel-one-promotion-pizza-category.png)
- [Promotion broast category](local-photos/tawseel-one/tawseel-one-promotion-broast-category.png)
- [Storefront](local-photos/tawseel-one/tawseel-one-storefront.png)
- [Store pickup mode](local-photos/tawseel-one/tawseel-one-store-pickup-mode.png)
- [Appetizers menu](local-photos/tawseel-one/tawseel-one-menu-appetizers.png)
- [Meat menu](local-photos/tawseel-one/tawseel-one-menu-meat.png)
- [Item detail](local-photos/tawseel-one/tawseel-one-item-detail.png)
- [Product options](local-photos/tawseel-one/tawseel-one-product-options.png)
- [Search no results](local-photos/tawseel-one/tawseel-one-search-no-results.png)
- [Chicken store search results](local-photos/tawseel-one/tawseel-one-search-store-results-chicken.png)
- [Chicken product search results](local-photos/tawseel-one/tawseel-one-search-product-results-chicken.png)
- [Temporary checkout state](local-photos/tawseel-one/tawseel-one-cart-checkout-temporary.png)
- [Temporary cart edit state](local-photos/tawseel-one/tawseel-one-cart-edit-temporary.png)
- [Empty cart after cleanup](local-photos/tawseel-one/tawseel-one-empty-cart.png)
- [Checkout coupon form](local-photos/tawseel-one/tawseel-one-checkout-coupon-form.png)
- [Checkout schedule picker](local-photos/tawseel-one/tawseel-one-checkout-schedule.png)
- [Checkout wallet methods](local-photos/tawseel-one/tawseel-one-checkout-wallet-methods.png)

### Account, addresses, balance and help
- [Account menu](local-photos/tawseel-one/tawseel-one-account-menu.png)
- [Account profile](local-photos/tawseel-one/tawseel-one-account-profile.png)
- [Saved addresses](local-photos/tawseel-one/tawseel-one-addresses.png)
- [Address edit form](local-photos/tawseel-one/tawseel-one-address-edit-form.png)
- [City picker](local-photos/tawseel-one/tawseel-one-city-picker.png)
- [Balance top-up options](local-photos/tawseel-one/tawseel-one-balance-topup.png)
- [Contact options](local-photos/tawseel-one/tawseel-one-contact-options.png)
- [How-to menu](local-photos/tawseel-one/tawseel-one-how-to-menu.png)
- [Share chooser](local-photos/tawseel-one/tawseel-one-share-sheet.png)
- [Privacy policy](local-photos/tawseel-one/tawseel-one-privacy-policy.png)

### Subscription and terms
- [Subscriptions](local-photos/tawseel-one/tawseel-one-subscriptions.png)
- [Participating restaurants](local-photos/tawseel-one/tawseel-one-subscription-restaurants.png)
- [Subscription payment methods](local-photos/tawseel-one/tawseel-one-subscription-payment-methods.png)
- [Subscription coupon entry](local-photos/tawseel-one/tawseel-one-subscription-coupon-entry.png)
- [Subscription terms: account](local-photos/tawseel-one/tawseel-one-subscription-terms-account.png)
- [Subscription terms: continuation](local-photos/tawseel-one/tawseel-one-subscription-terms-continuation.png)
- [Subscription terms: renewal](local-photos/tawseel-one/tawseel-one-subscription-terms-renewal.png)
- [Subscription terms: final section](local-photos/tawseel-one/tawseel-one-subscription-terms-final.png)
- [Subscription privacy terms](local-photos/tawseel-one/tawseel-one-subscription-privacy-terms.png)

## Review history
### 2026-09-26 — Live Android partial review, expanded and corrected
- Rechecked the installed `2.0.63` app on `SM-S9280`; expanded observations to include account, selected categories, promotions, search, store/menu, temporary cart/checkout, order tabs, balance, help, privacy and subscription terms.
- Added local links for all 46 screenshots and marked screenshot storage as ignored/local-only.
- Corrected earlier incomplete wording: a temporary cart item and favorite were exercised then removed; checkout was viewed without submitting an order. The observed cart returned empty and Favorites returned empty after cleanup.
- Kept review confidence `PARTIAL`: substantial controls remain deliberately untested because they involve payment, personal data, destructive changes or external actions; offline/recovery, accessibility and performance were not measured.
