# Elleen visual benchmark for BThwani — 2026-10-31 to 2026-11-01

ARTIFACT_CLASS: NONAUTHORITATIVE_EXTERNAL_REFERENCE
ADOPTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
REFERENCE_FRESHNESS: REVALIDATE_AT_USE

The filename identifies the initial observation date (2026-10-31). Follow-up read-only inspections dated 2026-11-01 are identified below; they are not attributed to the initial capture.

## Verified access and evidence

- 2026-10-31, user-supplied Edge screenshot: https://elleen.ye/admin/dashboard (authenticated dashboard with primary sidebar).
- 2026-10-31, user-supplied Edge screenshot: https://rrda.elleen.ye/ (public storefront homepage viewport).
- Read-only Playwright over existing Edge CDP port 9223 confirmed the dashboard and storefront DOM in the earlier connected inspection. On this branch's inspection, https://elleen.ye/admin/settings/payment returned HTTP 200 with title `إعدادات الدفع - إيلين`, heading `طرق الدفع`, and the payment configuration headings below.
- Observed UI only; no form was submitted, no payment initiated, no paid PRO feature unlocked, no backend/API/private implementation inspected.

## Payment settings — OBSERVED, not tested integrations

Headings: `الدفع عند الاستلام (COD)`, `التحويل البنكي المباشر`, `بنك الكريمي الإسلامي (Kuraimi)`, `محفظة جيب (Jeeb)`, `موبايل ماني (Mobile Money)`, `محفظة جوالي (Jawali)`, `كاش باي (CashPay)`, `فلوسك (Floosak)`, `محفظة إيزي (Easy Wallet - Link API)`, `محفظة ون كاش (OneCash)`.

These are visible labels, **not evidence** that all payment providers are live, integrated, inexpensive, or appropriate for BThwani. BThwani external rail admission and provider reconciliation remain with the governed Finance/WLT and provider contracts.

## Elleen operator sidebar — screenshot-observed items

| ID | Visible menu entry | Verification |
| --- | --- | --- |
| E01 | لوحة التحكم | Screenshot + prior live DOM |
| E02 | الطلبات | Main orders and refunds list DOM observed read-only; actions NOT_RUN |
| E03 | الكتالوج | Products, stock and product-questions list DOM observed read-only; mutations NOT_RUN |
| E04 | العملاء | Customer wallet and notification list screens read-only; actions NOT_RUN |
| E05 | التسويق (PRO) | Sidebar only; locked flow NOT_RUN |
| E06 | التقارير | Report overview and seven subpages read-only; data/exports NOT_RUN |
| E07 | التحليلات الذكية (BI) (PRO) | Sidebar only; internal logic UNKNOWN |
| E08 | الشحن | Carriers, countries, rules and classes screens read-only; effects NOT_RUN |
| E09 | الإعدادات | Payment settings OBSERVED; other subpages NOT_RUN |
| E10 | تخصيص الثيم | Theme page read-only; publication NOT_RUN |
| E11 | سوق الإضافات والتطبيقات (PRO) | Sidebar only; inner routes NOT_RUN |
| E12 | متجر الخدمات (PRO) | Sidebar only; inner routes NOT_RUN |
| E13 | حسابي | Sidebar only; inner routes NOT_RUN |
| E14 | الإشعارات | Notification list read-only; delivery NOT_RUN |
| E15 | دعم المتجر / الدعم الفني (PRO) | Sidebar only; inner routes NOT_RUN |
| E16 | واتساب (PRO) | Settings page read-only; provider integration NOT_RUN |
| E17 | مساعد الذكاء الاصطناعي (قريبًا) | Teaser only; NOT an observed working capability |
| E18 | الاستيراد والتصدير | Experimental import/export page read-only; actions NOT_RUN |
| E19 | الموظفون (PRO) | Sidebar only; role behavior NOT_RUN |
| E20 | سجل النشاطات | Activity list and filter controls observed read-only; audit integrity NOT_RUN |
| E21 | سلة المحذوفات | Recycle-bin page read-only; restore/delete NOT_RUN |
| E22 | نسخ رابط المتجر | Sidebar action visible; action NOT_RUN |
| E23 | مناديب التوصيل (PRO) | Menu observed; paid workflow unverified |
| E24 | التسويات (PRO) | Menu observed; paid financial workflow unverified |

Other visible dashboard controls: search, theme, language, user menu, store toggle, about-store link, on-boarding/checklist and stock/attention cards; these are not individually validated. A PRO badge or label is evidence of marketing/navigation, not proof of paid internal behavior.

## RRDA public storefront — screenshot-observed

Visible: brand/header, search, primary categories, homepage/shop/about/contact navigation, cart, notifications, account, favorites, locale, hero carousel (arrows/pause/action), category browsing, floating help/chat. Product detail, authenticated cart, payments, checkout, order submission, responsive behavior and negative/error states are NOT_RUN.

## 2026-11-01 focused browser observations (read-only Playwright)

These are pages of the user's current Elleen account and RRDA storefront, observed through the connected Edge session. They are not third-party backend, permissions, payment, or recovery proofs. No private code, internal API, paywall bypass, mutation, purchase, inventory change, or refund submission was attempted.

| Surface | Visited route | OBSERVED UI and controls | NOT_TESTED |
| --- | --- | --- | --- |
| Orders | https://elleen.ye/admin/orders | Orders list with status groupings, search, payment and method filters, link to create an order, and refunds navigation | Order creation, state transitions, payment handling |
| Refunds / returns | https://elleen.ye/admin/orders/refunds/list | الاستردادات والمرتجعات; all/pending/approved/completed/rejected groupings, reset filters and page size | Approval, refund calculations, ledger, authorization, reversal |
| Products | https://elleen.ye/admin/catalog/products | Product list, category/brand filters, search, quick add and links to categories, brands, variations, stock, questions and reviews | Product mutation, variant persistence, stock effects |
| Inventory | https://elleen.ye/admin/catalog/stock | إدارة المخزون; inventory settings link, stock summaries, add/remove stock buttons | Stock changes, concurrent reservation, history/audit |
| Product questions | https://elleen.ye/admin/catalog/product-questions | أسئلة المنتج page and status filter | Moderation, notifications, answers, permissions |
| Activity log | https://elleen.ye/admin/activity-logs | سجل النشاطات with date, action and category filters plus per-event change view buttons | Completeness, actor provenance, export, immutable audit |
| RRDA catalog | https://rrda.elleen.ye/products | Category, brand, price and sort controls, quick view, favorites, product sharing, quick cart and back-in-stock notification buttons | Checkout, notifications delivery, account isolation, failed submissions |

BThwani comparisons remain bounded: Store stock updates and stockout filtering already exist in Partner/DSH source; do not recreate those owners. Existing financial order adjustments and settlement code cannot be assumed to match Elleen's full refund workflow without a contract-and-ledger E2E inspection. Product questions are a visible competitor feature, not yet an independently approved BThwani capability. Activity-audit evidence is scoped to existing service/actor records, not proof of an Elleen-like global audit screen.

## 2026-11-01 expanded navigation and 29-page read-only census

Playwright opened 29 additional routes using the user's authorized Edge session. Each returned HTTP 200 with a visible heading; **route access does not prove a working feature or entitlement**. No payment, subscription upgrade, financial transaction, customer-record inspection, form submission or source-code copying was attempted.

| Elleen group | Opened screen routes | Evidence limit |
| --- | --- | --- |
| Catalog | /admin/catalog/filters; /admin/catalog/brands; /admin/catalog/attributes; /admin/catalog/product-sections; /admin/catalog/product-reviews | Headings only; product mutations and moderation NOT_RUN |
| Customers | /admin/customers/wallets; /admin/customers/notifications | No private customer balances or broadcast notification actions |
| Reports | /admin/reports; /admin/reports/sales; /admin/reports/orders; /admin/reports/products; /admin/reports/customers; /admin/reports/inventory; /admin/reports/coupons; /admin/reports/traffic | Aggregates, filters, exports and monetary accuracy NOT_RUN |
| Shipping | /admin/settings/shipping-carriers; /admin/settings/shipping-countries; /admin/settings/shipping-rules; /admin/settings/shipping-classes | Carrier integration and delivery tariff behavior NOT_RUN |
| Brand and onboarding | /admin/verification; /admin/theme; /admin/onboarding | No proof submission or published theme change |
| Operations | /admin/settings/whatsapp; /admin/helpdesk; /admin/notifications; /admin/recycle-bin; /admin/import-export | Message delivery, deletion/restoration and file actions NOT_RUN |
| Commercial plans | /admin/plans | Plan presentation only; no upgrade or payment |
| SEO | /admin/seo/dashboard | **Redirects to /admin/plans**: SEO is not verified as active for this Store |

Menu expansion also revealed orders/refunds, catalog products/categories/stock, Store customer wallets/notifications, reporting, shipping and PRO-labelled marketing, BI, delivery representatives, settlements and staff. No paid feature internals were accessed or inferred as fact.

## BThwani impact routing — verified source existence only

| Concern | Canonical area | Status |
| --- | --- | --- |
| Store setup, catalog, orders, reports, employees | Partner workspace (`apps/app-partner` web + native), DSH | Implementations present; full flow NOT_RUN |
| Store commercial agreement | WLT via DSH partner readback | Read-only setup state added on this branch; full live browser/device proof NOT_RUN |
| Partner onboarding, store admissions, policies | Operator workspace, DSH | Implementations present; complete permissions and live flow NOT_RUN |
| Checkout/storefront/discovery | Client web/native, DSH | Implementations present; complete real-user journey NOT_RUN |
| Dispatch, COD, delivery | Captain web/native, DSH + WLT | Implementations present; complete integration proof NOT_RUN |
| Store payment terms: commission or subscription by type | WLT Store Commercial Agreement owner, DSH Store Type context | User-authorized objective; subscription billing/version/renewal/settlement NOT_IMPLEMENTED in this work |
| Design and store brand | Existing design system and Operator Studio | Source exists; no unrestricted SaaS store builder implied |

Partner is one actor-facing workspace on mobile and web. Operator Partner Management is distinct. A feature visible in a competitor is not an automatic BThwani requirement. External images, brand assets, customer data, source code and paywalled implementation are not copied.

## Current working boundary

This reference is evidence only; it cannot activate Product capabilities. No external billing change is authorized by merely observing payment labels. Any subscription implementation must define Store-specific accepted versioned terms, period, invoice/retry/reversal/renewal, payment/settlement accounting, service authorization and independent finance review before release. Current Partner changes show existing agreement readback, correct partial catalog readiness, and tolerate unavailable Studio theme reads; they do not create subscription charges or change a real ledger.

## 2026-11-01 settings-only Playwright census (read-only)

A new Playwright tab in the owner's already-authenticated Edge session opened the settings index and its 11 linked pages. All navigation was GET-only; no settings were saved, paid tiers accessed, form submissions sent, or backend/private APIs inspected. The observations below supersede the earlier NOT_RUN label for **settings subpage navigation only**, not for functional or financial workflows.

| Elleen page (OBSERVED) | UI capabilities observed | BThwani current owner and bounded adoption decision |
| --- | --- | --- |
| `/admin/settings/brand` | Store identity, image, store type, timezone, address and custom domain | DSH store record and existing store media; Partner settings and Operator store file already show relevant parts. New editable business contacts/branding need an owner-backed versioned contract, not a page-only field. |
| `/admin/settings/contact` | Phone, email, hours, location, map link and social accounts | DSH onboarding/store availability currently owns location/hours; contact/social links require separately approved DSH source, privacy rules, public projection and Partner/Operator editors. **Not implemented here**. |
| `/admin/settings/payment` | COD, direct bank transfer and named Yemen wallet providers | WLT and existing Finance policy/providing readback own actual payment options, wallet and settlements. Partner agreement is read-only on financial approvals. No new payment rail enabled by observing a label. |
| `/admin/settings/currency` | Base currency, display precision/separators, multi-currency upsell | Retain current canonical YER financial semantics. Locale/format may be reused in shared design-system; do not let UI redefine monetary units or create FX/accounting claims. |
| `/admin/settings/whatsapp` | WhatsApp enable and contact field | Potential Partner contact link only after owner-authenticated, validated number and customer privacy/disclosure. **No WhatsApp order bypass or implicit integration**. |
| `/admin/settings/in-app-notifications` | Nine editable templates for loyalty, orders, stock, refunds and welcome | Existing DSH/Identity notification owners and Partner inbox. Customization must not disable mandatory notices, reveal other tenants or let arbitrary copy impersonate platform. Not implemented. |
| `/admin/settings/seasonal-decorations` | Occasion, motion, color, per-page visibility and scheduling | Optional future Store presentation configuration. Existing Studio/design tokens govern platform visual language; keep reduced-motion and accessible content. Not implemented. |
| `/admin/settings/refund` | Refund enable and policy | Existing order/WLT financial ownership. Cannot promise refund behavior without an approved order reversal, settlement and ledger contract. Not implemented. |
| `/admin/settings/stock` | Stock switches, threshold fields, alerts | DSH catalog offers and inventory APIs currently handle stock state. Partner stockout filters and Operator inventory already exist/in development; threshold policy requires canonical DSH validation/events, not client-only toggles. |
| `/admin/settings/seo` | Metadata, search keywords, pixels and Google analytics | Applicable only to authorized public store surfaces and privacy-consented analytics; not Partner administration pages. Not implemented. |
| `/admin/settings/print` | Invoice, packing, thermal and refund document template choices | Derived from immutable order/finance snapshots. Screen and generated document would need consistent canonical amounts and approved document policy. Not implemented. |
| Settings landing | Verification switches, WhatsApp orders, app center and redirect links | Avoid competitor's optional mobile-code bypass. Identity verification must fail safely. Backend functionality of app center/redirects remains UNVERIFIED. |

### Settings delivery slice on this branch

- Shared Partner mobile/web `/store?section=settings`: a DSH-authenticated **read-only** operational status/working-hours/preparation overview with explicit loading/error/retry and navigation to the existing versioned operations editor. Store identity/account scope is taken from the existing Partner authorized selector, not a caller-provided account.
- Mobile More and web desktop sidebar: a direct Settings destination for the owning Partner. Existing agreement, store profile images and availability editor remain canonical, with no duplicate writer.
- Operator `/partners` Store profile already owns authorized Store operational controls, identities and Partner/Finance links; this slice does not create a competing operator settings writer or navigation panel.
- Backend: **existing** DSH contract and authenticated partner availability endpoint reused; **no new backend migration or payment/notification/identity bypass**, no data mutations performed by settings readback.
- Follow-on capabilities above are proposals only, subject to the actual governed Product owner; they are not claimed as implemented.

## P00 — coverage register and sequential closure baseline (2026-11-01, branch `34`)

**Nature:** non-authoritative evidence index and bounded work status. It does **not** amend Product Governance, assert production readiness, or replace the canonical implementation/tests. Repository baseline checked at `1c44d0eabf78c37552118a11c637a81be483023b`: local `34` clean; `origin/34` same SHA; one worktree at `D:/samrim`. `AGENTS.md`, `REPOSITORY-STRUCTURE.md` and `docs/governance/README.md` read before this record.

**Freshness:** this record reindexes the dated read-only Elleen observations **already above**, not a new authenticated Elleen crawl. The currently connected browser-tab listing contained only BThwani/ChatGPT tabs, not an Elleen tab; therefore current-session re-observation of all Elleen details is `NOT_RUN`. Older route observations stay `OBSERVED (2026-11-01 prior session)`; unactioned controls stay `UNVERIFIED`. An HTTP 200 or a visible menu is not proof that any flow works.

### Stable screen identifiers — extend existing E01–E24 navigation IDs

| Screen IDs | Elleen paths already observed | Direct evidence class | Unproven activity |
| --- | --- | --- | --- |
| ES01–ES04 | `/admin/orders`, `/admin/orders/refunds/list`, `/admin/catalog/products`, `/admin/catalog/stock` | OBSERVED (dated read-only UI) | Submit order/refund; change price/stock; persistence; isolation |
| ES05–ES10 | `/admin/catalog/product-questions`, `/admin/catalog/filters`, `/admin/catalog/brands`, `/admin/catalog/attributes`, `/admin/catalog/product-sections`, `/admin/catalog/product-reviews` | OBSERVED (screen or heading, dated) | Creation/moderation and authorization |
| ES11–ES12 | `/admin/customers/wallets`, `/admin/customers/notifications` | OBSERVED (heading, dated) | Wallet integrity, broadcasts, recipient safety |
| ER01–ER08 | `/admin/reports`, `/admin/reports/sales`, `/admin/reports/orders`, `/admin/reports/products`, `/admin/reports/customers`, `/admin/reports/inventory`, `/admin/reports/coupons`, `/admin/reports/traffic` | OBSERVED (read-only report UI; detail in `elleen-reports-observations-2026-11-01.md`) | Accuracy, exports, data completeness |
| ES13–ES16 | `/admin/settings/shipping-carriers`, `/admin/settings/shipping-countries`, `/admin/settings/shipping-rules`, `/admin/settings/shipping-classes` | OBSERVED (heading, dated) | Carrier integrations, tariff application |
| ET01–ET11 | `/admin/settings/brand`, `/admin/settings/contact`, `/admin/settings/payment`, `/admin/settings/currency`, `/admin/settings/whatsapp`, `/admin/settings/in-app-notifications`, `/admin/settings/seasonal-decorations`, `/admin/settings/refund`, `/admin/settings/stock`, `/admin/settings/seo`, `/admin/settings/print` | OBSERVED (settings fields/read-only UI, dated) | Save/publish/provider integration; authorization, financial effect |
| ES17–ES22 | `/admin/verification`, `/admin/theme`, `/admin/onboarding`, `/admin/helpdesk`, `/admin/notifications`, `/admin/recycle-bin` | OBSERVED (heading/controls, dated) | Submission, paid features, mutations, recovery |
| ES23–ES26 | `/admin/import-export`, `/admin/activity-logs`, `/admin/plans`, `/admin/seo/dashboard` | OBSERVED (navigation; SEO redirects to plans) | Import safety, immutable audit, subscription unlocks; SEO is **not** a verified feature |
| EC01–EC02 | `https://rrda.elleen.ye/`, `/products` | OBSERVED (public storefront UI, dated) | Client checkout, product mutation reflection, auth, payment, performance |
| EP01–EP07 | Marketing PRO, BI PRO, add-on/app market PRO, service market PRO, delivery-representatives PRO, settlements PRO, employees PRO (E05/E07/E11/E12/E23/E24/E19) | INFERRED **only** from labels; no verified functional flow | All paid internals and entitlements |
| EP08 | AI assistant coming-soon (E17) | OBSERVED teaser, **not** an implemented feature | All behavior |

No new Elleen screen is asserted here. Other icons, dialogues, validation, loading/error states, mobile animation, data changes and cross-screen handoffs not recorded above remain `UNVERIFIED` / `NOT_RUN`; do not silently mark the census exhaustive.

### Cross-system gap/decision register (scope, dependencies and acceptance)

`SOURCE_PRESENT` below means only that a named implementation/contract was found on branch `34`; it does **not** mean E2E PASS. Priorities follow governed dependency and safety rather than similarity to Elleen. Each row's final closure state remains `OPEN` unless explicitly proven.

| Closure | Elleen reference and BThwani canonical owner | Current evidence / decision | Priority / next proof |
| --- | --- | --- | --- |
| P00 discovery | E01–E24, ES/ET/ER/EC, this evidence file, `docs/governance/product/{capabilities.md,journeys.md}` | PARTIAL. Retain dated observations, explicitly distinguish missing live navigation/flows. Do not create a second Product owner. | P0; revalidate reachable Elleen screens and any controls that could change P01 scope; matrix remains OPEN |
| P01 Store Commercial Agreement | ET03 and E24; WLT agreement, DSH Store context, Partner mobile/web, Operator Finance | SOURCE_PRESENT: WLT migrations `059`/`060`, storage/HTTP, DSH bridge, Partner accept and Operator Finance decision. Both model values have tests; subscription activation is deliberately blocked. **Improve existing implementation only when a specific uncovered case is proven.** | P0; Store A vs B authorization, exact acceptance, approval/version/idempotency, durable WLT readback and finance/security review; OPEN |
| P02 Store Type suggestion | E03/E09; DSH Store Type + WLT suggested commission policies | SOURCE_PRESENT: `commercial_store_type`, type-default UI/API. Verify **suggestion is not a binding agreement**; do not infer subscription default engine. | P1 after P01 boundary; owner/actor negotiation and non-activation proof; OPEN |
| P03 Identity/recovery | E19/ES17; Identity and authenticated actor surfaces | Governed capability present; no verified recovery or negative authorization journey in this census. | P0 security; distinct account and session-readback proof; OPEN |
| P04 Onboarding/publication | E01/ES19; DSH admissions, Operator and Partner | Governed Partner onboarding/publication owner exists; live role handoff not independently proven here. | P0; Partner consent → Finance → publication, failed cases; OPEN |
| P05 Store availability | ET01/ET02/ET09; DSH operational availability, Partner and Client | SOURCE_PRESENT as described in this benchmark's settings slice; client-facing effect not independently tested here. | P0; mode/schedule readback and unavailable checkout denial; OPEN |
| P06 Catalog/inventory | E03, ES03–ES10, ET09; DSH shared catalog and Store offers | SOURCE_PRESENT as described above; no claim of inventory reservation or product-question feature. | P0; mutation → persisted offer → Client, out-of-stock/concurrency; OPEN |
| P07 Discovery | EC01/EC02; DSH catalog/discovery and Client | Client screens/source described above; customer-safe visibility/filters not live verified. | P1; search, filtering, isolation, empty/error cases; OPEN |
| P08 Checkout/payment | EC01/EC02, ET03; DSH cart/order plus WLT collection | Existing admitted product scope; do not enable Elleen provider rails by label alone. | P0; COD/wallet/mixed, no duplicate payment/order, recovery; OPEN |
| P09 Order lifecycle | ES01/ES02; DSH lifecycle, Partner, Client | Governed owner exists; Elleen refunds navigation is not equivalent to a BThwani refund contract. | P0; roles, order status/adjustments and canonical readback; OPEN |
| P10 Captain dispatch | E23; DSH dispatch/handoff, Captain Android, WLT COD | Paid feature is INFERRED only; use BThwani authorized fulfillment contracts. | P0; offer race, proof, COD and retry; OPEN |
| P11 Partner Captain/pickup | E23, ES01; DSH Store Captain / Customer Pickup | Store-affiliated Captain is not a new Identity role; separate fulfillment semantics. | P1; membership/store isolation and mode-specific handoff; OPEN |
| P12 Subscription billing | E24 and ET03; WLT recurring invoice/ledger | **NOT IMPLEMENTED/NOT ACTIVATABLE as a financial agreement** by approved governance; no speculative billing or bypass. | P0 financial prerequisite; invoice-per-period uniqueness, retries, reconciliation, independent review; REVIEW_BLOCKED |
| P13 Balances/settlements/refunds | E24, ES02, ES11; WLT and DSH bounded exceptions | Historical read-only coverage only; cannot infer ledger from reports screens. | P0 finance; conservation, double-post avoidance, refunds and authorized readback; OPEN |
| P14 Exceptions/communications | ES02/ES20; DSH order exception and conversation | Existing governed bounded order conversation; no generic helpdesk implied by Elleen. | P1; participant ACL, retries, closure; OPEN |
| P15 Promotions/content | E05, EC01, EP01; DSH discovery and funded promotion via WLT | PRO internals INFERRED; current Product excludes loyalty as standalone system. | P1; publication/eligibility/discount funding, no IDOR; OPEN |
| P16 Reports/audit/export | E06/E20, ER01–ER08, ES24; DSH operational metrics and WLT monetary readback | See dated `elleen-reports-observations-2026-11-01.md`; do not mistake operational sales for settled net. | P1; server date window, store ACL, export/CSV formula safety; OPEN |
| P17 Partner mobile/web UX | E10/ET01–ET11; `apps/app-partner` shared workspace and design system | Existing settings readback described above; full parity/RTL/empty and failure handling not proven here. | P1; Android+Web real task, authorization, accessible/reduced-motion states; OPEN |
| P18 External integrations/backup | E08/E09/E16/ES13–ES16; existing integration owners | Provider labels do not constitute working integrations; no permission to deploy or modify external state. | P2 as admitted; owner-backed contract, safe restore and integration proof; OPEN |

**P01 decision gate:** start from WLT's existing `STORE_COMMERCIAL_AGREEMENT` capability, not an alternative billing implementation. `COMMISSION` may be activated after approved terms; `SUBSCRIPTION` may be proposed and accepted but **not** Finance-activated or charged until governed recurring billing, anti-duplication, reconciliation, and independent review exist. Historical `HYBRID` remains readable and retired. Partner workspace access does not depend on a paid feature subscription.

**P00 status: OPEN / partial evidence baseline committed when verified.** Current-session Elleen live reinspection and each working-control walkthrough are `NOT_RUN`; P01 cross-actor financial readback and independent finance/security review are `NOT_RUN`. The screen/flow ledger above is a bounded routing index for future section-level proof, not a claim that these sections are complete. Do not proceed to P02 as if P01 were closed.

### P00 live BThwani readback supplement — 2026-11-01

- Connected Edge tab `http://localhost:18101/home`: Client storefront renders a demo Store and available products (visible UI only, no cart or checkout action).
- Connected Edge tab `http://localhost:18102/more`: Partner workspace shows the same demo Store as published/open, but its onboarding checklist is `3/4` and the agreement item says **"تعذر التحقق من الاتفاقية"**. This is a reproduced *UI readback failure*, **not** proof that the Store lacks an approved WLT contract. Actual DSH/WLT response, actor scope, session validity, and canonical persistence are still **UNVERIFIED**. Do not suppress the warning or change finance state to make the checklist green.
- Source-only targeted regression: `node --test` on Partner agreement readiness and historical-commission tests: **10/10 PASS**; WLT `go test ./internal/storage/postgres -run ^TestNormalizeStoreCommercialModel$ -count=1`: **PASS**. These test results do not close the authenticated runtime failure, the finance boundary, or a cross-actor journey.
- **Disposition:** P01 remains OPEN; investigate the authenticated agreement GET and its canonical WLT readback, preserve the existing approved-activation gate, then test an authorized Store owner vs another Store/actor. This is evidence for prioritization, not a completed P01 implementation.

## P00 — authenticated Edge re-observation, Replica and REA evidence (2026-11-02, Yemen time)

**Source and authority:** the user's visible Elleen dashboard screenshot (2026-11-01 local browser capture supplied in this chat), the same authorized local Microsoft Edge CDP endpoint `http://127.0.0.1:9223`, the current source of `D:/samrim` on branch `34`, and the dated route observations above. This supplements — and supersedes the earlier `NOT_RUN` claim for **current dashboard/storefront tab presence only** — not the untested flows or every icon. No commercial or account mutation was performed.

### RPL-01 — Replica Recon (upstream instructions read from the authorized computer)

- **E01 / screen S01, Elleen operator dashboard:** current Edge target `EAF6344E48005A816E08F455800CAA60` at `https://elleen.ye/admin`, titled `لوحة التحكم - إيلين`. REA passive DOM read: 3,382 nodes. The user screenshot shows a right-hand RTL sidebar with orders, catalog, customers, marketing (PRO), reports, analytics (PRO), shipping, settings, theme, subscriptions, support, audit log and recycle bin; the workspace shows KPI cards, an onboarding checklist, notifications, low stock, latest orders and customers. The existence of UI is `OBSERVED`; actions, backend behavior and permission gates remain `UNVERIFIED`.
- **EC01 / screen S02, RRDA storefront:** current Edge target `6B1C8CCF2566A5A57EFF9A4CCA581BF0` at `https://rrda.elleen.ye/`. REA passive DOM read: 6,756 nodes. The public storefront structure and browsing controls remain historically documented above. No purchase, identity or checkout action.
- **Potential journey F01:** operator dashboard → settings → payment methods. Prior dated account browsing observed payment settings labels; this run only reconfirmed the authenticated dashboard target. **Current-session click count, save effects, and payment integration are `NOT_RUN`.**
- **Potential journey F02:** partner sees a Store-specific agreement → accepts exact terms → Finance approves → WLT state readback. This is a **BThwani-owned journey**, not an observed Elleen implementation; keep its model and acceptance safety with `STORE_COMMERCIAL_AGREEMENT` in WLT/DSH.

REA evidence: `list-browser-targets` ID `ev_e440a1adb191348a3a03b327e26c3a1b56077c94eb6d8693eed7aacfceee9a01`; `inspect-web-page` for Elleen ID `ev_b58df6a3dcce2ee8ff3c6b8212c476b4980eaaa420f34605a7882c12a2462a8e`; RRDA ID `ev_998a6bd99b0d094c1e4e19cee62a4149bc65f572cc3d8bb00008e01c12710e22`. These operations used exact-origin filters, read-only CDP and accessibility text; **no competitor JavaScript source, private API bodies, cookies or storage values** were collected. REA CLI `6.5.0` is available, but `doctor` in audit-wide mode is not healthy because binary decompilation engines and unrelated agent registrations are missing; the narrower passive browser operation itself succeeded.

**BrowserAct:** CLI `1.4.2` and `get-skills core --skill-version 2.0.2` succeeded; a read-only public-storefront `stealth-extract` attempt failed at browser IPC launch, so this does **not** count as a BrowserAct page inspection. Other attempts to drive/capture browser state through connected execution were denied by safety checks. No alternate channel was used to circumvent those denials. This is a real limit on a current full interaction census.

### RPL-02 — Replica Diff (original upstream `parity.py` run)

The `replica-diff/parity.py` standard-library tool ran successfully on a **temporary, intentionally scoped, 12-row feature matrix** derived from previously documented Elleen UI and BThwani source availability. The input was deleted after tool execution to avoid a second mutable comparison register. Result: **50.0/100 heuristic presence/parity score** across 9 comparable rows; all 7 `must` rows are `partial`, **zero verified complete**; paid feature tiers and generic marketplace are `skip` (not admitted equivalents); BThwani Store Commercial Agreements are `original=no, clone=skip` because competitor SaaS subscriptions are not the same business model.

**Interpretation constraint:** this 50/100 is **not** a verified BThwani completeness, production-readiness, release, or full-journey score. The scoring tool weights `partial` as one half; each `partial` here means source exists but material E2E behavior is not yet proven. The original tool reports `not shippable` because none of the 7 `must` items received a `yes` from the evidence provided; this is a conservative **proof gap**, not proof that those capabilities are entirely absent.

### P00/P01 decision and current limits

- **P00:** live Elleen dashboard and RRDA tab **PASS for presence/passive inspection only**. End-to-end account actions, per-icon navigation, mobile flows and paid internals remain **NOT_RUN / UNVERIFIED**. Sequential closure baseline exists, but P00 is **OPEN**, not fully closed.
- **P01:** current source confirms the same JSON tags across WLT `StoreCommercialAgreementRecord`, the DSH WLT integration model and the Partner `StoreCommercialAgreement` readback. The visible Partner message `تعذر التحقق من الاتفاقية` remains a **runtime symptom with no confirmed root cause**; it must not be fixed by inventing an agreement, weakening authorization, or changing WLT ledger state. A temporary Playwright runtime probe was created but execution was safety-blocked; the file was deleted and no result inferred. **P01 remains OPEN/REVIEW_BLOCKED for financially consequential activation**, with no claim of a successful runtime repair.
- **Next P01 proof boundary:** obtain permissible authenticated response status/error category for the DSH Partner GET → WLT readback (without secrets), evaluate account/store isolation, then address a proven causal owner and run negative/idempotent/finance proof before a separate implementation commit and Safe Push.

This log extends the single existing non-authoritative competitor reference rather than creating a second Product/contract/state owner. It preserves all prior verified evidence and documents what changed in confidence in this session.

### 2026-11-02 — P00 tool execution and owned Partner E2E proof (branch `34`)

This supplements the preceding dated record. It does **not** reclassify inaccessible Elleen functions as implemented, nor close P00/P01.

| Gate | Actual action and evidence | Status / limit |
| --- | --- | --- |
| RPL-01 | Read upstream `replica-recon/SKILL.md`; live BrowserAct `1.4.2` session `bthwani_p00_1102` opened the existing BThwani-local browser at `http://localhost:13000/workspace`, read `state`, clicked `إدارة الشركاء`, then `الشركاء والمتاجر`; confirmed `/partners?tab=directory`, search, filters, four rendered Store rows and separate Store ownership/profile actions. | PASS for this BThwani read-only navigation, **PARTIAL** for Elleen-wide recon |
| BrowserAct public Elleen | `stealth-extract https://rrda.elleen.ye/` was attempted but timed out without content. No automatic retries, imported credentials or profile/session copying. | BLOCKED for public storefront extraction using BrowserAct in this run |
| REA-01/02 | REA CLI `6.5.0` listed current local Edge CDP targets at `127.0.0.1:9223`; passive origin-restricted read of BThwani Operator workspace produced evidence `ev_114d106097dba62023bb0852d7c815d0788b8125e0662bb50a10d5c9dbfd0326`, Partner `/more` produced `ev_59517f2e6af0f02920812aff7443be52a157dc6628e37be75f6cdd3fe9602670`. Earlier Elleen admin and RRDA target observations in the previous section remain valid for page presence only. | PASS scoped CDP observation; REA audit-wide `doctor` environment was not healthy (binary engines/registrations unavailable). No third-party source/API inspection |
| Replica Diff | Upstream `replica-diff/parity.py` was executed on an evidence-constrained sample in the immediately preceding P00 record. No comparable-state screenshots or working competitor transaction-flow results were available for a valid new visual/behavioral equality score. | PARTIAL: feature-source comparison only, NOT full product parity |
| Playwright baseline | `node tests/partner-dashboard-structure.e2e.cjs` initially exited `2` with `blocked:true` because an overly broad `تعذر التحقق` phrase matched **agreement** readback rather than authentication. | Reproduced test-oracle defect; not evidence of user login loss |
| Playwright correction | Updated only four existing `apps/app-partner/tests/*e2e.cjs` files to recognize explicit session/login errors separately; retain the existing visible agreement-readback failure instead of calling it an authentication outage. | PASS on rerun: dashboard desktop/mobile, account navigation, account hub desktop/mobile, notifications desktop/mobile, read-only dashboard navigation. The dashboard log still reports `agreementUnavailable:true` |
| Safety | No Store agreement change, no WLT ledger write, no operator permissions change, no hidden test fixture, no Elleen form submission or subscription action. | P01 runtime cause `UNVERIFIED`; WLT Finance activation gate unchanged |

**Bounded finding:** rendered Partner dashboard and account navigation can be verified independently of an unrelated failure to confirm a Store agreement. The original test blocked this proof for the wrong reason. This correction changes only test classification; **the actual canonical agreement readback remains a separate unresolved P01 condition**. P00 overall `OPEN`, P01 `OPEN/REVIEW_BLOCKED` as applicable to Finance-sensitive activation.

### 2026-11-02 — P00 additional direct Playwright Elleen navigation (read-only)

A new bounded read-only Playwright examination used **the already-authorized Microsoft Edge CDP context**. No login, account export, network interception, local storage values, source files, payments, settings mutation, or form submission was performed.

| ID | Page / scope | Direct result | Limit |
| --- | --- | --- | --- |
| S01 | `https://elleen.ye/admin`, existing authenticated tab | `PASS`: title `لوحة التحكم - إيلين`; visible dashboard sections for onboarding, latest customers and orders, sales trend, attention, stock and bestselling products; visible navigation for dashboard, settings, theme, notifications, support, import/export, activity log and recycle bin | DOM/visible-label read only, not every dropdown or workflow |
| ET03 | `https://elleen.ye/admin/settings/payment`, new temporary tab sharing the authorized browser context and then closed | `PASS`: HTTP 200, exact title `إعدادات الدفع - إيلين`, headings `طرق الدفع`, `الدفع عند الاستلام (COD)`, bank transfer, Kuraimi, Jeeb, Mobile Money, Jawali, CashPay, Floosak, Easy Wallet, OneCash and `بوابات الدفع`; four visible `إعداد` buttons | No proof that a provider is connected, that any save succeeded, or that any billing rails are safe in BThwani |

The temporary Playwright scripts were removed after successful execution. These observations strengthen the existing E01/ET03 catalogue, **not** subscription/commission logic or financial equivalence. The BThwani `COMMISSION`/`SUBSCRIPTION` commercial contract remains WLT-owned and is not inferred from Elleen's merchant-facing checkout payment options.

**P00 remains OPEN:** a route/name census is not a per-control behavioral proof; paid PRO internals, mobile Android behavior, authenticated mutations and security/ledger handoffs remain UNVERIFIED or NOT_RUN. **P01 remains OPEN:** the observed Partner agreement warning has not been resolved by the Playwright test-oracle correction.

### P00 — deeper Replica Recon, REA-owned analysis and verified screen pairing (2026-11-02)

**Provenance and scope:** branch `34` began at `7c44de5a4b5149f7cd9164c58e1c73fa88a948fa` with a clean worktree and matching `origin/34`. Source of truth remains `AGENTS.md`, `REPOSITORY-STRUCTURE.md`, current code and `docs/governance/README.md`; this reference is **not** a Product or billing authority. Earlier observations in this file are historical, not silently refreshed.

**Replica Recon RPL-01, bounded map extension:**
- `S01=E01` Elleen operator `/admin`: observed RTL main navigation, dashboard metrics, latest customers/orders, launch checklist, low-stock and best-selling widgets. Key UI components: sidebar grouped disclosure/menu, KPI cards, onboarding tiles, attention list, short tables, PRO/coming-soon labels. DOM route and screenshot observations only; button effects and entitlement internals remain `UNVERIFIED`.
- `S02=ET03` Elleen `/admin/settings/payment`: read-only heading and provider list previously revalidated by Playwright. Components: provider cards and multiple `إعداد` controls; inputs/save/validation/permissions and actual payment processing `NOT_RUN`.
- `S03=EC01` public RRDA `/`: authenticated-Edge-independent public-storefront presence via REA, with historic product/navigation observations. Checkout/cart mutation and cross-site reflection `NOT_RUN`.
- `B01` BThwani operator `/workspace`: Browser/Playwright observed RTL task-first dashboard, priority counts, notifications and disclosures. `B02` finance `/finance`: BrowserAct navigated from workspace using one finance link click and opened `/finance?tab=pending` with another click. Observed seven Finance tabs, source-scoped metrics, pending decisions table, search, empty state and pagination; no transaction was submitted.
- Flow `F01` Elleen dashboard → payment settings: **screen presence observed**, exact click path/count and save result `NOT_RUN`. `F02` Elleen catalog → stock → customer storefront: headings observed historically; mutation and readback `NOT_RUN`. `F03` BThwani operator dashboard → Finance → Pending: **2 navigation clicks PASS** in BrowserAct; a dedicated real-session Playwright regression separately proved Finance → Pending, RTL, visible queue/search, no horizontal overflow, no page errors or observed same-origin finance 5xx. This does not prove WLT balances or settlements.
- Inferred *Elleen UI concepts*, **not database claims**: `Store` (store identity/launch UI), `CatalogItem` and `Stock` (catalog + low-stock headings), `Order` (order cards/statuses), `PaymentMethodConfiguration` (settings provider labels). Confidence `MEDIUM` for UI concepts, `UNKNOWN` for attributes, storage and relations. BThwani's actual Store, Order and WLT agreement ownership is established separately by its own code/contracts. No Elleen private implementation or artwork copied.

**Replica Diff RPL-02 (reproducible bounded dataset):**
- Authored the tool input `docs/reference/elleen-p00-replica-features.csv` in the prescribed `feature,area,priority,original,clone,notes` schema. It contains **45 evidence-cautious rows**: **38 counted**, 6 reference-only or not-admitted features skipped, plus one BThwani-specific agreement flow excluded from competitor parity. `partial` means source/screen presence without E2E equivalence; `yes` in `original` means only the *visible label or screen* was observed for its listed feature.
- Ran the **unmodified upstream** `replica-diff/parity.py`: **48.7/100 heuristic feature parity**, **0/11 must-haves verified complete** in this matrix; NOT a platform completeness, security, product acceptance or release score. The previous **50/100 from 12 provisional rows is superseded** for scope and sampling purposes by this 45-row matrix.
- Ran the **unmodified upstream** `replica-diff/imgdiff.py` in layout mode on direct Playwright dashboard screenshots. Elleen's browser zoom required physical viewport `911×600` to render CSS `1366×900`; BThwani used physical/CSS `1366×900`. Both independently confirmed CSS `1366×900`, RTL, HTTP 200 and no horizontal overflow. Raw layout similarity: **18.1/100**, `different`. **NOT admissible as an exact visual-parity gate**: sites intentionally use independent visual identities, datasets differ, and task-oriented BThwani dashboard is not a pixel clone. Raw screenshots/diff contain account-specific visuals, were kept only under a private local temporary folder, and must not be checked into this product repository.
- **Design decision:** do not adopt Elleen trade dress, paid SaaS plan logic or payment integrations from these numbers. Prefer BThwani's reduced-click actor task flow and canonical DSH/WLT controls.

**REA-02 owned technical analysis:** additionally ran `rea analyze-web-bundle` against the *BThwani-owned* Partner Web `http://localhost:18102/more` via origin-restricted Edge CDP. Evidence `ev_779965376f772ffdeb57b4fddb0566fd9ecd914c45a168985b63c440c852b8cc`: one development JS bundle analyzed (8,073,221 bytes), 420 `path`/`route`-like static values. These are **static candidate references**, **not** evidence that all routes are accessible, authorized, called or working. No source maps were fetched and **no competitor source bundles were analyzed**. Existing source/contract and runtime proof still outrank static route inventory. REA's broader audit-wide doctor remains nonhealthy for unrelated native decompilation engines; this targeted web analysis was successful.

**Test artifact:** `apps/control-panel/tests/finance-pending-navigation.e2e.cjs` is a reusable read-only Playwright proof on the actual Operator Edge session, with no mocks or financial writes. It passed on the existing local services. Finance data accuracy, account isolation, immutable WLT ledger and P01 Store agreement approval remain **NOT_RUN** by this test.

**Closure state:** `P00 = OPEN` (many per-icon dialogs, paid entitlements, mobile-device transitions and state-changing flows not observed); `P01 = OPEN/REVIEW_BLOCKED` for billing activation and the unresolved Store agreement warning. No accidental conclusion from the Replica score overrides those states.

### P00 — Playwright per-control read-only verification (2026-11-02)

This observation tightens `ET03` and `ES03` beyond headings/navigation without submitting a payment or catalog change:

| Screen / action | Observed interactive state | Explicitly unverified |
| --- | --- | --- |
| `ET03` payment methods → first `إعداد` | Four visible `إعداد` entry controls; the first opened a visible **COD dialog** with `تفعيل طريقة الدفع` checkbox, customer instruction/note textarea and `إلغاء` / `حفظ التغييرات` actions. No path change. | Toggle effect, existing value, save permission/validation, persisted provider state, charge settlement |
| `ES03` product list → `إضافة سريعة` | Six displayed products, status/count buttons, search, categories and brands controls. Quick-add revealed an **inline form** (not an ARIA dialog) with price, stock, `نشط` and `تتبع المخزون` fields/controls. | Field-level validation (absence of HTML `required` is not proof validation is missing), creation, stock mutation, image upload, Client projection |

**Source:** authenticated user's Edge session, temporary Playwright pages closed after capture; observed DOM and click effects only. No form values, secrets, customer records, source bundles or private API payloads collected.

**Private visual evidence digests:** matched CSS viewport `1366×900` (Elleen screenshot physically `911×600` because its existing browser zoom, normalized by Replica Diff; BThwani `1366×900`). Locally retained **outside Git** at `C:\Users\bassa\AppData\Local\Temp\bthwani-p00-20261102\`:
- `elleen-operator-1366x900.png`: SHA-256 `16d7f83fd9c4d0da4b303dc6138eed86b7967a49ba1cb5fbebdd25e2c02a40fe`
- `bthwani-operator-1366x900.png`: SHA-256 `0fdf5da99fb55787e3b837b4738208cdee57ae994fb41db33735e2f385fd1f7b`
- `operator-layout-diff.png`: SHA-256 `f36e9ff9b395ed6ac5eb805fcda7cc528f0b9a4d2afd2d0dc7e522e92e398877`

These screenshots contain owner-account context; do **not** publish, package, copy to source assets or infer financial correctness from them. The `18.1/100` visual score is a **nonbinding layout diagnostic** with unlike datasets, not a functionality or design-quality verdict.

The Replica CSV was updated with the newly observed COD/quick-add controls, but retains `partial` for both because save/readback was not exercised. `P00` remains **OPEN** for unverified controls and mobile/paid cases; `P01` remains **OPEN** for canonical agreement readback.

### P00 — Orders, sales and delivery-rule controls (2026-11-02, read-only)

Direct Playwright navigation in the user's existing authorized Elleen Edge account was bounded to three named routes and one deliberate non-submitting button action. No account/customer values, request bodies, downloadable exports or private provider code were captured:

| Screen ID | Current visible controls, OBSERVED | Unverified actions |
| --- | --- | --- |
| `ES01` `/admin/orders` | Empty-state `لم يتم العثور على طلبات`; create-order link, clear filters, total/pending/confirmed/shipped/delivered/cancelled/returned counters; order text search, payment and method selectors, from/to date inputs | Order creation, transitions, non-empty pagination, payment status and refunds |
| `ER02` `/admin/reports/sales` | Sales report; daily revenue, payment methods, revenue by category, peak times and daily breakdown headings; today/7/30/90-day/year/custom period controls, payment/category filters, **Excel export button** and date search | Calculations, financial reconciliation, correctness of Excel bytes, access boundaries |
| `ES15` `/admin/settings/shipping-rules` | Empty rules state, two add-rule controls; clicking one opened a visible add-rule dialog after asynchronous loading. Observed required rule name, priority, action type, basket total, weight, item count, coupon, included product categories, shipping classes, customer country/governorate/city, days of week; action/condition/settings panels and cancel/create controls | Any create/save, eligibility evaluation, conflicts/order effects, seller authorization, customer shipping promise |

**Product interpretation:** Elleen's conditional carrier/shipping rule builder is not a direct equivalent to BThwani's governed DSH distance/captain fulfillment and WLT settlement. Its appearance cannot authorize another generalized rule engine or bypass commercial pricing approval. The Replica feature matrix notes were updated with the observed fields; `partial` still represents unproven cross-product equivalence, not an adopted new requirement.

**Local owners:** Read-only `curl` checks of `/dsh/readiness`, `/wlt/readiness`, and Identity's `/identity/readiness` on the configured local ports each returned `HTTP 200`. This proves basic service readiness at that instant only. It does **not** prove the Partner agreement GET, WLT ledger correctness, persisted Store authorization, or completion of P01. No local service restart or database writes were performed.

### P01 — root cause and bounded historical readback repair (2026-11-02)

**Verified live cause (not inferred from a screenshot):**
- Partner Web `/more` issued an authenticated GET to DSH `/dsh/partner/stores/{storeId}/commercial-agreements`; returned HTTP 200 with one `ACTIVE` record. Only response shape and nonidentifying enum values were observed. `commercialModel` and `billingPeriod` were empty strings, while the new DSH Go response struct supplied all required property names. The previous client correctly rejected this as unrecognised terms and displayed a warning.
- The **running** Docker WLT image `samrim-local-wlt:dev` advertised revision `27e4140dc3048e1acae9b0f6edd92dd1656b747e` (2026-10-30). `git show` proves that revision predates the WLT commercial-model fields and migration `059`. The image includes migrations `001`–`058` only. Executing its official **read-only** `/schema-verify` gave `WLT_SCHEMA_VERIFY=PASS schema v58`; the branch-`34` source requires schema `v60` (migrations `059` and `060`). DSH itself returned the old WLT records through the newer typed bridge; the observed empty JSON fields were therefore a *runtime-version gap*, not evidence of login loss.
- WLT/DSH/Identity readiness HTTP 200 **did not** imply agreement-contract compatibility. No container restart, migration, SQL mutation, credential reset, balance edit or financial approval was attempted.

**Source repair with narrow scope:** `apps/app-partner/src/features/partner-onboarding/store-commercial-agreement-legacy.ts` now recognizes both old WLT **missing** commercial fields and the exact **all-zero / all-empty fields** produced by the DSH bridge, but **only for final historic statuses**, nonempty rate arrays, and without overwriting or mutating any source readback. It projects those records for *read-only historical COMMISSION presentation*; no new proposal, Partner acceptance, invoice, subscription activation or Order settlement is authorized. Mixed/partial billing fields, explicit models, `PROPOSED` and `PARTNER_ACCEPTED` remain unprojectable. This does not change any WLT/DSH contract.

**Proof:** red test reproduced the bug (`'' !== 'COMMISSION'`); after the patch `12/12` targeted unit tests PASS including cross-Store safety and subscription nonactivation; Partner TypeScript `typecheck` PASS; dedicated actual authenticated Edge Playwright GET/readback in `apps/app-partner/tests/partner-commercial-readback-safety.e2e.cjs` PASS on desktop **and** `390×844` mobile web, matching the Store scope without printing IDs or financial values. The UI changed from generic agreement verification warning to `الاتفاقية سارية` on the historical active agreement; no data was changed to force success. The browser-loaded Metro bundle was independently checked as the updated owned app bundle, not the stale previously open tab.

**Remaining gate:** the real WLT runtime/database is **still v58** and does not implement source-`v60` subscription terms. Aligning `samrim-local-wlt` with source and applying migrations `059/060` to the existing local finance database requires preserved-state impact proof, isolated upgrade/restore verification and independent finance/security review before migration or restart. **`P01 runtime upgrade = REVIEW_BLOCKED`; entire P01 closure = OPEN**, even though *historical Partner display* now passes. These are distinct assertions. `P00` remains OPEN for other reference flows, paid features and native-device checks.

### 2026-11-02 — P00/P01 physical Android and catalog-flow proof

**Android hardware (P01):** REA v6.5 and ADB observed one authorized Samsung Android physical device (1080×2340, density 450), with `com.bthwani.partner` installed as version `0.3.1`. The already-running Metro server was confirmed at `127.0.0.1:18102/status` and its existing `adb reverse tcp:18102` mapping was reused; no app build, reinstall, Metro restart, credential change or persistent API configuration was needed. The existing `exp+app-partner` dev-client URI launched the installed app.

- Native screenshot before connecting showed the Expo Dev Launcher; its presence alone did **not** prove the app loaded.
- After the existing Metro link was opened, REA captured the actual native Partner More/Home screen. An ordinary account shortcut click reached **`حسابي · خدمات المتجر`** where the Store's commercial agreement read **`الاتفاقية سارية`**. Another click opened Store settings and a single scroll reached the **`الاتفاقية التجارية`** section: `سارية`, model `عمولة`, explicitly described as an old commission agreement for documentation/follow-up only. This is native UI readback proof after the bounded historical WLT-v58 display fix, *not* a native business-state mutation or independent WLT-ledger proof.
- No acceptance/approval/payments were submitted, and no financial account facts changed. The screen did not expose an acceptance control in the observed state. Native proof does **not** certify all Android screens, animation, offline cases, store-owner isolation or the v60 schema migration.
- REA private screenshot evidence (never checked into Git or shared, because the account page may include identifying fields): initial launcher `ev_8eaca5ddcba2496fb81045f47245d07767f93793fab1a45ed7d5b98f23d01b2b`; home `ev_1f4c222d09aa015492cefc57eb8e5a375b1cfdb8906afe9d1efa6d9a1c5d0576`; account `ev_0288037a7eb4fb2b21a25827dba2c285ebf424dc738d1561d857f7a917615f8`; Store agreement `ev_5f4e7d9f30d0bd2d59a50b8d0cfa624b4c4ebafceca59ab04404a8f8c57b4414`. The screenshot PNGs remain in private host temporary folders. No Android app data was reset.
- REA package-name lookup for `elleen` found no matching package substring. This **does not prove** that a differently named Elleen app is absent, and **no original Elleen Android UI was tested** in this sequence.

**Replica Recon/BrowserAct P00 catalog pairing (bounded UI, no data mutation):**
- `ES03`, Elleen `/admin/catalog/products`: earlier exact read-only Playwright observation found product listing, six product rows and an inline **`إضافة سريعة`** form with price, stock, `نشط` and stock-tracking controls. Save effect and customer reflection remain unverified.
- `BC03`, BThwani `http://localhost:13000/catalog?catalogView=products`: BrowserAct isolated authorized operator session clicked **الكتالوج → المنتجات → منتج جديد** and observed the create drawer, canonical product name, shared commercial vertical, category search, description, optional brand and image. Unlike Elleen's store-specific quick-add, BThwani's central catalog is distinct from Store offers and their price/availability data; this is an intentional architectural separation, not proof of a missing product-price input in the central record.
- Click count in BThwani from workspace to central product create: **3** (catalog, products tab, new product). No product was created, no category or price was changed. BrowserAct session closed after inspection.
- Durable read-only Playwright regression `apps/control-panel/tests/catalog-create-readonly.e2e.cjs` visited the authenticated operator product tab, clicked New, verified URL `mode=create`, canonical form fields, RTL, no document overflow, closed details and verified exit from create mode. **PASS at 1366px and 390px**, with no observed page error or same-origin 5xx. This is a *navigation/form-presence test*, not the full create/save/readback journey.

**Next gates:** preserve distinct master-catalog and store-offer owners; future P06 proof must exercise authorized actual Store offer edit → DSH persistence → Client readback, including missing/out-of-stock and wrong-Store refusal. **P00 OPEN. P01 financial-runtime upgrade REVIEW_BLOCKED** pending independently reviewed v58→v60 preservation/restore evidence. The prior historical-commission UI repair stays PASS for the specifically tested Partner account and its native device; no unrestricted release certification.

### P00 — EC01/EC02 Client discovery + RRDA UI pairing, 2026-11-02

**Reference observation (Elleen public RRDA):** Playwright opened `https://rrda.elleen.ye/` in the owner's already-connected Edge context and read only the visible control tree. Observed Arabic RTL, separate search and category controls, product category links, storefront banners/slider and shopping navigation. This confirms UI affordances, **not** its search result ranking, customer account or checkout semantics; no cart, login, paid feature or transaction was touched.

**BThwani Client actual readback:** The existing `http://localhost:18101/home` Edge context loaded publicly visible Store offers. Search requires the proper sequence **focus search → choose المنتجات → enter term**; an earlier probe that entered the term *before the header switched* gave an empty-search UI and is **INVALIDATED AS A BUG REPRODUCTION**. Repeating the proper user path produced one concrete matching product from a local published Store, with an offer price and available state rendered; neither IDs nor amounts were retained in the durable artifact. Clicking a visible Store reached its `/store/{...}` route and displayed real catalogue offers; no cart/favorite/checkout mutation. This is DSH-backed frontend readback, not proof of an Order or stock reservation.

**Existing scenario reused:** `node apps/app-client/tests/client-discovery-browser.manual.mjs` completed `outcome: PASS` in a **fresh guest context** with:
- positive product search, product/store no-match cases;
- offline product-search error and retry recovery;
- zero document horizontal overflow at widths `320`, `390`, `768`, `1280`;
- guest add-to-cart and favorite authorization redirects (no business mutation);
- account view and six protected route redirects.
Its `guestStoreDetail` flag is **false**, not a passed guest Store-detail proof; do not silently count it.

**Additional distinct proof:** `apps/app-client/tests/client-store-search-readonly.e2e.cjs` uses the **authorized local Client Edge context**, selects an observed Home offer by its accessible label, searches that exact product, verifies visible results, then navigates to a Store's public detail and sees Store-offer projections. It also proves RTL and no document overflow at widths `390` and `1366` without modifying data. Output: `CLIENT_PRODUCT_SEARCH=PASS_CURRENT_STORE_OFFER` and `CLIENT_STORE_PROJECTION=PASS_READONLY_RESPONSIVE`. This proves a different runtime state than the existing isolated guest test and does not replace it.

**Product distinction:** Elleen's e-commerce category/search presentation is a reference UX pattern; BThwani's city-scoped stores and DSH Store offers are a different contract. Do not infer approval for external payment providers, price copying, global inventory or cart mutations from screenshot parity. Replica Diff `EC01`/`EC02` rows remain `partial`: reference behavioral result parity, IDOR, offer mutation → Client projection, checkout and error recovery across actors are not all proven. P00 remains OPEN.

### 2026-11-02 — P00 catalog/stock comparison and protected deep-link repair

**Scope:** a read-only Elleen inventory comparison and the corresponding authorized Partner product-filter journey. This is operational evidence only; it does not amend the DSH catalog Product contract or WLT finances.

**Elleen reference (ES04):** the user's authenticated Edge session displayed `/admin/catalog/stock` with a `إدارة المخزون` heading, product-count/low-stock/unavailable summary cards, product-name search and variant controls. The screen was only read; no inventory, pricing, publication or stock threshold was changed. Numeric counts were account-local and are not copied as BThwani requirements.

**BThwani: bounded causal defect and repair (P17 UX / P06 navigation):**
- The existing Partner `/products?filter=stockout` link worked after sidebar navigation, and `/products?filter=unavailable` selected the right filter. **New Playwright cold direct entry reproduced a regression**: an authorized user entering `/products?filter=stockout` in a fresh tab was redirected to `/more`, losing the requested screen and filter. The new assertion was **FAIL before repair**, with actual `/more`.
- Owner: `apps/app-partner/app/(app)/(tabs)/_layout.tsx`. The temporary `RESOLVING_PARTNER_AUTHORITY` hid protected `Tabs.Screen` links using `href: null` before Store access was resolved; Expo Router discarded an authorized cold deep link. The security gate in `PartnerSurfaceGate` already independently prevents rendering protected content during loading/error and redirects on confirmed permission denial.
- Minimal fix: set `href: null` for Orders, Products and Wallet **only when Store authority is ready and explicitly denies** that surface. During pending/error, keep routes addressable while the existing surface gate blocks unauthorized content. No direct permission check, backend API, store-scoped request, write operation or financial field was loosened.
- Durable regression: extended `apps/app-partner/tests/partner-catalog-navigation.e2e.cjs`. **PASS** for authorized cold `/products?filter=stockout` at desktop `1360` and mobile-web `390`, for direct `/orders` and `/wallet`, and for the existing sidebar stockout/unavailable filtering and RTL/no horizontal overflow. In a separate empty browser context, guest `/products?filter=stockout` **PASS fail-closed**: redirected to login with no Store offers. This tests actual logged-in and guest paths; it does not substitute for independent two-Store employee IDOR testing.
- Independent BrowserAct `1.4.2` private local browser confirmed guest `/products?filter=stockout` → `/?returnTo=%2Fproducts` (login form, no catalog). **Known separate gap:** the login return URL drops the `filter=stockout` query; this is not fixed here because it belongs to the authenticated return-path owner and requires its own safe URL/authorization proof. The authorized cold link itself now preserves the filter.
- Android device: REA `6.5.0` `start-adb-activity` sent `exp+app-partner:///products?filter=stockout` to the existing installed development build on the connected Android device; the Product screen rendered, then a reversible filter sheet showed **`نفاد المخزون` selected**. Screenshots are kept privately outside Git. REA evidence IDs: direct-view `ev_426cc45898d13bac0c1f37da638b80562fceb18e3a5b54d16b882e7ac72a1a6b`; filter-sheet `ev_8016e071b66c6fe851f0b509943ee07b883a4cae5c1485d0e02c9c1a17611bf2`. No Android reinstall, app-data reset or product mutation occurred.
- Affected proof: Partner TypeScript typecheck PASS; authority/tab-route unit tests **3/3 PASS**; Partner dashboard and agreement readback Playwright **PASS**. The historical WLT v58/v60 upgrade and financial approval remain unchanged and `REVIEW_BLOCKED`.

**Limits:** the UI tests prove navigation, authorization redirects and the selected filter, **not** Stock decrement/restoration, cross-Store isolation, inventory reservation under concurrency or persisted Offer mutation → Client catalog reflection. Replica Diff inventory row remains `partial`, and `P00` remains **OPEN**. No Elleen paid features or private code were examined.

### 2026-11-02 — P00/P17 protected Product-filter login return (branch 34)

**Bounded bug, owner and failing proof.** After the earlier Partner deep-link fix, opening `/products?filter=stockout` from a fresh guest context correctly denied Store access but redirected to `/?returnTo=%2Fproducts`, silently dropping the user's stockout filter. `apps/app-partner/app/(app)/_layout.tsx` used `usePathname()` only; the Partner login route's exact-path admission pattern also rejected query-bearing return values. A new Playwright assertion in the existing `partner-catalog-navigation.e2e.cjs` **FAILED before the repair** with expected `/products?filter=stockout`, actual `/products`.

**Small, Partner-owned correction.** The existing root auth boundary now passes a strict `useGlobalSearchParams` `filter` only for `/products` through `partnerReturnPath`. The Partner login gate uses the same route admission policy `partnerReturnPathPattern`. The policy is stored in `apps/app-partner/src/features/access/partner-return-path.ts` so extraction and admission use **one** admitted list: `all`, `popular`, `offers`, `published`, `unavailable`, `hidden`, `stockout`, consistent with the current Store-offer view. No arbitrary query, external URL, multiple-valued filter, fragment or extra parameter is carried forward. Other Partner surfaces retain their existing paths. The shared Identity `resolveInternalReturnPath` owner and all services are unchanged. Access remains enforced by the existing authenticated boundary and `PartnerSurfaceGate`.

**Actual evidence:**
- Existing Partner Edge Playwright regression (same real local actor) **PASS** for authorized direct product and filter navigation, Orders/Wallet deep links, mobile-web `390px`, RTL/no overflow, and isolated guest redirect. A new assertion proves guest redirect retains exactly `/products?filter=stockout`. Read-only authenticated return via `/?returnTo=...` returns to the filtered Product page; malicious `//example.com/unsafe` and `/products?filter=stockout&redirect=//example.com` fall back to `/orders`, with no external navigation.
- Three strict unit tests in `partner-return-path.test.mjs`: all seven supported product filters; other internal paths ignoring filters; rejection of unknown, multivalued, encoded, external, traversal and extra-parameter patterns.
- BrowserAct isolated private guest session `p00_returnto_1102` independently opened the filter URL and observed `http://localhost:18102/?returnTo=%2Fproducts%3Ffilter%3Dstockout` with only the login form; session was closed. REA passive Partner Edge inspection `ev_59221ef875f0c5d69c039343c02275fc633f3298387e8d9799b17a167b99f659` confirmed the local Partner browser target, not protected account contents.
- No test account was created, login was performed, business data was mutated, source authentication ACL was relaxed, Store offer was changed, Metro/service was restarted or external domain was visited. A prior historical WLT v58 upgrade remains **REVIEW_BLOCKED**.

**Scope outcome:** Guest-to-login filter loss **repaired and exercised**, including unsafe return URL rejection. The full registration/login lifecycle after entering credentials was **NOT_RUN**; actual authenticated redirect was proved using the existing authorized session without re-entering credentials. This is P17 UX/security progress inside the broader P00 benchmark; **P00 remains OPEN** and full Elleen parity is not claimed.
