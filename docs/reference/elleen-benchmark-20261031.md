# Elleen visual benchmark for BThwani — 2026-10-31

ARTIFACT_CLASS: NONAUTHORITATIVE_EXTERNAL_REFERENCE
ADOPTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
REFERENCE_FRESHNESS: REVALIDATE_AT_USE

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
| E02 | الطلبات | Sidebar only; inner routes NOT_RUN |
| E03 | الكتالوج | Sidebar only; inner routes NOT_RUN |
| E04 | العملاء | Sidebar only; inner routes NOT_RUN |
| E05 | التسويق (PRO) | Sidebar only; locked flow NOT_RUN |
| E06 | التقارير | Sidebar only; inner routes NOT_RUN |
| E07 | التحليلات الذكية (BI) (PRO) | Sidebar only; internal logic UNKNOWN |
| E08 | الشحن | Sidebar only; inner routes NOT_RUN |
| E09 | الإعدادات | Payment settings OBSERVED; other subpages NOT_RUN |
| E10 | تخصيص الثيم | Sidebar only; inner routes NOT_RUN |
| E11 | سوق الإضافات والتطبيقات (PRO) | Sidebar only; inner routes NOT_RUN |
| E12 | متجر الخدمات (PRO) | Sidebar only; inner routes NOT_RUN |
| E13 | حسابي | Sidebar only; inner routes NOT_RUN |
| E14 | الإشعارات | Sidebar only; inner routes NOT_RUN |
| E15 | دعم المتجر / الدعم الفني (PRO) | Sidebar only; inner routes NOT_RUN |
| E16 | واتساب (PRO) | Sidebar only; integration NOT_RUN |
| E17 | مساعد الذكاء الاصطناعي (قريبًا) | Teaser only; NOT an observed working capability |
| E18 | الاستيراد والتصدير | Sidebar only; action NOT_RUN |
| E19 | الموظفون (PRO) | Sidebar only; role behavior NOT_RUN |
| E20 | سجل النشاطات | Sidebar only; inner routes NOT_RUN |
| E21 | سلة المحذوفات | Sidebar only; inner routes NOT_RUN |
| E22 | نسخ رابط المتجر | Sidebar action visible; action NOT_RUN |

Other visible dashboard controls: search, theme, language, user menu, store toggle, about-store link, on-boarding/checklist and stock/attention cards; these are not individually validated. A PRO badge or label is evidence of marketing/navigation, not proof of paid internal behavior.

## RRDA public storefront — screenshot-observed

Visible: brand/header, search, primary categories, homepage/shop/about/contact navigation, cart, notifications, account, favorites, locale, hero carousel (arrows/pause/action), category browsing, floating help/chat. Product detail, authenticated cart, payments, checkout, order submission, responsive behavior and negative/error states are NOT_RUN.

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

This reference is evidence only; it cannot activate Product capabilities. No external billing change is authorized by merely observing payment labels. Any subscription implementation must define Store-specific accepted versioned terms, period, invoice/retry/reversal/renewal, payment/settlement accounting, service authorization and independent finance review before release. The new branch's current delivered UI slice reads an existing agreement; it does not create subscription charges or change a real ledger.
