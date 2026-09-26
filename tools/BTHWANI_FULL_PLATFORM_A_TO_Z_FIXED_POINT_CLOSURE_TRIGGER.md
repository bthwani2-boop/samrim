@GitHub

نفّذ على المستودع `bthwani2-boop/samrim` والفرع **المصرح به وقت التنفيذ فقط** برنامج **إغلاق كامل ونهائي لمنصة BThwani الحالية من الألف إلى الياء**.

هذه المهمة تفوّض صراحةً إغلاق **FULL CURRENT APPROVED PRODUCT TARGET** بكل قدراته ورحلاته وأسـطحه وخدماته وحدوده المشتركة الحالية كما تثبتها Governance والحالة الحية وقت التنفيذ.

لا تعتمد على inventory أو SHA أو قائمة رحلات محفوظة في هذا التريجر بوصفها الحقيقة النهائية؛ استخرج الحقيقة الحية أولًا.

# 1. EXACT LIVE BASELINE

ابدأ فورًا بتثبيت:

```text
REPOSITORY
→ LIVE AUTHORIZED BRANCH
→ EXACT AUTHORIZED BRANCH HEAD
→ CURRENT USER CHANGES / WORKTREE
→ EXACT AGENTS.md
→ knowledge.sources.json
→ EXACT PINNED GOVERNANCE
→ NX PROJECT GRAPH
→ REPOSITORY STRUCTURE
→ ALL CURRENT APPS / SERVICES / PACKAGES
→ CONTRACTS / GENERATED CLIENTS
→ DATABASE / SCHEMAS / MIGRATIONS
→ CONFIG / INFRA / RUNTIME OWNERS
→ CURRENT VALID EVIDENCE
```

حافظ على كل تعديلات المستخدم.

أعد التحقق من `AUTHORIZED BRANCH HEAD` مباشرة قبل كل material write؛ إذا تحرك:

```text
RECONCILE
→ PRESERVE USER WORK
→ INVALIDATE ONLY STALE EVIDENCE
→ CONTINUE
```

لا Force Push، ولا حذف بيانات تشغيل قائمة، ولا merge/release خارج السلطة الصريحة.

---

# 2. FULL-PLATFORM AUTHORITY

النطاق هنا ليس `affected cone` صغيرًا لمهمة جزئية؛ المستخدم فوّض صراحةً:

```text
FULL CURRENT APPROVED PRODUCT TARGET
```

لذلك اشتق من Governance والحالة الفعلية **كل capability وكل journey وكل surface وكل service وكل shared boundary المادي الحالي**.

لا تعتبر أي قائمة داخل هذا التريجر exhaustive.

يجب أن تشمل على الأقل، متى كانت موجودة/معتمدة حاليًا:

```text
CLIENT
PARTNER
CAPTAIN
FIELD
CONTROL PANEL

IDENTITY
DSH
WLT

DESIGN SYSTEM
CONTRACTS
GENERATED CLIENTS
DATABASE / MIGRATIONS
MEDIA / STORAGE
RUNTIME / CONFIG
LOCAL DEVELOPMENT
VERIFICATION / CI
```

وكل capability/رحلة حالية، بما في ذلك على سبيل المثال لا الحصر:

```text
identity / activation / authentication / sessions
actors / profiles / access / permissions

partners / onboarding / acquisition / readiness
stores / serviceability / publication

business domains
catalog
categories / taxonomy
structured attributes
products
product media
store assortment / offers
store sections

discovery
search
filters
marketing / content
promotions
banners

addresses / locations
cart
checkout
ordering

single-store / multi-store flows
order lifecycle
accept / reject
preparation
pickup
dispatch
assignment
handoffs
custody
tracking
delivery
customer pickup

cancellation
exceptions
recovery
refund-related flows when admitted

captain operations
field operations
partner operations

payments
customer balance
funding
fees
commissions
rewards
earnings
cash
remittance
payouts
settlements
reconciliation

notifications
conversation / communication when admitted
feedback / ratings when admitted

platform policies
service cities
coverage
catalog rules
financial rules

operator workflows
audit
access and permissions
```

إذا أثبتت Governance Capability أخرى، أضفها تلقائيًا.

إذا أثبتت أن عنصرًا غير معتمد أو غير موجود، لا تخترعه.

---

# 3. BUILD ONE PLATFORM CLOSURE MATRIX

أنشئ مرة واحدة فقط Closure Matrix كاملة مشتقة من الحقيقة:

```text
CAPABILITY
× JOURNEY
× ACTOR
× SURFACE
× SEMANTIC OWNER
× CANONICAL WRITER
× CONTRACT
× PERSISTENCE / DATA
× READ MODEL
× MATERIAL CONSUMERS
× CROSS-SERVICE HANDOFF
× FAILURE / RECOVERY
× SECURITY / AUTHZ
× MEDIA WHEN MATERIAL
× REQUIRED STATIC PROOF
× REQUIRED FINAL OPERATIONAL PROOF
× DEPENDENCIES
```

حالة كل خلية مادية فقط:

```text
OPEN
IN_PROGRESS
STATIC_CLOSED
PROVEN_CLOSED
PROVEN_UNAFFECTED
N/A_WITH_REASON
```

ممنوع:

```text
UNKNOWN
MAYBE
LATER
UNEXAMINED
SILENT OMISSION
```

حدّث الخريطة تدريجيًا، ولا تعِد بناءها من الصفر بعد كل عيب.

---

# 4. DETERMINE THE CORRECT START AUTOMATICALLY

لا تبدأ من الشاشة الأسهل أو أكثر شيء ظاهر.

استخرج Dependency Graph وحدد:

```text
EARLIEST UNRESOLVED MATERIAL SHARED BOUNDARY
```

والأولوية:

```text
BROKEN FOUNDATION
→ SHARED CONTRACT / OWNER / DATA ROOT
→ EARLIEST DEPENDENT JOURNEY
→ NEXT DEPENDENCY-VALID JOURNEY
→ PLATFORM INTEGRATION
```

إذا كانت Identity أو Contract أو Schema أو Domain model مشتركة معيبة، أصلحها قبل واجهات تعتمد عليها.

إذا كانت الأساسات سليمة، انتقل مباشرة إلى أول رحلة مفتوحة.

بعد كل Static Closure:

```text
RECENSUS
→ SELECT NEXT DEPENDENCY-VALID OPEN CELL
→ CONTINUE
```

لا تسأل عن `next`.

---

# 5. MANDATORY DECISION BENCHMARK

عند كل **Capability أو Journey أو IA/UX/Data/Architecture decision مادي جديد**، نفّذ Benchmark واحد bounded قبل أول material write.

المصادر بالترتيب:

```text
BTHWANI GOVERNANCE
+ CURRENT AUTHORIZED BRANCH IMPLEMENTATION
→ DONOR / HISTORY
→ LIVE YEMEN COMPETITORS
→ RELEVANT YEMEN-MARKET EVIDENCE
→ RELEVANT OSS / GLOBAL PRODUCT EXEMPLARS
→ CURRENT PRIMARY / OFFICIAL INTERNET SOURCES
→ TRIANGULATE
→ DECIDE FOR BTHWANI
→ WRITE
```

لا تجعل أي مصدر خارجي سلطة على BThwani.

الهدف:

```text
LOST SEMANTICS
EDGE CASES
STATE MACHINES
IA / NAVIGATION
WORKFLOW
FAILURE / RECOVERY
DATA MODEL LESSONS
ARCHITECTURE LESSONS
UX PATTERNS
TEST ORACLES
PERFORMANCE / SCALE LESSONS
ACCESSIBILITY / PLATFORM FIT
```

ثم:

```text
PRESERVE VALUE
→ REIMPLEMENT CLEANLY
→ IMPROVE
→ OR REJECT
```

لا تنسخ Architecture أو هوية أو Product truth لمجرد وجودها.

---

# 6. DONOR FORENSICS

المانح:

```text
bthwani2-boop/bthwani-suite-next
branch h
```

استخرج **LIVE EXACT h HEAD وقت الاستخدام**.

افحص فقط historical cone الذي يمكن أن يغير القرار الحالي.

ابحث عن:

```text
LOST BUSINESS SEMANTICS
MISSING JOURNEYS
MISSING STATES
EDGE CASES
RECOVERY
CONTRACT LESSONS
MIGRATION LESSONS
UX / IA
TESTS
REUSABLE ASSETS WHEN LICENSED/VALID
```

لا تحفظ Legacy لمجرد أنه كان موجودًا.

---

# 7. LIVE COMPETITOR BENCHMARK

على هاتف Android `SM-S9280` استخدم التطبيقات الخمسة التالية:

```text
1. توصيل ون — HIGHEST YEMEN-FIT PRIORITY
   package: com.smartapps.tawseel
   activity: com.smartapps.tawseel/.MainActivity

2. تساهيل — HIGH YEMEN-FIT PRIORITY
   package: com.adunit.ecommerce.tasaheel
   activity: com.adunit.ecommerce.tasaheel/.MainActivity

3. اطلبي — MEDIUM YEMEN-FIT PRIORITY
   package: com.etlobni
   activity: com.etlobni/.MainActivity

4. ناس NASS — SUPPORTING YEMEN-FIT PRIORITY
   package: com.teknokeys.nass
   activity: com.teknokeys.nass/.MainActivity

5. HungerStation — REGIONAL HIGH-MATURITY PRODUCT EXEMPLAR
   package: com.hungerstation.android.web
   activity: RESOLVE FROM LIVE DEVICE BEFORE FIRST VERIFIED REVIEW
```

في كل Material Benchmark Pass راجع **الخمسة** بحسب السؤال المادي الحالي. لفهم ملاءمة السوق اليمني، يكون الوزن: توصيل ون ثم تساهيل ثم اطلبي ثم ناس. استخدم HungerStation كمرجع إقليمي عالي النضج خصوصًا في UX maturity وdiscovery وstorefront وcatalog presentation وsearch/filter وcart/checkout وorder experience وdesign quality وperformance patterns؛ ولا تجعله تلقائيًا أعلى من المراجع المحلية في ملاءمة السوق اليمني.

## 7.1 COMPETITOR EVIDENCE CACHE LAW

قبل أي live competitor inspection اقرأ الملفات الخمسة canonical تحت:

```text
tools/competitors/
├── tawseel-one.md
├── tasaheel.md
├── etlobni.md
├── nass.md
└── hungerstation.md
```

تعامل مع `CURRENT VERIFIED STATE` فيها كـ**reusable observational evidence فقط**، وليس Product authority.

لكل Material Benchmark Pass:

```text
READ ALL 5 CACHED EVIDENCE FILES
→ IDENTIFY WHAT IS CURRENTLY VERIFIED
→ IDENTIFY RELEVANT / STALE / MISSING AREAS FOR THE CURRENT MATERIAL QUESTION
→ INSPECT ALL 5 LIVE APPS ONLY TO THE DEPTH REQUIRED BY THAT DECISION
→ PRIORITIZE DELTA VERIFICATION OVER REDISCOVERY
→ UPDATE THE SAME APPLICATION'S CANONICAL FILE IMMEDIATELY
→ REPLACE STALE CURRENT STATE INSTEAD OF ACCUMULATING CONFLICTING TRUTH
→ APPEND ONE CONCISE REVIEW HISTORY ENTRY
→ MOVE IMMEDIATELY TO BTHWANI DECISION / IMPLEMENTATION
```

ممنوع إنشاء تقارير منافسين موازية أو ملفات session-specific جديدة. لكل تطبيق ملف canonical واحد فقط.

لا تعِد اكتشاف evidence ما زالت حديثة ومادية بلا سبب. نفّذ Full Rebase Review للتطبيق فقط إذا:

```text
APP MAJORLY CHANGED
PACKAGE / VERSION CHANGED MATERIALLY
MAJOR IA REDESIGN DETECTED
OLD EVIDENCE IS STALE OR INCONSISTENT
CURRENT DECISION REQUIRES AN UNREVIEWED AREA
```

لا تستخدم مدة زمنية عمياء لإبطال evidence. القاعدة:

```text
FRESH UNTIL MATERIAL CHANGE IS SUSPECTED OR THE CURRENT DECISION REQUIRES REVALIDATION
```

داخل كل ملف حافظ على فصل واضح بين:

```text
IDENTITY / TECHNICAL STATE
COVERAGE MATRIX
CURRENT VERIFIED STATE
USEFUL PATTERNS
WEAKNESSES / REJECTED PATTERNS
BTHWANI RELEVANCE
UNREVIEWED / STALE AREAS
REVIEW HISTORY
```

عند تغير حقيقة:

```text
UPDATE CURRENT VERIFIED STATE
+ APPEND CONCISE REVIEW HISTORY
```

ولا تترك النسخة القديمة كحقيقة حالية متعارضة.

افحص Black-box فقط، حسب الرحلة الحالية:

```text
SHELL
IA
NAVIGATION
TABS / SUB-TABS
DISCOVERY
STORES
CATEGORIES
PRODUCTS
MEDIA
SEARCH / FILTER
CART / CHECKOUT
ORDERS
TRACKING
ACCOUNT
PROMOTIONS
BANNERS
LOADING
EMPTY
NO RESULTS
ERROR
RETRY
OFFLINE
CONFLICT
RTL / ARABIC
ACCESSIBILITY
INFORMATION DENSITY
INTERACTION
RECOVERY
```

لا تفكك binaries ولا تنسخ الكود أو العلامة أو الأصول المحمية.

هذه **Decision Evidence** فقط:

```text
BTHWANI GOVERNANCE + CURRENT BTHWANI IMPLEMENTATION = PRODUCT TRUTH
COMPETITOR OBSERVATION / CACHE != BTHWANI REQUIREMENT
```

ولا تلغِ ملفات المنافسين بقية Benchmark. يبقى المسار:

```text
CURRENT BTHWANI + GOVERNANCE
→ DONOR
→ CACHED COMPETITOR KNOWLEDGE
→ LIVE COMPETITOR DELTA CHECK
→ YEMEN-MARKET EVIDENCE
→ OSS / GLOBAL EXEMPLARS
→ PRIMARY / OFFICIAL SOURCES
→ TRIANGULATE
→ BTHWANI DECISION
```

لا تعِد فتح المنافسين بعد كل edit. أعد Benchmark فقط عند فتح قرار مادي جديد أو عند وجود سبب فعلي لإعادة التحقق.

## 7.2. Sequential competitor-review checkpoint — 2026-09-26

- Tawseel One: refreshed its canonical file at `tools/competitors/tawseel-one.md` from the installed app (`2.0.63`, versionCode `263`) using visible black-box interaction. Status remains `PARTIAL_INTERACTIVE_BLACK_BOX_REVIEW`; the file separates observed behavior, temporary reversible checks, and untested payment/destructive/account/external paths.
- Local evidence: 46 linked PNG captures are in `tools/competitors/local-photos/tawseel-one/`. The folder ignores all captures; they are local-only and must not be staged, committed, uploaded or pushed.
- This checkpoint records review progress only. Tawseel observations are decision evidence and do not change BThwani Product truth or close any BThwani implementation gap.
- Tasaheel: refreshed `tools/competitors/tasaheel.md` from the installed `1.7.9` app (versionCode `179`). Account routes and a cart-add action reached sign-in gates; the Settings modal was inspected read-only. Status remains partial, with no authentication or cart/order mutation.
- Tasaheel local evidence: 17 PNG captures are in `tools/competitors/local-photos/tasaheel/`, with selected review captures linked from the canonical file. All captures are ignored by Git and remain local-only; none may be staged, committed, uploaded or pushed.
- Etlobni: refreshed `tools/competitors/etlobni.md` from the installed `1.2.0` app (versionCode `10236`) with a moderate pass focused on its launch promotion, `انفعني` form, empty cart and account entry points. Status remains partial; no request, account or order was submitted.
- Etlobni local evidence: 8 PNG captures are linked from the canonical file under `tools/competitors/local-photos/etlobni/`. All are ignored by Git and remain local-only; none may be staged, committed, uploaded or pushed.
- Nass and HungerStation: their current canonical reviews were reused at their already-recorded partial scope; installed readback still matches Nass `1.0.52`/versionCode `76` and HungerStation `8.0.299`/versionCode `1527`. No deeper pass or account/order interaction was done for these supporting competitors.
- Focus for the remaining review work: return to Tawseel One for the deeper pass requested by the user, prioritizing its remaining safe category and control coverage. The other competitor apps receive proportionate review only.

---

# 8. ROOT-CAUSE / REFOUNDATION LAW

لكل Gap:

```text
EXACT FAILURE
→ MATERIAL FAILURE CONE
→ HIGHEST PROVEN CAUSAL ROOT
→ SIMPLEST COMPLETE CANONICAL TREATMENT
```

ممنوع إصلاح العرض وترك الجذر.

إذا كان العلاج الصحيح يتطلب:

```text
DELETE
CLEAN
DISMANTLE
REHOME
REFACTOR
RESTRUCTURE
REMODEL
REGENERATE
RE-MIGRATE
REFOUND
REBUILD
```

فنـفذه كاملًا دون تردد.

الأولوية دائمًا:

```text
DELETE
→ DIRECT USE
→ EXTEND CANONICAL OWNER
→ REFACTOR CANONICAL OWNER
→ RESTRUCTURE / REFOUND
→ NEW MECHANISM ONLY IF STILL NECESSARY
```

ممنوع نهائيًا:

```text
PATCH AROUND ROOT
TEMPORARY PERMANENT FIX
SHADOW OWNER
SHADOW WRITER
SECOND SOURCE OF TRUTH
SECOND STATE MACHINE
SECOND CONTRACT AUTHORITY
SECOND MIGRATION HISTORY
OLD + NEW PARALLEL PATH
DEAD COMPATIBILITY
PLACEHOLDER SUCCESS
SILENT FALLBACK THAT HIDES FAILURE
```

---

# 9. ZERO-RESIDUE COMPLETE CUTOVER

لا يعتبر أي إصلاح أو إعادة تأسيس مكتملًا حتى ينتقل الفائز إلى كل ما ينطبق:

```text
PRODUCERS
WRITERS
CONSUMERS
SERVICES
APPS
ROUTES
SCREENS
STATE
HOOKS
API CALLERS
CONTRACTS
DTOs
GENERATED CLIENTS
EVENTS
HANDOFFS
PERSISTENCE
DATABASE
SCHEMAS
MIGRATIONS
MEDIA
CONFIG
ENV
RUNTIME CONFIG
CACHE
REGISTRIES
TESTS
VERIFIERS
CI
CURRENT IMPLEMENTATION DESCRIPTIONS
```

ثم:

```text
DELETE LOSING PATH
→ SEARCH ALL RESIDUE
→ PROVE LOSER ABSENT
```

لا تترك:

```text
LEGACY
DEAD FILES
DEAD ROUTES
DEAD TYPES
DEAD FLAGS
DEAD ENV KEYS
DEAD MIGRATIONS
DEAD CSS
DEAD COMPONENTS
DUPLICATE UI
DUPLICATE APIs
DUPLICATE DATA MODELS
SHADOW STATE
```

إذا لا توجد ضرورة حقيقية لحفظ compatibility أو data history، **أعد تأسيس الحقيقة النظيفة بدل تراكم التصحيحات**.

---

# 10. GOVERNANCE FIRST WHEN DURABLE MEANING CHANGES

لكل Change Unit مادي صنّف:

```text
NONE
REVALIDATE_ONLY
UPDATE_REQUIRED
DEFECT_FOUND
```

إذا تغير Product meaning أو policy أو IA/experience/design invariant دائم:

```text
CORRECT CANONICAL GOVERNANCE OWNER FIRST
→ PROVE
→ COMPLETE GOVERNANCE INTEGRATION
→ REPIN EXACT IMMUTABLE GOVERNANCE SHA
→ INVALIDATE ONLY STALE IMPLEMENTATION EVIDENCE
→ CONTINUE
```

لا تكتب Product truth دائمًا داخل `AGENTS.md`.

ولا تلتف بالكود حول Governance معيبة.

---

# 11. FULL-STACK JOURNEY CLOSURE

كل رحلة يجب إغلاقها من المصدر إلى النتيجة، وليس بمجرد وجود Screen أو API.

لكل رحلة، أثبت ما ينطبق:

```text
PRODUCT SEMANTICS
→ GOVERNANCE
→ ACTOR / AUTHORITY
→ AUTHENTICATION / AUTHORIZATION
→ UI / INTERACTION ENTRY
→ GENERATED CLIENT
→ API CONTRACT
→ TRANSPORT
→ SERVICE OWNER
→ DOMAIN LOGIC
→ CROSS-SERVICE HANDOFF
→ PERSISTENCE
→ DB / SCHEMA / MIGRATION
→ EVENT / OUTBOX WHEN USED
→ READ MODEL
→ ALL MATERIAL CONSUMERS
→ FAILURE / RETRY / CONFLICT / RECOVERY
→ AUDIT
→ FINAL CANONICAL READBACK
```

وجود:

```text
SCREEN != CLOSED JOURNEY
API != CLOSED JOURNEY
TABLE != CLOSED JOURNEY
GREEN TYPECHECK != CLOSED JOURNEY
```

---

# 12. ALL REAL SURFACES

احسب كل surface حقيقي عندما يكون مستهلكًا ماديًا:

```text
apps/app-client
apps/app-partner
apps/app-captain
apps/app-field
apps/control-panel
```

لا تفرض تغييرًا على Surface غير متأثر.

لكن لا تعتبره `PROVEN_UNAFFECTED` بالحدس؛ أثبت ذلك من source/contracts/dependencies.

أي Surface متأثر يجب إغلاق:

```text
IA
SHELL / NAVIGATION
SCREEN HIERARCHY
DATA
ACTIONS
LOADING
EMPTY
NO RESULTS
ERROR
RETRY
OFFLINE
CONFLICT
BUSY / DUPLICATE PREVENTION
DISABLED
SELECTED
SUCCESS READBACK
RTL
ARABIC
ACCESSIBILITY
RESPONSIVE / ADAPTIVE BEHAVIOR
LIGHT / DARK WHEN MATERIAL
```

---

# 13. USER EXPERIENCE / DESIGN REFOUNDATION

إذا كشف Benchmark أو Governance أو الحالة الحالية أن تجربة Surface مادية ضعيفة جذريًا:

```text
DO NOT DECORATE THE DEFECT
DO NOT PATCH THE SCREEN
```

بل:

```text
ACTOR OUTCOME
→ IA
→ SHELL
→ NAVIGATION
→ SCREEN / WORKSPACE MODEL
→ INFORMATION HIERARCHY
→ INTERACTION MODEL
→ STATES / RECOVERY
→ DESIGN SYSTEM
→ RTL / ACCESSIBILITY
→ IMPLEMENT
→ CUT OVER
→ DELETE OLD UI
```

لا تنسخ UI المنافس.

صمم أفضل حل مناسب لـBThwani.

---

# 14. CONTROL PANEL

اعتبر لوحة التحكم Workspace تشغيليًا، لا مجموعة صفحات عرض.

كل resource قابل للنمو ويحتاج:

```text
FIND
FILTER
SORT
SELECT
ACT
```

يستخدم Server-Driven Operational Registry ما لم تثبت semantics أن Tree/Queue/Feed/Detail Workspace أنسب.

استخدم:

```text
SERVER SEARCH
SERVER FILTER
SERVER SORT
BOUNDED PAGINATION
SELECTION / BULK ACTIONS WHEN JUSTIFIED
INLINE ACTIONS WHEN JUSTIFIED
DETAIL ON DEMAND
RELATIONSHIP DRILLDOWN
CANONICAL SERVER TRUTH
```

احذف Cards/list routes/forms/models الموازية إذا ثبت تجاوزها.

حافظ على IA الحالية المعتمدة من Governance ولا تخترع مركزًا جديدًا بلا قرار Product.

---

# 15. DATA MODEL / OWNERSHIP

لكل fact مادي:

```text
ONE SEMANTIC OWNER
→ ONE CANONICAL WRITER
→ ALL MATERIAL CONSUMERS
→ CANONICAL READBACK
```

دقق خصوصًا في:

```text
IDENTITIES
ACTORS
PARTNERS
STORES
SERVICEABILITY
CATALOG
PRODUCTS
STORE OFFERS
ORDERS
ASSIGNMENTS
DELIVERY STATE
MONEY
LEDGER / BALANCE
FEES
COMMISSIONS
SETTLEMENTS
POLICIES
MEDIA
ACCESS
```

لا تسمح لنفس الحقيقة أن تعيش في أكثر من نموذج مستقل.

---

# 16. DATABASE / MIGRATIONS

دقق migrations الحالية في كل خدمة متأثرة.

إذا لا توجد ضرورة حفظ بيانات أو compatibility:

```text
REFOUND CLEAN CANONICAL MIGRATION HISTORY
```

بدل:

```text
PATCH
→ PATCH
→ CORRECTIVE PATCH
→ LEGACY COMPATIBILITY
```

أما إذا توجد بيانات يجب حفظها، صمم migration/cutover آمنًا ومثبتًا.

أثبت:

```text
CONSTRAINTS
REFERENTIAL INTEGRITY
UNIQUENESS
STATE INVARIANTS
INDEXES WHEN MATERIAL
TRANSACTIONAL BOUNDARIES
IDEMPOTENCY
CONCURRENCY
ROLL-FORWARD / RECOVERY WHEN REQUIRED
```

---

# 17. MEDIA / VISUAL CLOSURE

لا تعتبر أي رحلة تعتمد على imagery/media مكتملة دون Media Closure.

افصل ownership/types:

```text
STORE LOGO
STORE COVER
CATEGORY IMAGE
CLASSIFICATION VISUAL
PRODUCT MEDIA
STORE SECTION MEDIA
PROFILE / AVATAR WHEN ADMITTED
DISCOVERY BANNER
PROMOTION / CAMPAIGN MEDIA
EVIDENCE / ATTACHMENT MEDIA WHEN DOMAIN-APPROPRIATE
```

لا تخلطها.

كل Media:

```text
KNOWN PROVENANCE / LICENSE
→ CANONICAL UPLOAD
→ CANONICAL STORAGE
→ CANONICAL REFERENCE
→ AUTHORIZATION
→ REPLACE / DELETE
→ ORPHAN CLEANUP
→ READBACK
→ REAL SURFACE RENDER
```

ممنوع Raw URL truth أو Shadow Media system.

---

# 18. REALISTIC VISUAL ASSET GENERATION

عندما تحتاج البيئة المحلية أصولًا بصرية لإثبات التجربة، ولّدها **بشكل أصلي وواقعي ومتماسك وعلى دفعات** وبأقصى سرعة عملية.

يشمل ما يلزم:

```text
STORE LOGOS
STORE COVERS
PRODUCT PACKAGING / PRODUCT IMAGES
CATEGORY IMAGES
CLASSIFICATION IMAGES
BANNERS
PROMOTIONAL CREATIVE
DISCOVERY ART
OTHER MATERIAL VISUAL ASSETS
```

الأولوية:

```text
REALISM
→ CONSISTENCY
→ COVERAGE OF MATERIAL STATES
→ SPEED
```

لا العدد العشوائي.

لا تنتحل هوية علامة حقيقية بلا ضرورة.

ارفع كل أصل من خلال canonical media path فقط.

---

# 19. REALISTIC LOCAL OPERATIONS STATE — NOT SEEDS

بعد Static Closure الكافي للرحلات التي تحتاج بيانات تكامل، أنشئ **Persistent Realistic Local Operations State**.

يجب أن تكون السجلات Business records عادية تمامًا.

للسرعة يجوز Dev-only Provisioner، لكنه مجرد client:

```text
DEV-ONLY MANIFEST / ORCHESTRATOR
→ AUTHENTICATED ROLE
→ CANONICAL API / COMMAND
→ CANONICAL BUSINESS WRITER
→ REAL VALIDATION
→ REAL AUTHORIZATION
→ REAL AUDIT
→ REAL PUBLICATION
→ NORMAL DATABASE RECORD
```

ممنوع:

```text
DIRECT SQL
SEED AS BUSINESS WRITER
FAKE INSERT
BYPASS VALIDATION
BYPASS AUTHZ
MAGIC RECORDS
AUTO RESET
AUTO DELETE
is_seed BUSINESS SEMANTIC
```

الـProvisioner يجب أن يكون:

```text
IDEMPOTENT
DRIFT-DETECTING
FAIL-LOUDLY
NON-DESTRUCTIVE
```

وألا يغير أو يحذف بيانات المستخدم أو التشغيل غير المملوكة له.

---

# 20. REALISTIC PLATFORM DATASET

أنشئ ما يكفي لإثبات **كل الرحلات الحالية**، وليس فقط الكتالوج.

حسب الحاجة أنشئ عبر المسارات الحقيقية:

```text
ACTORS
PARTNERS
STORES
CATEGORIES
PRODUCTS
MEDIA
OFFERS
STORE SECTIONS
BANNERS
PROMOTIONS
ADDRESSES
ORDERS
ASSIGNMENTS
CAPTAIN / FIELD OPERATIONAL STATE
PAYMENT / CASH / BALANCE STATE
SETTLEMENT / RECONCILIATION CASES
POLICY-CONFORMANT EXCEPTIONS
OTHER MATERIAL BUSINESS STATE
```

استخدم أسماء وبيانات متماسكة وواقعية.

لا تبالغ في الحجم؛ غطِّ الحالات المادية بأقل Dataset كافية.

---

# 21. STATIC-CLOSURE-FIRST

المسار الإلزامي:

```text
PLATFORM DISCOVERY ONCE
→ DEPENDENCY MAP
→ MATERIAL BENCHMARK
→ STATIC IMPLEMENTATION
→ ROOT-CAUSE REPAIR
→ REFACTOR / RESTRUCTURE / REFOUND
→ COMPLETE CUTOVER
→ DELETE / CLEAN RESIDUE
→ STATIC CLOSE JOURNEY
→ NEXT DEPENDENCY-VALID JOURNEY
→ ...
→ FULL PLATFORM STATIC CLOSURE
→ FINAL OPERATIONAL CAMPAIGN
→ FIX ONLY REAL RUNTIME FINDINGS
→ RERUN ONLY INVALIDATED EVIDENCE
→ FINAL PLATFORM FIXED POINT
```

أثناء التنفيذ العادي استخدم فقط:

```text
SOURCE
TYPECHECK
LINT
UNIT
CONTRACT
SCHEMA
GENERATED CONSISTENCY
TARGETED NX AFFECTED
DIRECT STATIC CHECK
```

ممنوع:

```text
EDIT → DEVICE
EDIT → PLAYWRIGHT
EDIT → RUNTIME
SCREEN → DEVICE
COMMIT → FULL JOURNEY
```

إلا عندما تكون Runtime truth مطلوبة لاتخاذ القرار التنفيذي الصحيح التالي.

---

# 22. NX / CACHE / PERFORMANCE

استخدم canonical Nx graph وNx cache.

```text
AFFECTED CHANGE
→ AFFECTED TARGETS ONLY
```

لا:

```text
FULL VERIFY AFTER EVERY EDIT
FULL BUILD AFTER EVERY COMMIT
UNRELATED PROJECT TESTING
DUPLICATE CACHE SYSTEM
DUPLICATE DEPENDENCY ENGINE
```

استخدم أقرب فحص يمكنه كشف الخطأ الحالي.

احتفظ بالـruntime والجلسات والخدمات الدافئة والصحيحة.

لا restart/rebuild/relogin/reset بلا ضرورة سببية.

---

# 23. CHANGE UNITS / COMMITS

نفّذ في Coherent Slices كبيرة بما يكفي لإغلاق نتيجة مفهومة، وصغيرة بما يكفي للمراجعة.

```text
ONE COHERENT OUTCOME
→ REVIEW DIFF
→ STATIC / DIRECT CLAIM-SPECIFIC PROOF
→ LOCAL COMMIT
```

ممنوع:

```text
MICRO-COMMIT PER EDIT
GIANT UNREVIEWABLE COMMIT
PUSH AFTER EVERY COMMIT
```

ادفع عندما يكون ذلك مفيدًا ومسموحًا، مع الحفاظ على exact-state safety.

---

# 24. SECURITY / AUTHORIZATION / AUDIT

لكل رحلة مادية راجع:

```text
WHO MAY READ
WHO MAY CREATE
WHO MAY UPDATE
WHO MAY DELETE / ARCHIVE
WHO MAY APPROVE
WHO MAY PUBLISH
WHO MAY MOVE MONEY
WHO MAY CHANGE POLICY
```

أثبت:

```text
ROLE / ACTOR AUTHORITY
SESSION BEHAVIOR
AUTHZ AT SERVER BOUNDARY
NO UI-ONLY SECURITY
AUDIT WHEN REQUIRED
NO CROSS-ACTOR DATA LEAK
```

لا تشدد Local Dev بطريقة تعيق التطوير بلا قيمة حقيقية، مع بقاء semantics الصحيحة.

---

# 25. FAILURE / RECOVERY / CONCURRENCY

لا تغلق Happy Path فقط.

لكل رحلة مادية، أغلق ما ينطبق:

```text
VALIDATION FAILURE
FORBIDDEN
NOT FOUND
CONFLICT
DUPLICATE ACTION
RETRY
TIMEOUT
OFFLINE
PARTIAL FAILURE
CONCURRENT UPDATE
IDEMPOTENT RETRY
STALE READ
CANCELLATION
RECOVERY
CANONICAL READBACK
```

لا تخفِ failure لعرض success.

---

# 26. QUALITY DIMENSIONS

استخدم Quality taxonomy المثبتة.

لكل dimension plausibly material:

```text
AFFECTED
PROVEN_UNAFFECTED
N/A_WITH_REASON
```

راجع عند الحاجة:

```text
CORRECTNESS
SECURITY
AUTHORIZATION
DATA INTEGRITY
PERFORMANCE
SCALABILITY
RELIABILITY
RECOVERY
ACCESSIBILITY
RTL
RESPONSIVENESS
OBSERVABILITY
OPERABILITY
MAINTAINABILITY
CHANGEABILITY
```

لا تحولها إلى checklist احتفالية؛ افحص فقط ما يمكن أن يغير صحة الرحلة.

---

# 27. FINAL PLATFORM OPERATIONAL CAMPAIGN

بعد:

```text
ALL CURRENT TARGET MATERIAL CELLS = STATIC_CLOSED
```

نفّذ حملة Operational Proof واحدة مترابطة على الأسطح الحقيقية.

استخدم:

```text
REAL ROLE-SCOPED ACTORS
REAL CLIENT
REAL PARTNER
REAL CAPTAIN WHEN MATERIAL
REAL FIELD WHEN MATERIAL
REAL CONTROL PANEL
REAL IDENTITY
REAL DSH
REAL WLT
REAL DATABASE READBACK
REAL MEDIA
REALISTIC PERSISTENT BUSINESS STATE
```

أثبت الرحلات end-to-end.

أمثلة:

```text
CUSTOMER ACTION
→ DSH
→ PARTNER
→ CAPTAIN / FIELD WHEN REQUIRED
→ WLT WHEN FINANCIAL
→ CONTROL
→ CLIENT READBACK
```

و:

```text
CONTROL / PARTNER WRITE
→ CONTRACT
→ DSH
→ DB
→ READ MODEL
→ CLIENT RENDER
```

الصورة أو screenshot وحدها ليست Journey proof.

---

# 28. RUNTIME FINDINGS

إذا كشف Final Operational Proof عيبًا:

```text
CAPTURE EXACT FAILURE
→ IDENTIFY HIGHEST ROOT
→ REPAIR STATICALLY
→ COMPLETE CUTOVER
→ DELETE NEWLY EXPOSED RESIDUE
→ INVALIDATE ONLY STALE EVIDENCE
→ RERUN ONLY AFFECTED PROOF
```

ممنوع إعادة البرنامج كاملًا إذا لم تتغير أدلته.

---

# 29. CONTINUOUS EXECUTION

لا تتوقف بعد:

```text
ONE APP
ONE SERVICE
ONE JOURNEY
ONE CAPABILITY
ONE COMMIT
ONE BENCHMARK
ONE GREEN TEST
```

اللوب الإلزامي:

```text
SELECT EARLIEST DEPENDENCY-VALID OPEN CELL
→ BENCHMARK IF DECISION-CRITICAL
→ CLOSE ROOT
→ IMPLEMENT
→ CUT OVER
→ DELETE RESIDUE
→ STATIC PROVE
→ COMMIT
→ RECENSUS
→ NEXT OPEN CELL
```

استمر تلقائيًا حتى Fixed Point.

لا تسأل المستخدم عن `next` طالما توجد خطوة آمنة داخل السلطة.

---

# 30. ONLY VALID STOP CONDITIONS

توقف فقط عند blocker حقيقي لا يمكن حله داخل السلطة:

```text
UNRESOLVABLE PRODUCT DECISION
REAL AUTHORITY BOUNDARY
UNRECONCILED TARGET MOVEMENT
REQUIRED CREDENTIAL / ENVIRONMENT UNAVAILABLE
MATERIAL IRREVERSIBILITY / SAFETY RISK
DECISION-CRITICAL UNKNOWN THAT CANNOT BE RESOLVED
```

أي defect تقني قابل للتشخيص:

```text
DO NOT STOP
→ FIND ROOT
→ REPAIR
→ CUT OVER
→ DELETE RESIDUE
→ CONTINUE
```

---

# 31. FINAL FIXED-POINT CONTRACT

لا تعلن الإغلاق حتى يصبح:

```text
FULL CURRENT APPROVED PRODUCT TARGET = ACCOUNTED

ALL MATERIAL CAPABILITIES = CLOSED
ALL MATERIAL JOURNEYS = CLOSED
ALL MATERIAL SURFACES = CLOSED
ALL MATERIAL SERVICES = CLOSED
ALL MATERIAL CROSS-SERVICE BOUNDARIES = CLOSED

ROOT DEFECTS = 0
KNOWN MATERIAL BUGS = 0
KNOWN MATERIAL REGRESSIONS = 0
KNOWN MATERIAL WEAKNESSES = 0

SHADOW OWNERS = 0
SHADOW WRITERS = 0
SHADOW STATE = 0
SHADOW CONTRACTS = 0

PARTIAL CUTOVERS = 0
DEAD / SUPERSEDED PATHS = 0
UNJUSTIFIED LEGACY = 0
UNJUSTIFIED COMPATIBILITY = 0
UNJUSTIFIED RESIDUE = 0

PLACEHOLDER FLOWS = 0
FAKE SUCCESS = 0
BROKEN / ORPHAN MEDIA = 0
GHOST DATA = 0
STALE READ MODELS = 0

UNPROVEN MATERIAL CLAIMS = 0
DECISION-CRITICAL UNKNOWNS = 0
INVALIDATED REQUIRED EVIDENCE = 0

GOVERNANCE IMPACT = RESOLVED
STATIC EVIDENCE = CURRENT
FINAL OPERATIONAL EVIDENCE = CURRENT

MULTI-ROLE END-TO-END PROOF = GREEN
CROSS-SERVICE READBACK = GREEN
```

وبعبارة حاسمة:

```text
NO PATCHES
NO ROOT DEFECTS
NO SHADOW TRUTH
NO PARTIAL CUTOVER
NO DEAD LEGACY
NO UNJUSTIFIED RESIDUE
NO SILENT GAP
NO MATERIAL UNKNOWN
```

---

# 32. FINALIZATION

عند الوصول إلى Fixed Point:

```text
FRESH FULL-PROGRAM CLOSURE CENSUS
→ FINAL DIFF REVIEW
→ CONFIRM ALL REQUIRED EVIDENCE CURRENT
→ CONFIRM WORKTREE / USER CHANGES ACCOUNTED
→ FINAL COHERENT COMMITS
→ pnpm safe:push ONCE WHEN APPROPRIATE
→ CONFIRM EXACT REMOTE AUTHORIZED BRANCH SHA
```

إذا كانت المهمة تفوض إنشاء PR:

```text
CREATE PR AUTHORIZED BRANCH → main
```

ولا تدمج إلى `main` إلا إذا كانت سلطة الدمج صريحة، والـHEAD المتوقع ثابت، والـchecks المطلوبة خضراء، ولا يوجد blocker أو review unresolved.

لا release أو staging أو production أو store submission دون سلطة منفصلة صريحة.

---

# MASTER EXECUTION LAW

```text
PIN EXACT LIVE AUTHORIZED BRANCH
→ LOAD AGENTS + EXACT GOVERNANCE
→ DERIVE THE ENTIRE CURRENT APPROVED PLATFORM
→ BUILD ONE COMPLETE CLOSURE MATRIX
→ BUILD DEPENDENCY GRAPH
→ FIND EARLIEST UNRESOLVED ROOT
→ BENCHMARK GOVERNANCE + CURRENT BTHWANI + DONOR + ALL 5 PRIORITIZED COMPETITORS + YEMEN EVIDENCE + OSS/GLOBAL EXEMPLARS + CURRENT PRIMARY SOURCES WHEN MATERIAL
→ DECIDE ONCE
→ WRITE IMMEDIATELY
→ FIX HIGHEST ROOT
→ DELETE / CLEAN / REFACTOR / RESTRUCTURE / REMODEL / RE-MIGRATE / REFOUND AS REQUIRED
→ COMPLETE EVERY MATERIAL CUTOVER
→ DELETE EVERY LOSING PATH AND ALL RESIDUE
→ STATIC-CLOSE THE JOURNEY
→ MOVE TO THE NEXT DEPENDENCY-VALID OPEN JOURNEY
→ CONTINUE WITHOUT ASKING FOR NEXT
→ STATIC-CLOSE THE ENTIRE CURRENT PLATFORM
→ BUILD/PRESERVE REALISTIC LOCAL OPERATIONS STATE THROUGH CANONICAL WRITERS
→ GENERATE AND ATTACH ALL MATERIAL REALISTIC VISUAL ASSETS THROUGH CANONICAL MEDIA
→ RUN ONE FINAL COHERENT MULTI-SURFACE / MULTI-ROLE / CROSS-SERVICE OPERATIONAL CAMPAIGN
→ FIX ONLY REAL RUNTIME FINDINGS AT THEIR ROOT
→ RERUN ONLY INVALIDATED EVIDENCE
→ REPEAT UNTIL NO MATERIAL OPEN CELL REMAINS
→ FINAL ZERO-DEFECT / ZERO-SHADOW / ZERO-PARTIAL-CUTOVER / ZERO-RESIDUE FIXED POINT
→ SAFE PUSH
→ EXACT REMOTE SHA
→ STOP ONLY AT PROVEN 100% CLOSURE OR A REAL BLOCKER
```

نفّذ بأقصى سرعة عملية ممكنة، لكن **السرعة لا تبرر الاختصار في الحقيقة أو ترك جذر أو ترقيع أو بقايا**.

الهدف النهائي ليس “تحسين المنصة” بل:

```text
CLEAN CANONICAL PLATFORM
+ COMPLETE CURRENT PRODUCT
+ COMPLETE JOURNEYS
+ COMPLETE REAL SURFACES
+ COMPLETE DATA / MEDIA / FINANCE / OPERATIONS
+ NO SHADOW TRUTH
+ NO LEGACY RESIDUE
+ PROVEN REAL END-TO-END BEHAVIOR
```

من الألف إلى الياء، وبإغلاق نهائي كامل.
