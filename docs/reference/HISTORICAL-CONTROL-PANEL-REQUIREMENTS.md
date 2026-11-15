# BThwani — Historical Control Panel requirements evidence index

ARTIFACT_CLASS: NON_AUTHORITATIVE_SOURCE_INVENTORY
BUSINESS_POLICY_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
STATUS: HISTORICAL_RECONCILIATION_PENDING
SOURCE: Control Panel Master Pack 2026-10-12, 03_REQUIREMENTS_AND_PROOFS/REQUIREMENTS.csv
SOURCE_EXECUTION_STATE: UNVERIFIED_ON_HEAD_16
EVIDENCE_LEVEL: SOURCE_PRESENT_ONLY

## Meaning of this index

The relocated consolidated BThwani archive includes an October 2026 Control Panel Master Pack with the exact **112 source requirement IDs** listed below. This is a **temporary, non-governing ID/provenance index**, not 112 features to implement and not 112 defects. Original source owners and wording are preserved here for traceability only. No original item supplies actual runtime proof at candidate branch `refoundation/clean-house-20261112`; every source row has `UNVERIFIED_ON_HEAD_16` and no proof pointer.

The **only canonical decisions** are the reviewed owners under root `governance/`. Product capability admission remains the single list in `governance/product.md`; this index must never become a parallel Product, analytics, screen or security policy catalog. A suggested review destination is **routing, not adoption**. Potentially stale names, past PR references or obsolete roles may be retained as source strings but are not current architecture.

### Source-group census
- `LEGACY_BASE`: 72
- `QA`: 6
- `UX`: 6
- `FINANCE`: 3
- `CANDIDATE`: 3
- `CURRENT_GIT`: 2
- `SECURITY`: 2
- `OPERATIONS`: 2
- `REFACTOR`: 2
- `SOURCE`: 2
- `DATA`: 2
- `MEDIA`: 1
- `SERVICE`: 1
- `PERFORMANCE`: 1
- `ACCESSIBILITY`: 1
- `PRODUCT`: 1
- `SEARCH`: 1
- `NOTIFICATIONS`: 1
- `QUALITY`: 1
- `EXECUTION`: 1
- `ACCESS`: 1

## Exact source row trace

| Source ID | Old group | Old requirement wording (unapproved) | Historical claimed owner | Suggested review lane |
| --- | --- | --- | --- | --- |
| R001 | LEGACY_BASE | جميع مسارات Control Panel والأدوار والحالات محصورة | route registry + Identity | Legacy cross-owner review |
| R002 | LEGACY_BASE | حماية worktree المتسخ والبيانات والعمل المتوازي | Git | Legacy cross-owner review |
| R003 | LEGACY_BASE | الحفاظ على التصميم المشترك ومالك CSS واحد | DS/globals.css | Legacy cross-owner review |
| R004 | LEGACY_BASE | إزالة تشظي التنقل دون صفحات عملاقة | registry/routes | Legacy cross-owner review |
| R005 | LEGACY_BASE | إزالة الصفحات/التبويبات المكررة بعد consumer cutover | routes/features | Legacy cross-owner review |
| R006 | LEGACY_BASE | حذف/دمج/نقل/تقسيم الملفات في المسؤولية الصحيحة | code owners | Legacy cross-owner review |
| R007 | LEGACY_BASE | أزرار وحقول بعروض مناسبة وليست ممتدة افتراضيًا | UI | Legacy cross-owner review |
| R008 | LEGACY_BASE | RTL والخطوط والأرقام والتواريخ والعملة | UI/domain formats | Legacy cross-owner review |
| R009 | LEGACY_BASE | light/dark + accessible keyboard/touch/focus/motion | design | Legacy cross-owner review |
| R010 | LEGACY_BASE | شريط جانبي سياقي لا يكرر القائمة في المحتوى | registry/shell | Legacy cross-owner review |
| R011 | LEGACY_BASE | sidebar collapse and saved width if useful | shell | Legacy cross-owner review |
| R012 | LEGACY_BASE | favorites/recent navigation, not default clutter | shell | Legacy cross-owner review |
| R013 | LEGACY_BASE | سياق search/filter/page/back محفوظ وفق الخصوصية | feature state | Legacy cross-owner review |
| R014 | LEGACY_BASE | سيرفر يملك البحث والفرز والترقيم للمجموعات الكبيرة | Go/API | Legacy cross-owner review |
| R015 | LEGACY_BASE | لا global count مشتق من page sample | service aggregate | Legacy cross-owner review |
| R016 | LEGACY_BASE | context KPI only where useful, accurate/drilldown | owner count+registry | Legacy cross-owner review |
| R017 | LEGACY_BASE | home actionable queues with actor permission | feature/API | Legacy cross-owner review |
| R018 | LEGACY_BASE | معايير التحميل/الفراغ/الخطأ/إعادة المحاولة صحيحة | features | Legacy cross-owner review |
| R019 | LEGACY_BASE | actions according to authorized state | domain/Identity | Legacy cross-owner review |
| R020 | LEGACY_BASE | عدم فقدان إدخال بسبب فشل وعدم overwrite صامت | form/domain | Legacy cross-owner review |
| R021 | LEGACY_BASE | quick inspector with full route for complex tasks | feature/shell | Legacy cross-owner review |
| R022 | LEGACY_BASE | product default table with thumbnails retained | catalog | Legacy cross-owner review |
| R023 | LEGACY_BASE | optional gallery/zoom same canonical query | catalog media | Legacy cross-owner review |
| R024 | LEGACY_BASE | image side-by-side comparison when helpful | media | Legacy cross-owner review |
| R025 | LEGACY_BASE | source/rights/provenance preserved for media | DSH/media | Legacy cross-owner review |
| R026 | LEGACY_BASE | partner onboarding to actual customer-visible store | joining/DSH/Identity/client | Legacy cross-owner review |
| R027 | LEGACY_BASE | HR request to Identity access, role-safe | HR+Identity | Legacy cross-owner review |
| R028 | LEGACY_BASE | financial settlements and reconciliation WLT-authoritative | WLT | Legacy cross-owner review |
| R029 | LEGACY_BASE | store access vs store publication roles clear | Identity/DSH | Legacy cross-owner review |
| R030 | LEGACY_BASE | operations order state lifecycle/exception-safe | DSH | Legacy cross-owner review |
| R031 | LEGACY_BASE | captains and field next tasks/owner states | DSH/Identity | Legacy cross-owner review |
| R032 | LEGACY_BASE | policies scope/effective time and accurate impact | owner API | Legacy cross-owner review |
| R033 | LEGACY_BASE | marketing publish preview uses real source | marketing/client | Legacy cross-owner review |
| R034 | LEGACY_BASE | unified command palette / global search | API owners | Legacy cross-owner review |
| R035 | LEGACY_BASE | filter chips/saved views/column prefs only if useful | features | Legacy cross-owner review |
| R036 | LEGACY_BASE | safe bulk actions only in approved owner workflow | API | Legacy cross-owner review |
| R037 | LEGACY_BASE | operational exceptions and SLA only if defined | owner aggregates | Legacy cross-owner review |
| R038 | LEGACY_BASE | analytics time/denominator/currency/source accuracy | owner metrics | Legacy cross-owner review |
| R039 | LEGACY_BASE | deep analytics and cohort funnels with actual history | events/metrics | Legacy cross-owner review |
| R040 | LEGACY_BASE | live updates/AI only on approved benefit | APIs | Legacy cross-owner review |
| R041 | LEGACY_BASE | preserve data, no unsafe SQL or reset, no fake seeded production state | all services | Legacy cross-owner review |
| R042 | LEGACY_BASE | deliberate URL privacy for identity/phone data | Identity/CP | Legacy cross-owner review |
| R043 | LEGACY_BASE | finish positive/negative/recovery and persisted readback | journey owners | Legacy cross-owner review |
| R044 | LEGACY_BASE | retain valid tests, no auto snapshot acceptance | CI/test owners | Legacy cross-owner review |
| R045 | LEGACY_BASE | no duplicated code/system after safe cutover | whole affected cone | Legacy cross-owner review |
| R046 | LEGACY_BASE | maintain compatibility for adopted migrations and deep links | route/DB owners | Legacy cross-owner review |
| R047 | LEGACY_BASE | no invention of product features, new financial rule or approval | Product governance | Legacy cross-owner review |
| R048 | LEGACY_BASE | no merge/deploy/force push; safe upstream only | Git | Legacy cross-owner review |
| R049 | LEGACY_BASE | target vs current branch HR/IA divergence reconcile explicitly | Git+HR | Legacy cross-owner review |
| R050 | LEGACY_BASE | Graphify presence and usage before update | tool owner | Legacy cross-owner review |
| R051 | LEGACY_BASE | meaningful user effort measurement, no magic performance thresholds | UX | Legacy cross-owner review |
| R052 | LEGACY_BASE | report material FAIL/UNPROVEN rather than 100% | closure | Legacy cross-owner review |
| R053 | LEGACY_BASE | no privacy leakage in exports, thumbnails or global search | services | Legacy cross-owner review |
| R054 | LEGACY_BASE | customer support/disputes/refunds if actually approved | Product/DSH/WLT | Legacy cross-owner review |
| R055 | LEGACY_BASE | notification unread counts global owner, bounded inbox | DSH | Legacy cross-owner review |
| R056 | LEGACY_BASE | classify duplicate routes vs legitimate resource split by task | IA/owners | Legacy cross-owner review |
| R057 | LEGACY_BASE | no obsolete browser shim / JS framework introduced for design | frontend | Legacy cross-owner review |
| R058 | LEGACY_BASE | canonical readback across Client/Partner/Captain/Field when materially affected | all surfaces | Legacy cross-owner review |
| R059 | LEGACY_BASE | representative load tests isolated and bounded, not bloated dev seeds | test/runtime | Legacy cross-owner review |
| R060 | LEGACY_BASE | safe fail-fast on data-loss / unauthorized consequences | executor | Legacy cross-owner review |
| R061 | LEGACY_BASE | إضافة المعرض المرئي مع بقاء جدول المنتجات default دون ازدواجية state | catalog/media | Legacy cross-owner review |
| R062 | LEGACY_BASE | تطبيق context KPI فقط على صفحات مستفيدة وبصفر حقيقي مقابل unknown | aggregates | Legacy cross-owner review |
| R063 | LEGACY_BASE | توازن التشظي والضغط الزائد/تمييز tab وfilter وresource | IA | Legacy cross-owner review |
| R064 | LEGACY_BASE | المصالحة مع HR/الكتالوج في أحدث الفروع قبل refoundation القديمة | Git/owners | Legacy cross-owner review |
| R065 | LEGACY_BASE | منع فقدان مستندات/مكونات وملفات عند نقل المسؤوليات | code owners | Legacy cross-owner review |
| R066 | LEGACY_BASE | حماية الصور المملوكة والحقوق والـ lightbox من تسريب الوصول | media/DSH | Legacy cross-owner review |
| R067 | LEGACY_BASE | التحقق من مشكلات لوحة المفاتيح والـ focus والـ sticky overlays | UI/a11y | Legacy cross-owner review |
| R068 | LEGACY_BASE | إقرار نطاق التغيير والمستفيد والنتائج الجزئية في bulk actions عند انطباقها | API | Legacy cross-owner review |
| R069 | LEGACY_BASE | URL filters تحترم خصوصية الهاتف/الهوية ولا تكشف بيانات حساسة | UX/Identity | Legacy cross-owner review |
| R070 | LEGACY_BASE | التحقق من تراخيص الصور/تعريف التحليلات وسلاسل الحالات قبل ادعاءات نجاح | domains | Legacy cross-owner review |
| R071 | LEGACY_BASE | تحديث Git worktree/HEAD حقيقة آنية عند التنفيذ ولا نقل صامت من branch14 | Git | Legacy cross-owner review |
| R072 | LEGACY_BASE | ZIP manifest قابل لإعادة التحقق باستخدام normalised paths وSHA256 | package | Legacy cross-owner review |
| R073 | CURRENT_GIT | إعادة مقارنة الفرع 16 مع main والـHEAD قبل أول كتابة؛ عدم تنفيذ الأوامر القديمة للفرع المُدمج | Git | Engineering/plan (review) |
| R074 | CURRENT_GIT | الاعتراف بأن PR #90 أدخل HR وIdentity admission وأن PR #91 أدخل تحسينات gallery/inspector/notifications | GitHub/CP | Engineering/plan (review) |
| R075 | QA | تمييز الملفات المختبرة عن الدروب والوظائف المثبتة: 43 page.tsx و134 route.ts ليست إثبات رحلة | CP/Router | Engineering/plan (review) |
| R076 | QA | تقرير statuses مثبت/مكسور/ناقص معتمد/غير مثبت/مرشح/لا ينطبق، مع دليل | Process | Engineering/plan (review) |
| R077 | UX | عدم إخفاء قسم HR الموجود بحجة عقد ثمانية مراكز قديم | IA/Governance | Experience (review) |
| R078 | UX | Gallery مع نفس query وfilters/paging وtable default؛ تحقق من PR #91 قبل التعديل | Catalog/DSH | Experience (review) |
| R079 | UX | المؤشرات ذات المصدر الحقيقي تحتفظ بالفترة والمدينة والصلاحية وdrilldown | Owner metrics | Experience (review) |
| R080 | UX | Inspector يحفظ scroll/selected/dirty context وfocus في desktop/mobile | CP | Experience (review) |
| R081 | SECURITY | تثبيت رفض الوصول المباشر API/route والموارد حسب الدور | Identity/owner | Identity/Safety (review) |
| R082 | FINANCE | فصل beneficiary payouts عن platform receivables وcash custody وexception withdrawals | WLT | WLT / finance.md (review) |
| R083 | FINANCE | لا تسمّى النسبة المقترحة اتفاقًا فعّالًا قبل قبول الطرفين | WLT/Contracts | WLT / finance.md (review) |
| R084 | SECURITY | منع تسريب معلومات الهواتف/الهويات في search URL والـ logs | CP/Identity | Identity/Safety (review) |
| R085 | MEDIA | عدم إظهار صور خاصة دون ACL أو مصدر/حقوق، مع فشل وأخطاء بشكل آمن | DSH/Media | DSH/Owner (review) |
| R086 | SERVICE | المشغّل موظف واحد عبر HR → Identity، لا duplication actor/profile | DSH/Identity | DSH/Owner (review) |
| R087 | OPERATIONS | Store approved لا يعني Store published ولا Client-visible | DSH/Client | DSH/Owner (review) |
| R088 | OPERATIONS | الحفاظ على validation الأصلية لحضور/حالة الموظف بعد PR #90 | HR | DSH/Owner (review) |
| R089 | QA | الفحص البصري يغطي templates والصفحات المؤثرة ولا يزعم شاملًا بلا route census | CP | Engineering/plan (review) |
| R090 | QA | تطابق كل نصيحة جديدة مع ما أُنجز في PR #87 #90 #91 قبل تطبيقها | GitHub/CP | Engineering/plan (review) |
| R091 | PERFORMANCE | لا تقيس آلاف السجلات ببيانات التطوير اليومية الصغيرة؛ اختبار dataset مؤقت | DSH/DB | Source owner / Engineering (review) |
| R092 | ACCESSIBILITY | focus target non-obscured + mobile touch target/zoom/RTL contrast | CP | Experience (review) |
| R093 | REFACTOR | أي حذف يشترط توافر قائمة مستهلكين وneg-space بعد cutover | code owners | Engineering/plan (review) |
| R094 | REFACTOR | تبقى migrations adopted immutable، no blanket cleanup | DB owners | Engineering/plan (review) |
| R095 | CANDIDATE | خيارات saved views/column pinning/command palette بحسب measured need | UX/Product | Product admission pending |
| R096 | CANDIDATE | AI insights read-only مستقبلًا بدون تنفيذ مالي/اعتماد تلقائي | Security/Product | Product admission pending |
| R097 | CANDIDATE | التحديث اللحظي SSE/WebSocket فقط عند حاجة زمنية ثبتت | Runtime/DSH | Product admission pending |
| R098 | PRODUCT | لا اختراع شكاوى/نزاعات/استردادات كنظام جديد بلا product contract | Product | Product admission pending |
| R099 | FINANCE | لا نجاح وهمي للعمل المالي عند timeout أو retry؛ idempotency/readback | WLT | WLT / finance.md (review) |
| R100 | SEARCH | server query accurate counts and empty vs errors across authorization boundaries | DSH/CP | Source owner / Engineering (review) |
| R101 | NOTIFICATIONS | العداد الشامل غير المقروء ليس عدد الرسائل في الصفحة | Notifications | DSH/Owner (review) |
| R102 | QUALITY | حالة حزمة docs verified لا تعني CI/test/DB/UX verified | Package/Process | Engineering/plan (review) |
| R103 | SOURCE | حفظ النصوص المرفقة الأصلية bytes كاملة داخل ZIP للتدقيق والتتبع | Package | Engineering/plan (review) |
| R104 | SOURCE | تغطية مخرجات الحزمة بأرشيف قابل للتحقق من SHA256 | Package | Engineering/plan (review) |
| R105 | EXECUTION | عدم خلط V1/V2 old target branch بالأوامر الجديدة على 16 | Process | Engineering/plan (review) |
| R106 | UX | توضيح empty/loading/denied/error/conflict/success ولا يستنتج صفر من فشل | CP | Experience (review) |
| R107 | UX | لا ينشأ مستوى تنقل مستقل لكل حالة/تبويب، ولا صفحة عملاقة تجمع مجالات مستقلة | IA | Experience (review) |
| R108 | DATA | عدم توسيع seeds اليومية ونظافتها وفق Progressive Lean Synthetic Data | Runtime | Source owner / Engineering (review) |
| R109 | QA | إثبات ملف كائن كامل/Inspector مرن بدل انتقال غير لازم | CP | Engineering/plan (review) |
| R110 | ACCESS | عمليات سجل الحذف والاستعادة لا تفقد الارتباطات أو صلاحيات الاسترداد | DSH | Identity/Safety (review) |
| R111 | DATA | تحديد زمن الحدث/المدينة/الدور في كل تقرير cohort | DSH/WLT | Source owner / Engineering (review) |
| R112 | QA | مقارنة الوقت والنقرات والأخطاء قبل/بعد لتبرير UX | UX | Engineering/plan (review) |

## Reconciliation gates

1. Check each historical source requirement against the **latest explicit Product decision**, the correct `governance/` owner, the current branch-41 source truth and any protected legal/financial obligations.
2. Mark material items as `ADOPTED_IN_OWNER`, `REFRAMED_BY_POLICY`, `CONDITIONAL_CANDIDATE`, `SUPERSEDED_WITH_REASON` or `UNRESOLVED` only when the source/decision evidence is actually reviewed; do **not** infer them from this tentative group routing. Those conclusions belong in the single temporary `docs/REFOUNDATION-PLAN.md`, not an endlessly maintained second catalog.
3. Later proof for current UI, SQL or apps must use its own exact HEAD and real owner readback. An old archived `UNVERIFIED` status cannot be silently upgraded to PASS.
4. A Control Panel UX detail does not automatically authorize a new infrastructure service, new search engine, generalized analytics/AI, financial rule or previously retired workflow.

All 112 source IDs are present here for future traceability; **individual semantic approval remains incomplete**. No archive content was executed and no source ZIP was altered.
