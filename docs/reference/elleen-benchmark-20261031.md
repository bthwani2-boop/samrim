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
