# Tasaheel / تساهيل

EVIDENCE_CLASS: CACHED_EXTERNAL_BLACK_BOX_EVIDENCE
PRODUCT_AUTHORITY: NONE
CANONICAL_FILE_FOR_THIS_APP: YES
PARALLEL_REPORTS_ALLOWED: NO

## Identity / technical state
- Display name: `تساهيل`
- Package: `com.adunit.ecommerce.tasaheel`
- Launch Activity: `com.adunit.ecommerce.tasaheel/.MainActivity`
- Device: `SM-S9280`
- Priority: `HIGH_YEMEN_FIT`
- Role: High-priority Yemen-market reference.
- App version: `1.7.9` (installed package readback; versionCode `179`)
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
| Orders / Tracking | PARTIAL |
| Account | PARTIAL |
| Promotions / Banners | PARTIAL |
| Product / UX | PARTIAL |
| Behavior / Logic / Visible State Machine | PARTIAL |
| Interaction / Buttons / Tabs / Controls | PARTIAL |
| Experimental Paths / Input Variations | PARTIAL |
| Loading / Empty / No Results / Error / Retry | PARTIAL |
| Offline / Conflict / Recovery | NOT_REVIEWED |
| RTL / Arabic / Accessibility | PARTIAL |
| Visual Hierarchy / Density / Media | PARTIAL |
| Technical / Platform Behavior | PARTIAL |
| Performance / Responsiveness / Jank / Latency | NOT_REVIEWED |
| State Persistence / Refresh / Relaunch | NOT_REVIEWED |

Allowed: `NOT_REVIEWED`, `CURRENT`, `STALE`, `PARTIAL`, `N/A`.

Do not mark an area `CURRENT` if only its visual layer was observed while material interaction, logic or state behavior remains untested.

## Current verified state
- Installed on `SM-S9280`; package readback reports version `1.7.9` / versionCode `179`.
- Home is a vertically scrolling category/offer surface. It shows the selected service branch, an information entry, branded store logos, promotion/free-delivery creatives and image-led category cards.
- Restaurant discovery exposes `New`, `Closest`, `Favorites` and default tabs. Store rows show rating, open/closed status and a 40–60 minute estimate; distance appeared as unavailable (`-- km`) in the inspected list.
- Search separates stores and products. A `pizza` store search showed an explicit unavailable/not-joined explanation and a `Faza'a` ordering route. After switching modes, the visible query changed to Chicken and chicken product rows appeared; the cause of that query change was not established, so matching behavior is not concluded.
- A restaurant storefront exposes horizontal food categories, product descriptions/images, prices, availability, favorites and quantity/cart controls. A product detail overlay showed size/unit choices with distinct prices and quantity controls; nothing was added.
- A store-hours sheet showed the same weekday twice (Friday, with overlapping visible time intervals); the cause and source data are unverified.
- Opening the account menu showed Favorites, Order History, Profile and Settings. Favorites, Order History and Profile led to the app sign-in screen; no credentials, OTP or social account were submitted.
- Settings opened a modal with Dark/Light appearance options, Privacy Policy and displayed version `1.7.9 [179]`. Light was selected; the theme was not changed and the policy link was not opened.
- Tapping a product's cart-add control led to the same sign-in gate. The add did not complete; no cart item, order, payment, favorite mutation or address/branch change was made.

## Current observations
- Visual language is pale cream with bright green controls, large Arabic RTL text, mixed Arabic/English store names, banner carousels and large photographic category/store cards.
- Store lists provide New/Closest/Favorites/default ordering. Tapping Closest displayed a `select address first` prompt and a Change action; no address was selected.
- Favorites displayed an explicit empty state (`لا يوجد عناصر حاليا`). New displayed both open and closed stores.
- Storefront product cards present copy, image, price, stock/availability badge, favorite heart and quantity/cart controls together.
- The inspected Castle hours sheet visibly rendered Friday twice: the regular 08:00–22:00 interval and another 13:00–22:00 interval. This is an observed UI duplication; its cause is unknown.
- The account menu is a separate screen with Favorites, Order History, Profile and Settings rows. Favorites, Order History and Profile each reached a phone/social sign-in screen before their contents; no sign-in action was taken.
- Settings is available without completing sign-in and shows a Dark/Light selector, Privacy Policy entry and app version `1.7.9 [179]`; Light was selected during observation.
- The product-card cart-add control opened a sign-in gate before any cart state was shown. This review did not reach checkout.

## Interaction / experiment evidence
- Tabs/routes entered: Home, search, restaurant listing, restaurant storefront, product options, restaurant hours, account menu, sign-in gate, Settings modal.
- Buttons/controls exercised: floating search, text search, Stores/Products switch, restaurant category card, New/Closest/Favorites tabs, store row, hours icon, product detail open/close, Favorites and Order History/Profile entries, Settings entry and product-card cart-add control.
- Paths/input variations tried: unmatched store query `pizza`; switched search mode; visited a product detail without changing its quantity; tried Closest with no selected address.
- Additional paths: opened account Favorites, Order History and Profile, each of which required sign-in; opened Settings and inspected its theme/privacy/version modal without changing settings; tapped a product cart-add control and stopped at the sign-in gate.
- States reached: populated home, no-store result with alternate ordering route, product results, restaurant listing, empty favorites filter, address-required prompt, storefront menu, hours sheet, account menu, authentication gate and Settings modal.
- Results observed: Closest requested an address; protected account/cart routes requested sign-in; no item was added and no business/account data was changed.
- Unreached/not-tested items and reason: no address/branch was changed; checkout, payment, order details/tracking, profile data, authentication/OTP, notifications, privacy-policy content, promotion destination, favorite mutation, offline/conflict/retry, refresh/relaunch and accessibility were not exercised.

## Logic / behavioral inferences
- Closest sorting appears address-dependent because the UI blocks it with a select-address prompt; the address selection flow itself was not tested.
- Store and product search are visibly separate modes. The query text changed during mode switching in this session, so the relationship between entered query and product results remains unresolved.
- Hours presentation appears to include an overlapping duplicate Friday interval; this is a UI observation, not a proven backend schedule defect.

## Visual findings
- Category and store discovery rely heavily on promotional photography and brand logos. Product imagery and descriptions are prominent in the opened storefront.
- Store data is bilingual in places, with rating and availability status visually separated from name and delivery estimate.
- Cream/green surfaces and rounded cards provide a consistent visual language; keyboard and screen were Arabic RTL during search.

## Technical / performance observations
- Package/version and foreground activity were read from the live Android device. No app internals were inspected.
- No controlled latency, jank, offline, lifecycle or device-accessibility measurement was performed.

## Useful patterns
- Store listing makes rating, open state and estimated time visible; New/Favorites/default sorting is explicit.
- A no-store search gives an alternative ordering route. Closest explains its address prerequisite rather than silently returning a location-independent list.
- Product cards pair imagery and description with price, availability and direct quantity controls; detailed items can expose unit/size-specific pricing.

## Weaknesses / rejected patterns
- The duplicated overlapping Friday rows are a potential schedule-display/data-quality issue, but root cause was not established.
- Store distance was shown as `-- km`; location availability may explain it, but this was not resolved.
- Search-mode query transition was ambiguous in this session; no search-matching defect is claimed.

## BThwani relevance
- Challenge only the current material BThwani decision; never use this file as Product or architecture authority.

## Unreviewed / stale areas
- Account/profile contents, authentication and OTP, notification details, branch selection, delivery/pickup, search error/retry, cart contents, checkout/payment, order details/tracking, privacy-policy content, promotion destinations, favorite mutation, offline/conflict/recovery, refresh/relaunch persistence, accessibility and measured performance remain unreviewed. Entry to several account/cart routes was observed to require sign-in; no sign-in was performed.

## Local screenshots
- Local captures from the reviewed Android session; files are app-foldered under `local-photos/tasaheel/` and ignored by Git, so they remain on this machine.
- [Home](local-photos/tasaheel/tasaheel-home.png)
- [Restaurant list](local-photos/tasaheel/tasaheel-restaurant-list.png)
- [Store menu](local-photos/tasaheel/tasaheel-store-menu.png)
- [Store hours](local-photos/tasaheel/tasaheel-store-hours.png)
- [Refreshed home](local-photos/tasaheel/tasaheel-home-followup-20260926.png)
- [Account menu](local-photos/tasaheel/tasaheel-account-menu-followup-20260926.png)
- [Favorites sign-in gate](local-photos/tasaheel/tasaheel-favorites-followup-20260926.png)
- [Order History sign-in gate](local-photos/tasaheel/tasaheel-order-history-followup-20260926.png)
- [Profile sign-in gate](local-photos/tasaheel/tasaheel-profile-sign-in-followup-20260926.png)
- [Settings modal: theme, privacy and version](local-photos/tasaheel/tasaheel-settings-screen-followup-20260926.png)
- [Restaurant discovery list](local-photos/tasaheel/tasaheel-restaurants-followup-20260926.png)
- [Storefront and product cart controls](local-photos/tasaheel/tasaheel-storefront-followup-20260926.png)
- [Cart-add sign-in gate](local-photos/tasaheel/tasaheel-cart-add-sign-in-gate-followup-20260926.png)

## Review history
### 2026-09-26 — Evidence file initialized / protocol hardened
- Recorded only known technical identity.
- Added mandatory interactive, experimental, logical, behavioral, visual, technical, performance and recovery review coverage.
- No unobserved finding was fabricated.
### 2026-09-26 — Live Android partial review
- Inspected the installed `1.7.9` app on `SM-S9280`; sampled home, search, restaurant sorting/list, storefront, product detail and hours.
- Recorded the address gate for Closest and the duplicated Friday hours as visible observations; did not change address, branch, cart, order, payment or account state.
### 2026-09-26 — Account and cart access delta
- Revisited home, restaurant list/storefront and account entry points. Account Favorites, Order History and Profile, plus a product cart-add action, reached a sign-in gate; no account was selected and no purchase/cart mutation occurred.
- Inspected the Settings modal (Dark/Light, Privacy Policy, installed version) without changing the theme or opening external policy content; linked the new local captures.
