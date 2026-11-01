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
