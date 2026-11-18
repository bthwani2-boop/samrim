# MANAGED_PARTICIPANT_ADMISSION — ملف الرحلة الأولى من البداية إلى قبول الإغلاق

ARTIFACT_CLASS: JOURNEY_AUDIT_AND_ACCEPTANCE_DOSSIER
PLAN_OWNER: docs/REFOUNDATION-PLAN.md
JOURNEY_ID: MANAGED_PARTICIPANT_ADMISSION
CAPABILITIES: IDENTITY_ACTIVATION_SESSIONS
SEMANTIC_OWNER: governance/journeys.md
AUTHENTICATION_OWNER: governance/identity.md
IMPLEMENTATION_STATE_AUTHORITY: NONE
JOURNEY_STATUS: IN_PROGRESS
JOURNEY_CLOSED: NO
GOVERNANCE_CUTOVER: NOT_READY
PRODUCTION_ACTIVATION: BLOCKED
AUDITED_AT: 2026-11-18 (Asia/Aden)
AUDITED_BRANCH: codex/managed-participant-admission
AUDITED_HEAD: 0561fea58fba3531c03039690769c86417a1eefd

> **حدود السلطة:** هذا ملف متابعة متطلبات الرحلة وأدلتها وقبولها، مشتق من `governance/journeys.md` وليس مالكًا دلاليًا جديدًا أو خطة منصة موازية. تظل أحكام الهوية في `identity.md`، والمتاجر في `stores.md`، والكباتن في `fulfillment.md`، وطلبات الموظفين في `hr.md`، والسلامة في `safety.md`. يثبت المصدر والعقد وSQL والتشغيل الحالة الفعلية، لا وجود هذه الوثيقة أو اجتياز اختبار منفرد.

## 1. الإجابة المحددة: ما الرحلة وما الذي ليس منها؟

**الدخول:** إنسان واحد له هوية Identity واحدة مثبتة أو قابلة للاستعادة. **القبول:** دور Merchant/Captain/Operator مخوّل بعد شرطه المستقل، ثم جلسة خاصة بذلك الدور. **الخروج:** يدخل التطبيق الصحيح، وتُقرأ الصلاحية والStanding لدى المالك الصحيح، ويمكن سحب الوصول في الوقت المناسب، وبحماية من انتحال هوية أو Store آخر.

**سطوح القبول الأصلية:** OPERATOR، MERCHANT، CAPTAIN. **Customer** اعتماد هوية وتحقق إلزامي ومستخدم مستقل للتطبيق، لكنه ليس سطح قبول رابعًا مضافًا إلى تعداد الرحلة المعتمد. يلزم اختبار تحقق Customer الأساسي لصحة هذه الرحلة؛ ولا يشترط إتمام كل وظائف تطبيق العميل أو الطلبات أو الدفتر.

**خارج حدود إغلاقها:** إنشاء DSH Store ونشره والظهور في البحث، اتفاقيات WLT، الكتالوج، استقبال Order، dispatch، المسار المالي، موظفو التاجر، ورواتب HR. تبقى اختبارات **المنع من الوصول لهذه الموارد دون حقوق** داخل الرحلة. إنشاء Store ونشره يتبع `PARTNER_TO_VISIBLE_STORE`.

**الحالة عند التدقيق:** أجزاء Identity/DSH والعقود والاختبارات المعزولة موجودة، لكن تجربة العميل وOperator وإضافة التاجر والكابتن من لوحة التحكم غير مكتملة؛ مزوّد تحقق الهاتف الحقيقي غير مثبت؛ Passkey الجديد قيد تعديل محلي غير ملتزم في Git؛ ولم تُثبت سلامة Root Owner الأصلي على بياناته الحقيقية. لذلك لا يمكن إعلان الإغلاق.

## 2. مصدر الحقيقة ومكان التنفيذ

| المعلومة | مصدرها المالك | الاستهلاك الصحيح |
| --- | --- | --- |
| القدرة ودخول نطاق المنتج | `governance/product.md`، `IDENTITY_ACTIVATION_SESSIONS` | لا تُنشأ قدرة Product جديدة لهذه الرحلة |
| تعريف الرحلة والخروج | `governance/journeys.md` | المرجع القانوني لعبور الأطراف |
| الهوية والدور والجلسة وRoot/Passkey | `governance/identity.md` ثم `services/identity/backend/internal/session/` | Identity الكاتب الوحيد |
| Captain Standing والقرار الإداري | `governance/fulfillment.md` ثم `services/dsh/backend/internal/captainstanding/` | DSH الكاتب الوحيد للأهلية |
| متجر/عضوية/حقوق Store | `governance/stores.md` ثم DSH | ليس دور Merchant بذاته |
| موظف وعرض وصول Operator | `governance/hr.md` ثم DSH HR | طلب وظيفي لا يمنح Identity permission |
| الأموال | `governance/finance.md` ثم WLT | لا يكتب مالًا في رحلة هوية |
| تطبيق العميل | `apps/customer/src/features/access/` | مدخل تحقق وليس مصدر هوية |
| التاجر | `apps/merchant/src/features/access/` | يستدعي Identity ودور Merchant |
| الكابتن | `apps/captain/src/features/access/` | يستدعي Identity وDSH |
| لوحة التحكم | `apps/control-panel/` | BFF وقراءة الصلاحيات لا إنشاء سلطة مستقلة |
| عقود API | `services/identity/contracts/openapi/` و`services/dsh/contracts/openapi/` | المسارات والتوافق والأخطاء |
| مواصفة هندسية محدودة | `specs/004-identity-session-verification/spec.md` | تغطي Slice من هوية المستخدم؛ ليست كاملة لكل هذه الرحلة |
| القديم للمقارنة فقط | `archive/legacy-pre-refoundation-20261114` عند `426d67b47beb8c66b09acd8c7394086b53ac5aae` | تُنقل الوظيفة الصحيحة بعد مراجعة؛ لا تُنسخ أطر الأمان القديمة |

**انضباط التدقيق:** الأدلة بتاريخ لقطة HEAD أعلاه. ملفات WIP غير ملتزم بها، أو Docker يعمل بإصدار مختلف، أو بيانات أصلية محمية، أو اختبار كان ناجحًا على SHA سابق لا تصبح إثبات قبول لنفس المرشح تلقائيًا.

## 3. تقسيم الدخول الصحيح

| المستخدم | بدء العملية | سلطة الموافقة | حق الدخول والحد الفاصل |
| --- | --- | --- | --- |
| **Customer** | تسجيل أو استعادة بنفسه، مع تحقق حقيقي | Identity | جلسة Customer صالحة، لا أدوار إضافية |
| **Merchant مباشر** | Customer متحقق يقدم بنفسه | Identity يقبل Merchant role بعد تحقق الشخص | Merchant workspace حتى بلا Store؛ لا ملكية أو نشر تلقائي |
| **Merchant بمساعدة المشغّل** | مشغّل يحمل partners ينشئ دعوة/طلبًا ويحدد الشخص | Identity يربط نفس actor بعد أن يُثبت التاجر هويته بنفسه | **نفس مسار Merchant المباشر**؛ ليس حسابًا ثانيًا أو إثباتًا نيابيًا |
| **Captain متقدم أو مضاف من اللوحة** | طلب PENDING لا يعطي العمل، أو مرشح إداري غير مفعّل | Operator يحمل operations يوافق في DSH؛ Identity يفحص نفس actor وAPPROVED | جلسة Captain فقط بعد الاعتماد، ولا حق مهمة أو Store membership من الدور وحده |
| **Operator آخر** | طلب HR مؤهل/دعوة إدارية محمية، لا تسجيل عام | Root الأصلي وملاك Identity/HR كلٌ في حدّه | Passkey متحقق منه وصلاحيات سبع محدودة؛ لا امتياز Root بالعنوان الوظيفي |
| **Root Operator الأول** | إنشاء واحد محمي أو استرداد **نفس actor** بعد تحقق مستقل | Identity وإجراء بشري مصرح | Passkey مع User Verification، استمرار الهوية والحقوق الأصلية، لا Root ثانٍ |

### 3.1 التفريق الذي يمنع أكبر الأخطاء

- **وجود Actor ليس وجود Role**، ووجود Merchant role ليس ملكية Store، ووجود Captain role ليس أهلية تشغيل أو إسناد مهمة، ووجود Operator role ليس صلاحياته السبع.
- **الهاتف صفة قابلة للتحديث وليس actor ID**. المستخدم القديم يُعاد استخدامه؛ تكرار رقم أو دعوة أو طلب دخول لا يصنع Actor جديدًا.
- **ترشيح الموظف لدى HR لا ينشئ Operator account تلقائيًا**. المشغّل الأصلي وحده يملك قبول/رفض الطلب وقرارات grants تحت حوكمة الهوية.
- **الكابتن يقدم PENDING** في التطبيق الحالي، لكن لا يوافق ذاتيًا. إذا كان قرار المنتج المطلوب أن يبدأ المرشح حصريًا من اللوحة، يجب توثيق التغيير في مالك الرحلة قبل تعديل واجهة الطلب؛ يبقى المنع من الموافقة الذاتية ثابتًا.
- إيقاف دور لا يلغي حقوق المستخدم الأخرى إلا بفعل Identity-wide أمني مصرح؛ والتحقق من Owner عند كل استخدام يمنع cache سابقًا أو جلسة قديمة من منح حقوق.

## 4. التحولات المسموحة ونتيجة كل حالة

### 4.1 هوية ودور ومصادقة — Identity

1. `UNKNOWN → VERIFIED_CUSTOMER`: يتحقق الشخص بوسيلة مقبولة، ولا ينشئ التكرار أو إعادة المحاولة حسابًا جديدًا لشخص قائم.
2. `VERIFIED_CUSTOMER → MERCHANT_ACTIVE`: دور جديد لمرة أولى في Identity؛ حالة `ACTIVE` سابقة تعني عودة جلسة مخوّلة، و`SUSPENDED/REVOKED` لا تعود `ACTIVE` بالتسجيل الذاتي.
3. `VERIFIED_CUSTOMER + DSH_APPROVED → CAPTAIN_ACTIVE`: تحقق DSH الحالي بنفس `actorId` قبل إصدار جلسة Captain. العضوية في متجر أو طلب ترشيح معلّق لا تستبدل الاعتماد.
4. `AUTHORIZED_OPERATOR_ADMISSION → OPERATOR_ACTIVE`: مسار دعوة واعتماد محمي مع هوية مشغّل حقيقية، يليها WebAuthn مع `userVerification=required`؛ لا تسجيل عام.
5. `SESSION_ACTIVE → EXPIRED/REVOKED`: تتحقق Identity من digest/version/actor/role/expiry عند كل طلب، وتمحو الجلسات القديمة أو ترفضها عند الإبطال؛ لا قبول من واجهة أو Header.
6. عند تبديل actor أو الدور أو Store أو جهاز، تُعزل Cookies/SecureStore والـcache ومطالبات GET/POST المعلّقة. لا ترفع جلسة Customer إلى Operator ولا تعيد استخدام session-role غير صالح.

### 4.2 الكابتن — DSH هو مالك Standing

| حالة | معناها | نتيجتها |
| --- | --- | --- |
| `PENDING` | طلب فقط، لم يُعتمد | لا دخول تشغيل كابتن |
| `APPROVED` | قرار Operations مخوّل محفوظ في DSH | يجوز لـIdentity إصدار Captain role/session للشخص المطابق |
| `SUSPENDED` | تعليق أهلية حالية | منع الدخول والعودة والعمليات المقيدة |
| `REVOKED` | إبطال الأهلية | لا تجديد ذاتي ولا إحياء بمجرد إعادة طلب أو Store invitation |

يجب أن يثبت قرار DSH هوية المشغّل الحالية وصلاحية `operations`، والسبب، والنسخة المتوقعة، والتزامن، والـidempotency، وأثر التدقيق؛ ثم تقرأ Identity الحالة الحية ذاتها. لا تنقل كاتب Standing إلى Identity أو تطبيق الكابتن.

### 4.3 المشغّل الأصلي — لا تعني عبارة Root امتيازًا سحريًا

- **واحد فقط:** Root marker/actor واحد يتم إنشاؤه مرة واحدة من إجراء تأسيسي محمي؛ لا يُصنع Root بديل لتسهيل تطوير واجهة الدخول.
- **سبع صلاحيات فقط:** `operations`، `partners`، `catalog`، `marketing`، `finance`، `hr`، `platform_policies`. لا تمنح إحداها السلطة على الأخرى، ولا يمنح `finance` أو `platform_policies` حق إنشاء Operator أو التحكم في grants.
- **السلطة:** Root الأصلي هو من يوافق/يرفض طلب Operator HR ويمنح/يلغي الصلاحيات المسجلة مع `expectedVersion` وسبب وoperationId وتدقيق غير قابل للتلاعب، ويُبطل الجلسات المتأثرة. HR employee record وحده ليس إذنًا.
- **الدخول:** Passkey مع تحقق المستخدم وتحدٍّ أحادي الاستخدام، RPID وOrigin مضبوطين، توقيع متحقق منه، عداد مصادِق ومؤشر clone محسوبان، جلسة Identity محمية؛ لا كلمة مرور تطويرية عن بُعد أو SMS كبديل للمشغّل.
- **الاسترداد:** تحقق أولًا من **actor الأصلي في مصدر Identity المحمي** ومن الاعتمادات المسجلة حاليًا؛ تقرير 2026-10-29 تاريخي وغير كافٍ. الحصول على إذن صاحب الحق، إثباتات شخصية مستقلة، وسيلة Passkey جديدة موثقة، خطة احتياطية، إبطال العوامل والجلسات المتأثرة، سجل مراجعة وحالة SQL دائمة. **لا** تزوير WebAuthn أو إدخال Credential في بيانات Root الحقيقية من الاختبار.
- **المانع:** لم يثبت استرداد Root الأصلي ولا وجود/غياب Passkey لديه اليوم. الحالة `BLOCKED / NOT_PROVEN` حتى قراءة مأذونة وإجراء اعتماد حقيقي، لا تُغيّر لمجرد نجاح اختبار توقيع اصطناعي.

## 5. تدقيق الشيفرة والعقود والمستهلكين الحية

| المكوّن / نقطة الدخول | نتيجة قراءة المصدر عند HEAD | الحالة |
| --- | --- | --- |
| `apps/customer/src/features/access/identity-gate.tsx` | شاشة عدم توفر تحقق Identity، لا تدفق تسجيل فعلي للعميل | NOT_COMPLETE |
| `apps/merchant/src/features/access/identity-gate.tsx` و`admission-transport.ts` | طلب تحقق هاتف/تسجيل دور/عودة/Standing عبر بيئة معزولة وبيانات تطوير | PARTIAL |
| `apps/merchant/app/apply.tsx` و`app/setup.tsx` | صفحات تعرض مكونات إعداد/تقديم؛ لا إثبات إنشاء متجر حقيقي ضمن الرحلة | PARTIAL |
| `apps/captain/src/features/access/identity-gate.tsx` و`admission-transport.ts` | طلب `PENDING` وقراءة DSH وإصدار دور بعد الموافقة؛ أصل الاتصال اصطناعي | PARTIAL |
| `apps/control-panel/src/features/access/operator-entry-screen.tsx` | شاشة دخول مغلقة عمدًا حتى توفر مصادقة مقبولة | NOT_COMPLETE |
| `apps/control-panel/src/features/access/operator-workspace-gate.tsx` | لا يعرض محتوى Workspace أو Private navigation دون قبول Operator | NOT_COMPLETE |
| `apps/control-panel/app/api/auth/session/route.ts` | API session يعيد عدم الجاهزية؛ لا BFF جلسة إنتاجية | NOT_COMPLETE |
| `apps/control-panel/app/(workspace)/merchants/new/page.tsx` | واجهة إضافة تاجر لا تنفذ دورة الدعوة/القبول | NOT_COMPLETE |
| `apps/control-panel/app/(workspace)/captains/page.tsx` | واجهة الكباتن لا تنفذ الدورة الإدارية كاملة | NOT_COMPLETE |
| `apps/control-panel/app/(workspace)/access/page.tsx` | واجهة الوصول لا تنفذ قبول Operator متصلًا بالمصادقة | NOT_COMPLETE |
| `services/identity/backend/internal/session/` + `services/identity/clients/index.ts` | التحقق من الجلسة، Merchant/Captain role admission، Permission read/command وPhone synthetic | PARTIAL |
| `services/dsh/backend/internal/captainstanding/` | طلب Captain وقرار Standing المخوّل، SQL واختبارات | PARTIAL |
| `services/identity/backend/internal/session/operator_passkey_*.go` + SQL 006 | WebAuthn الموقّع وتجربة اصطناعية، لكنها محلية غير ملتزم بها في لقطة HEAD | UNCOMMITTED_LOCAL_WORK |
| `services/identity/contracts/openapi/` و`services/dsh/contracts/openapi/` | عقود owner، لا تُثبت وحدها وصول تطبيق أو تفعيل مورد محمي | PARTIAL |

**حواجز تشغيل مقصودة وليست أخطاء تُحذف:** يشترط `services/identity/backend/cmd/identity/main.go` وضع الاختبار `BTHWANI_ISOLATED_TEST_MODE=true` وSchema من نمط `identity_test_*`؛ بعض الوظائف خلف `IDENTITY_SYNTHETIC_PHONE_AUTH` و`IDENTITY_ENABLE_ISOLATED_CAPTAIN_ADMISSION` و`IDENTITY_ENABLE_ISOLATED_OPERATOR_PERMISSION_ADMIN` و`IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH`. يرفض DSH Captain Standing العمل خارج شروط العزل. لا يُفتح المنفذ الإنتاجي بإلغاء هذه القيود.

### 5.1 المصدر القديم، للمقارنة وليس للنسخ

عند `archive/legacy-pre-refoundation-20261114`، توجد آثار فعلية للمسارات التالية:

| المصدر المؤرشف | الوظيفة الصحيحة الواجب الحفاظ عليها | القرار |
| --- | --- | --- |
| `apps/app-client/src/features/access/identity-gate.tsx` | العميل يسجل ويدخل ويستعيد هويته | ADAPT إلى Identity الجديد، لا نسخ session/password بلا مراجعة |
| `apps/app-partner/app/apply.tsx` | Merchant يبدأ بنفسه | KEEP_BEHAVIOR دون شرط Store أولًا |
| `apps/control-panel/app/api/partners/joining-cases/route.ts` | إضافة/متابعة تاجر مساعد | ADAPT كدعوة أو طلب واحد لدى المالك، لا حساب موازٍ |
| `apps/control-panel/app/api/captains/route.ts` | ملف مرشح وإجراء قبول إداري | ADAPT إلى DSH approval وIdentity role |
| `apps/control-panel/app/api/access/operator-profiles/[profileId]/route.ts` | طلبات Operator ودعواته | ADAPT بعد Root/HR/Passkey من سلطة حقيقية |

لا تنقل محرك مستخدمين آخر، أو سلطة مالية، أو أذونات قديمة، أو كود JWT/كلمة مرور غامض إلى المصدر الجديد. التقرير التاريخي عن Root لا يثبت أنه بلا عامل مصادقة في التشغيل الحالي.

## 6. العقود والحدود التنفيذية التي يجب اختبارها

| عقد حالي أو واجهة مطلوبة | المالك | قاعدة القبول |
| --- | --- | --- |
| `GET/DELETE /v1/sessions/current` | Identity | هوية/دور حي وإبطال bearer واحد |
| Customer synthetic phone challenge وverify | Identity | للاختبار المعزول فقط، وليس مزود SMS حقيقيًا |
| `POST /v1/actors/me/merchant-role` والعودة | Identity | نفس Customer actor المتحقق، لا Store grant |
| `POST /v1/actors/me/captain-role` والعودة | Identity بعد قراءة DSH | لا إصدار إلا `APPROVED` حاليًا |
| `POST /v1/actors/me/captain-application` | DSH | PENDING فقط |
| `PATCH /v1/operators/captains/{actorId}/standing` | DSH | عمليات مشغّل مخوّل + تحقق إصدار + audit |
| `PATCH /v1/operators/{actorId}/permissions/{permission}` | Identity | Root الأصلي فقط + إصدار وسبب ودليل إبطال |
| `/v1/operators/passkey/authentication/options` و`/authentication` | Identity | تنفيذ محلي معزول وغير مثبت على المرشح المنشور/Root |
| Merchant assisted invite / Operator HR access | Identity + DSH حسب الحقيقة | لا شهادات هوية نيابية أو صلاحيات ناشئة من واجهة |
| Store creation/publication وWLT agreements | DSH / WLT | **خارج** نتيجة هذه الرحلة؛ يجب إثبات منع الوصول غير المخول |

**الأثر الدائم الصحيح:** كل Mutation يجب أن يترك هوية واحدة، حالة Role/Permission/Standing واحدة بالإصدار المتوقع، وسجل تدقيق واحد عند اللزوم؛ وعند فشل HTTP أو timeout يُقرأ Owner قبل retry. لا يعوّض HTTP 200 أو Mock أو شاشة سليمة الإثبات المستقل من SQL.

## 7. مصفوفة القبول الإلزامية من الألف إلى الياء

**قاعدة الإثبات:** كل `AC` قابل للتطبيق يحتاج سلوكًا موجبًا وآخر سالبًا، مسار/عقد المالك، اختبارًا قابلًا للإعادة، قراءة حالة دائمة، المرشح النهائي `SHA` ونسخة runtime المطابقة. قبل اكتمال هذه الأدلة الحالة `NOT_RUN` أو `BLOCKED` أو `FAIL`، حتى لو يوجد كود أو اختبار Slice منفصل. **لا يوجد PASS للرحلة كاملة حتى الآن**.

| AC | المتطلب ← النتيجة القابلة للاختبار | المالك والدليل المطلوب | الحالة عند التدقيق |
| --- | --- | --- | --- |
| AC-01 | Customer جديد يثبت هاتفه/هويته دون انتحال | Identity HTTP+SQL + Customer Web/Android | NOT_RUN |
| AC-02 | Customer قائم أو رقم مكرر يعود إلى نفس actor دون تكرار | Identity actor/unique proof + parallel retries | NOT_RUN |
| AC-03 | رمز خاطئ/منتهي/مستخدم مرتين أو مزوّد معطل لا ينشئ دورًا | Identity phone proof state + error tests | NOT_RUN |
| AC-04 | Customer يدخل، يخرج، يستعيد الحساب ويبدّل جهازه بأمان | Customer device + Identity revocation/recovery | NOT_RUN |
| AC-05 | Merchant مباشر من verified Customer يصل Workspace | Identity role/session + Merchant Web/Android | NOT_RUN |
| AC-06 | تكرار أو تعليق Merchant لا يعيد تفعيل role ولا يخلق جلسات متعددة | Identity concurrency, suspended/replay readback | NOT_RUN |
| AC-07 | Merchant بلا Store يمكنه دخول مساحة الدور، ولا يقرأ Store غريبًا | Identity + DSH IDOR + Web/Android | NOT_RUN |
| AC-08 | تاجر يبدأ من لوحة التحكم بدعوة، ثم يثبت هويته بنفسه | Operator `partners` + Identity + DSH case | NOT_RUN |
| AC-09 | دعوة تاجر مكررة/منتهية/منقطعة لا تنتج Actor أو Store إضافيًا | Identity/DSH idempotency and recovery | NOT_RUN |
| AC-10 | Captain يقدم `PENDING` ولا يحصل على دخول عمل | DSH standing + Identity denial | NOT_RUN |
| AC-11 | فقط Operator `operations` يقر حالة Captain مع تدقيق | DSH authz/CAS/audit + Identity verifier | NOT_RUN |
| AC-12 | Captain `APPROVED` لنفس actor يدخل تطبيقه بجلسة الدور | Captain Android + Identity/DSH SQL | NOT_RUN |
| AC-13 | Captain `SUSPENDED/REVOKED` يُرفض فورًا في الدخول والعودة | DSH standing + Identity + Android denial | NOT_RUN |
| AC-14 | Store membership لا تمنح دور Captain العام ولا تعيد تعليقًا | DSH membership + Identity role negative | NOT_RUN |
| AC-15 | تبديل actor/Role/Store لا يسرّب بيانات أو صلاحيات جلسة قديمة | Identity + DSH/WLT denied cross-account + UI cache | NOT_RUN |
| AC-16 | Operator لا يستطيع تسجيل نفسه من صفحة عامة ولا من HR record وحده | Identity deny + protected HR request | NOT_RUN |
| AC-17 | Root actor أصلي واحد؛ لا إنشاء ثانٍ أو استبدال Actor ID | تحقق **محمي مأذون** في Identity ومصدر حقوقه | BLOCKED |
| AC-18 | Operator الحقيقي يدخل بـPasskey UserVerification required | Authenticator/browser + Identity owner credential/session | NOT_RUN |
| AC-19 | RPID/Origin/challenge/ES256 signature/userHandle مزورة تُرفض | WebAuthn native & browser + SQL/audit | NOT_RUN |
| AC-20 | إعادة استخدام challenge أو sign counter clone تُبطل/ترفض | SQL CAS/replay/concurrent + session invalidation | NOT_RUN |
| AC-21 | طلب Operator عبر HR يراجع، يُرفض/يُقبل من Root، ولا يتكرر | DSH HR + Identity actor/role/audit | NOT_RUN |
| AC-22 | Root يضيف Operator آخر ويمنحه subset من 7 scopes فقط | Identity role/permission SQL + Controller UI | NOT_RUN |
| AC-23 | غير Root ولو امتلك `finance` و`platform_policies` لا يدير grants | Identity negative authz and audit | NOT_RUN |
| AC-24 | تعديل/سحب Scope له `expectedVersion` وسبب وoperationId ويبطل الجلسات | Identity concurrency/idempotency/version readback | NOT_RUN |
| AC-25 | استرداد Root يحفظ Actor الأصلي ويستخدم تفويضًا بشريًا موثقًا | Protected Identity proof + security review | BLOCKED |
| AC-26 | تعطل جهاز/Authenticator أو فقدانه لا يفتح كلمة مرور/SMS بديلًا عاديًا للمشغّل | Recovery negative + device/user verification | NOT_RUN |
| AC-27 | دخول Operator BFF لا يعرّض bearer في URL/JS/cache/log | Web cookies HttpOnly/Secure/SameSite + CSRF/Origin | NOT_RUN |
| AC-28 | انتهاء/إبطال role وsession يوقف كل شاشة وعملية مؤثرة | Identity+DSH+WLT checks + browser/Android | NOT_RUN |
| AC-29 | timeout/retry/parallel admit لا يكرر Actor/Role/Standing/audit | Real isolated PostgreSQL + independent owner readback | NOT_RUN |
| AC-30 | عقد Identity/DSH، SQL migrations، client schemas والأخطاء متفقة | OpenAPI parser, migration tests, Go/TS tests | NOT_RUN |
| AC-31 | صور التشغيل وتطبيقات Web/Android تطابق المرشح النهائي | Git HEAD+Docker image SHA+runtime + device | INVALIDATED |
| AC-32 | UX فعلي: RTL، تنقل، error/retry، تسجيل/خروج/عودة على الأجهزة المعنية | Customer/Merchant/Captain Android + Operator Web E2E | NOT_RUN |
| AC-33 | لا يمس الاختبار Root أو حسابات/أسرار/أموال أشخاص حقيقيين | Isolated DB provenance + protected-state safety | NOT_RUN |
| AC-34 | مراجعة حرجة للأمان والهجرة والاعتماديات على نفس SHA | Review findings/CodeQL/Sonar/audit and closure | FAIL |

**ملحوظة:** `PARTIAL` يصف تنفيذًا جزئيًا داخل أقسام الأدلة أدناه، لكنه **ليس قبولًا لـAC**. يُحوَّل كل صف قابل للتطبيق إلى `PASS` فقط عند تحقق جميع أدلته على المرشح النهائي. `N/A` لا يستعمل إلا بمبرر مالك مثبت يوضح لماذا لا ينطبق الاختبار دون إخفاء مخاطره.

### 7.1 اختبارات الخطر السلبية التي لا يمكن استبدالها بلنت أو Mock

1. **Identity:** Actorان مختلفان برقم/جهاز وجلسات منفصلة، حساب موجود وجديد، رمز خاطئ أو منتهي، رقم مكرر، تغيير هاتف، Session expiry/revoke وreplay، تبديل الدور في منتصف GET/POST.
2. **Merchant:** قبول متزامن 12 مرة، دور موجود أو معطل، مسار Direct وAssisted يؤديان إلى **نفس actor**، دعوة منتهية وموظف يحاول التحقق نيابة عن التاجر، غياب Store، Store IDOR.
3. **Captain:** Pending لا يعمل، Operator بلا operations، expectedVersion قديم، operationId مكرر، طلبات approve متزامنة، تعليق أثناء الجلسة والعودة، Store Captain غير مخول ككابتن منصّة.
4. **Operator:** Login عام ممنوع، Root آخر ممنوع، انتحال Root بالهيدر/الكوكي، Finance فقط أو Policies فقط لا يديران صلاحيات، تسجيل/انتحال HR بلا إثبات Identity، تعارضات grants، audit immutable.
5. **WebAuthn:** توقيع ECDSA مزوّر، challenge قديم/مكرر، Origin وRPID مختلفان، UV غير موجود، userHandle آخر، counter clone وAuthenticator مفقود، password/SMS fallback ممنوع عن بعد.
6. **التحمّل:** قطع الشبكة بعد commit وقبل الرد، Timeout من Identity/DSH، إعادة محاولة مرتين في آن، فشل إخراج الشاشة/استعادة الجهاز، لا تعتبر نتيجة Unknown نجاحًا أو تكرر الأثر.
7. **الخصوصية:** OTP وBearer وrecovery proof غير موجودة في logs أو URL أو frontend storage، Client cache خاص بالActor/Store، Owner SQL ودور الجلسة لا يُستنتجان من Display Name أو Header.
8. **التشغيل:** عقد/Schema/Image/Commit واحد، Android device وليس Expo Web فقط، Operator Browser مع FIDO2 حقيقي وليس Fake/WebAuthn Test بدون دليل توقيع.

## 8. سجل التدقيق والأدلة المقروءة لهذه اللقطة

### 8.1 ما تحقق من تشغيل أدوات الفحص

| الأداة | الدليل | النتيجة المحددة |
| --- | --- | --- |
| Native Spec Kit CLI | `specify version` = `1.3.0`، قراءة `specs/004-identity-session-verification/spec.md` | PASS لتشغيل CLI، NOT_COMPLETE لتغطية كل رحلة |
| LOCAL Graphify | `graphify 0.9.73+samrim.3`، استعلام Identity/Merchant/Captain/Operator عبر `graphify-out/graph.json` | `built_at_commit` مطابق للـHEAD **المتتبَّع** عند التدقيق: 0561fea58... |
| Graphify تجاه dirty | ملفات Identity Passkey المحلية غير ملتزم بها | INVALIDATED كدليل أثر على هذه الملفات؛ لا تلقائية لإعادة فهرسة أو صلاحيات |
| Current Identity Go | handler وعميل session/merchant/captain/permissions | SOURCE_PRESENT، وليس قبول رحلة Browser |
| Current DSH Go | captainstanding HTTP/SQL وaudit/tests | SOURCE_PRESENT، لا اعتماد حي داخل لوحة التحكم |
| GitHub required checks | `gh api repos/bthwani2-boop/samrim/commits/0561fea58.../check-runs` | Go/Fast-Guard/Foundation/Presentation نجحت؛ **Dependency audit + CodeQL + SonarQube FAIL** |
| CodeRabbit | GitHub check في لقطة HEAD نجح | لا يُثبت تغطية ملفات Passkey **غير الملتزم بها** أو مراجعة Root محمية |
| Real Authenticator | اختبارات اصطناعية على PostgreSQL كانت سابقة لهذا الفحص | لا تستعمل PASS لRoot الحقيقي أو مرشح نهائي؛ مطلوب إعادة إثبات بتاريخ/SHA صالح |

### 8.2 فجوات متحققة

- **Customer:** `apps/customer/src/features/access/identity-gate.tsx` لا يتصل بالتسجيل الحقيقي.
- **Merchant:** تطبيق جزئي؛ مزوّد الهاتف الحالي synthetic، وواجهة إضافة التاجر من اللوحة لا تنفذ دعوة/قبولًا حقيقيًا. لا تخلط مع Store creation.
- **Captain:** DSH وIdentity يعالجان PENDING/APPROVED ضمن العزل؛ شاشة لوحة التحكم لإضافة/اعتماد الكباتن ليست رحلة بشرية متصلة مكتملة.
- **Operator:** صفحة الدخول و`/api/auth/session` مغلقتان عمدًا؛ Root الحقيقي واستعادة وصوله لم يُثبتا.
- **Passkey:** ملفات Go وSQL 006 واعتماديات Go/OpenAPI متغيرة محليًا وغير موجودة كاملة في HEAD المنشور؛ الاختبارات السابقة على نسخة WIP ليست جاهزية تشغيل.
- **CI وأمان:** عدة checks فاشلة على HEAD الجاري. لا تعطيل audit أو تجاوز CodeQL/Sonar حتى لو نجح فحص Foundation.
- **تطابق التشغيل:** لا دليل بأن نسخ Lenovo والخدمات والتطبيقات ومهاجراتها تساوي هذا SHA؛ حالة Docker `healthy` وحدها غير كافية.

## 9. القرارات المفتوحة وحدود صلاحيتها

| النقطة | مالك القرار | الوضع الآمن حتى الإثبات |
| --- | --- | --- |
| هل يبدأ طلب Captain ذاتيًا أم فقط عبر اللوحة؟ | Product عبر `governance/journeys.md`، وDSH لStanding | لا self-approval؛ طلب PENDING لا يمنح دورًا |
| الطريقة التشغيلية النهائية للتحقق من رقم Customer واستعادة حسابه | `governance/identity.md` | Synthetic للتطوير فقط، لا حذف حسابات سابقة |
| إثبات actor/Passkey/Recovery Root الحقيقي | Identity + صاحب الحساب وإذن محدد + مراجعة أمنية | BLOCKED، لا Root جديد ولا bypass |
| Merchant assisted onboarding دون حساب مكرر | Identity + DSH مع Operator partners | دعوة/طلب فقط، لا هوية أو ملكية متجر نيابة عن الشخص |
| تطبيق Controller BFF وتبديل جلسة Operator | Identity و`apps/control-panel` | شاشات محجوبة لا دخول وهميًا |
| نسخ runtime/مرشح مقبول | Engineering/Environment owner | لا الادعاء بالتطابق قبل قراءة SHA لكل جزء |

## 10. تسلسل تسليم قابل للإغلاق دون إنشاء محركات موازية

**A — إثبات النطاق والمالك:** جرد كل مسار سابق وحالي ومستهلكه ومالك البيانات؛ ربط المتطلبات الحالية بقدرة `IDENTITY_ACTIVATION_SESSIONS` فقط؛ عدم إسقاط حقوق أو حسابات قديمة.

**B — استكمال Customer identity dependency:** اعتماد مزوّد تحقق حقيقي صالح، تعرف على actor قائم ومنع التكرار، جلسة وتسجيل خروج واستعادة وتبديل جهاز على Web/Android. لا تضف Customer admission journey ثانية.

**C — Root وOperator:** تحقق مأذون من Root الأصلي؛ Passkey/UV، الاسترداد المحمي؛ HR request ثم Root approval ثم Identity role/perms؛ BFF Cookie آمن ثم Workspace، وسحب الصلاحيات وإبطال الجلسة.

**D — Merchant:** Direct self-role وAssisted invitation عبر نفس Identity؛ دخول Web/Android بدون Store، Owner DSH denies cross-store، لا توليد Store من مجرد Role.

**E — Captain:** طلب/إضافة، DSH standing عبر Operations، إصدار Identity role، Native Android login، suspension/revocation/re-entry والفشل/التزامن. لا تلجأ إلى Store membership كاختصار.

**F — مرشح التكامل النهائي:** حصر الملفات وWorktree، إغلاق تغيرات المستهلكين وOpenAPI وSQL، تنفيذ real synthetic two-server HTTP/SQL ثم UX على الأجهزة، negative/retry/concurrent/IDOR، تحقق من runtime source/image SHA، مراجعة أمنية مستقلة، نجاح CI required على **المرشح النهائي**.

**G — مراجعة الإغلاق:** لا تغيير `JOURNEY_CLOSED` إلى YES إلا بعد إثبات كل AC على نفس المرشح، قبول صحة المنتج وأمانه وتوافقه، والتأكد من عدم فشل Gate إلزامي. افصل الإغلاق عن `GOVERNANCE_CUTOVER` و`PRODUCTION_ACTIVATION`.

## 11. نموذج دفتر الأدلة قبل أي PASS

| الحقل | القيمة الحقيقية المطلوبة |
| --- | --- |
| AC identifier | مثل AC-11 |
| Exact source branch/commit | SHA كامل، لا اسم فرع |
| Owner/API/data | Identity أو DSH أو WLT مع المسار والعقد |
| Runtime provenance | Docker image/migration SHA، Web/Android build |
| Positive and negative assertion | حالة حقيقية واختبار رفض، لا شاشة مجردة |
| Durable readback | نسخة الدور/Standing/التدقيق من مالك مستقل |
| Failure and concurrency | Test command/result أو NOT_RUN صريح |
| Review and validity | مراجع فعلي، تاريخ، ما يبطل الدليل |
| Verdict | PASS / FAIL / BLOCKED / NOT_RUN / INVALIDATED / REVIEW_BLOCKED |

## 12. حكم إغلاق الرحلة — شروط تراكمية لا نسب تجميلية

- [ ] جميع AC-01 إلى AC-34 القابلة للتطبيق **PASS**، وأي عدم انطباق مبرر من مالك الحقيقة وليس استثناءً يخفي فشلًا.
- [ ] لا هوية/دور/صاحب متجر/مسؤولية مال موازية؛ جميع العمليات محمية بهوية ودور وStanding/Scope حي.
- [ ] حساب Root الأصلي واستمرار Actor/Passkey/Recovery ثبت بإذن وقراءة محمية ومراجعة أمنية فعلية.
- [ ] Customer dependency وMerchant direct/assisted وCaptain approved وOperator login تعمل بالفعل على Web/Android، مع خروج/عودة/تعليق.
- [ ] Replays، IDOR، نفي الصلاحيات، races، expiry/recovery وقطع الاتصال ثبتت من المصدر إلى SQL الدائم.
- [ ] أحدث runtime للخدمات والمهاجرات والتطبيقات = مرشح واحد مثبت SHA، لا ادعاء من مجرد Go test أو `healthy`.
- [ ] فحص الاعتماديات وCodeQL/Sonar وrequired checks ومراجعة الأمن الحرجة على SHA النهائي PASS بلا إسكات تحذيرات.
- [ ] Spec Kit وGraphify المحلي صالحان للمرشح، وملفات WIP أو فهرس قديم لا تُستعمل كإثبات نهائي.
- [ ] مراجعة صحة المنتج وأمنه وجودة التنفيذ موثقة دون ادعاء مراجعة مستقلة غير منفذة.
- [ ] بعد ذلك فقط يسجل `governance/journeys.md` إغلاق هذه الرحلة. يظل `PRODUCTION_ACTIVATION` مستقلًا، ولا يترتب Merge أو تفعيل محمي أو تغيير `GOVERNANCE_CUTOVER` تلقائيًا.

**حكم التدقيق:** `JOURNEY_STATUS: IN_PROGRESS` — `JOURNEY_CLOSED: NO` — `ROOT_PROTECTED_CONTINUITY: BLOCKED/NOT_PROVEN` — `CI_REQUIRED: FAIL` — `FULL_WEB_ANDROID_E2E: NOT_RUN` — `GOVERNANCE_CUTOVER: NOT_READY` — `PRODUCTION_ACTIVATION: BLOCKED`.

> **قاعدة الـ100%:** نسبة الإنجاز لا تُستنتج من عدد الملفات أو الاختبارات الخضراء. معيار الإغلاق الوحيد هو اكتمال **كل** شرط قبول قابل للتطبيق، بأدلة حديثة من المالك الحقيقي والتطبيق والجهاز وCI على مرشح واحد.
