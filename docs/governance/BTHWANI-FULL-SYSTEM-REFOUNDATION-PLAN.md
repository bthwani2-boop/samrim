# إعادة تأسيس بثواني من الصفر — الخطة الهندسية المعتمدة للعمل

ARTIFACT_CLASS: NON_AUTHORITATIVE_REFOUNDATION_EXECUTION_PLAN
SEMANTIC_OWNER: docs/governance/BTHWANI-FULL-SYSTEM-REFOUNDATION-PLAN.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CREATED: 2026-11-10
WORKTREE: `D:\samrim-governance-refoundation-20261110`

> **حدود الوثيقة:** تسجّل هذه الوثيقة المنهج المقترح لإعادة تأسيس بثواني الذي حدّده صاحب المشروع، مع نتائج تدقيق أولية مقيّدة بتاريخها. ليست بديلًا عن `AGENTS.md` أو `REPOSITORY-STRUCTURE.md` أو الملاك القانونيين المحددين في `docs/governance/README.md`، ولا تمنح إذنًا مستقلًا بالحذف أو تشغيل عمليات خارجية أو النشر أو الدمج. الشيفرة والعقود والتكوين وحالة التشغيل هي مصدر إثبات التنفيذ الفعلي.

## 1. القرار الهندسي والتسمية التقنية

بناءً على التدقيق المباشر لبيئة المشروع، وعلى توضيح صاحب المشروع أن بثواني ما زالت في **مرحلة التطوير المحلي** وأن بياناتها التجريبية يمكن إعادة إنشائها بعد إثبات نطاقها وعزلها، فإن المنهج المقترح هو **إعادة بناء جذرية بأسلوب Greenfield داخل المستودع القائم**.

**التسمية التقنية:**

**BThwani Greenfield-Style Full-System Re-engineering & Re-architecture**

**المنهج التنفيذي:**

**Clean-Slate Architecture + Fresh Database Baselines + Contract-Driven Rebuild + Automated End-to-End Verification**

هذه تسمية مركّبة تصف طريقة العمل، وليست معيارًا رسميًا واحدًا أو ضمانًا لسرعة أو دقة 100%.

لسنا ملزمين بالحفاظ على مخططات SQL القديمة، أو تاريخ هجرات التطوير الذي يجوز إعادة تأسيسه بأمان، أو شيفرة Backend وFrontend المعيبة، أو ملفات YAML والتكوين المتضخمة. في المقابل، نحتفظ بهوية المنتج، والوظائف التجارية المطلوبة، وحدود ملكية البيانات، والعقود الخارجية التي ما زالت مستخدمة.

**الهدف هو بناء أبسط نظام صحيح، وليس الحفاظ على أكبر كمية من الشيفرة أو إعادة كتابة أكبر كمية منها.**

## 2. نتائج التدقيق المباشر — لقطة 2026-11-10

تم فحص البيئة التالية:

`D:\samrim-governance-refoundation-20261110`

| المجال | نتيجة الفحص الأولي |
| --- | --- |
| المستودع | Worktree فعلي مرتبط بمستودع بثواني |
| حجم الشيفرة | نحو 2,505 ملفات متتبعة وقت الجرد |
| SQL | 267 ملفًا، منها 266 ضمن هجرات الخدمات |
| YAML / YML | 45 ملفًا |
| Backend | خدمات Identity وDSH وWLT |
| Frontend | ثلاثة تطبيقات Expo ولوحة تحكم |
| الحوكمة | أعيد تنظيمها، مع بقاء بعض المراجع القديمة أو المتكررة |
| فحوص الحوكمة وحدود الاستيراد | PASS لنطاق الاختبارات المنفذة |
| Docker | سبع حاويات `samrim-local` كانت تعمل وتبلغ عن Healthy وقت الفحص |
| اختبار الرحلات الكاملة على مرشح إعادة التأسيس | NOT_RUN |
| إثبات صلاحية هدم جميع وحدات تخزين Docker | NOT_VERIFIED |

كشف التدقيق أن فحص الحوكمة نجح رغم وجود مرجع قديم في وثيقة المنتج وتكرار مرجع في وثيقة الهندسة. لذلك ينبغي اختبار **جودة معايير الفحص نفسها**، وعدم اعتبار نجاح الفحص الآلي شهادة بأن كل الوثائق أو الشيفرة صحيحة.

هذه **لقطة تدقيق أولية**، لا إحصاءات دائمة، ولا شهادة بفحص جميع ملفات SQL أو جميع الوظائف والأجهزة. يجب إعادة قراءة Git وDocker وحالة التشغيل قبل أي تغيير مؤثر.

## 3. المعنى العملي لإعادة التأسيس

نريد إعادة تأسيس النظام تقنيًا وبرمجيًا وهيكليًا، دون إلزام أنفسنا بالاحتفاظ بالشيفرة أو الملفات أو مخططات قواعد البيانات الحالية.

يشمل النطاق:

- قواعد البيانات وملفات SQL والهجرات والاستعلامات.
- خدمات Backend ومنطق الأعمال والعقود البرمجية.
- تطبيقات Expo ولوحة التحكم ونظام التصميم.
- ملفات YAML/YML وDocker والتكوين والتشغيل.
- الصلاحيات والأمان والاختبارات والتكاملات.
- بنية المستودع والحزم والأدوات والحوكمة.

يمكن استبدال معظم هذه المكونات أو إزالتها وإعادة إنشائها **إذا أثبتت المعمارية المستهدفة أن ذلك أبسط وأصح**.

لا نفقد القواعد التجارية الصحيحة أو هوية المنتج أو الالتزامات الخارجية المعتمدة بسبب إعادة كتابة الشيفرة. ولا ننشئ محركات متنافسة لنفس الوظيفة: تبقى الحدود القانونية بين Identity وDSH وWLT كما يحددها المالك المعتمد، ولا تبرر العلاقة `BTHWANI_PARTNER` أو `INDEPENDENT_STORE` محرك متاجر أو طلبات أو مالية موازيًا.

## 4. خصوصية وضع بثواني: تطوير محلي قابل لإعادة الإنشاء

بثواني في مرحلة التطوير المحلي، ولم تعتمد بعد مرحلة إنتاج مشتركة. لذلك يمكن الاستفادة من **Fresh Baseline / Clean Bootstrap** بدل ترحيل كل بيانات التطوير التجريبية أو الإبقاء على تراكمات هجرات غير معتمدة.

| المجال | طريقة إعادة التأسيس |
| --- | --- |
| SQL | إنشاء مخطط أساسي نظيف لكل مالك بدل تكديس إصلاحات على تاريخ تجريبي متضخم |
| PostgreSQL | إنشاء قاعدة تطوير جديدة فارغة وإعادة بناء الحد الأدنى من بيانات الاختبار اللازمة |
| Docker | إعادة إنشاء الحاويات ووحدات التخزين التجريبية المحددة بعد إثبات العزل والملكية والتبعات |
| Backend | بناء المكونات الصحيحة انطلاقًا من الوظائف والعقود المعتمدة |
| Frontend | إعادة تأسيس بنية الواجهات وتجربة الاستخدام ونظام التصميم |
| YAML والتكوين | إنشاء تكوين موحد وقابل للتكرار بأقل تعقيد |
| الاختبارات | بناء اختبارات موثوقة تثبت النتيجة الحقيقية، بما فيها الفشل والتزامن |

**حدود إعادة الإنشاء:**

- لا يُحذف تاريخ هجرات مدمج في `main` أو مطبق على حالة يجب الاحتفاظ بها دون حد إعادة تأسيس آمن ومصرّح به. الهجرات الجديدة لكل مالك تنشأ في المصدر القانوني الواحد.
- الإذن باعتبار البيانات المحلية تجريبية لا يثبت وحده أن **كل** سجل أو وحدة تخزين أو حساب أو وسيط مشترك قابل للحذف.
- لا تشمل إعادة إنشاء البيانات التجريبية حذف الأسرار أو هويات تطبيقات Expo/EAS أو التوقيع أو ربط مقدمي الخدمات، ولا إسقاط حساب المشغّل المحمي لتسهيل الاختبارات.
- توجد وحدات تخزين لمشاريع Docker بأسماء مختلفة، منها `samrim-local` و`samrim-remote-stage` واختبارات استعادة؛ لا يجوز حذفها جميعًا بأمر Docker شامل.
- **قبل أي Reset:** نثبت الهدف والمالك والمستهلكين والعزل، ونحفظ الحالة التي يتعين الحفاظ عليها، ونختبر الاستعادة إن كانت الحالة ذات قيمة مستمرة، ثم ننفذ العملية الهدّامة المحددة بتفويضها المناسب.
- Worktree منفصل لا يعني تلقائيًا قاعدة بيانات أو Runtime منفصلًا؛ يجب التحقق من مالك العمليات والبيانات الحي.

## 5. آلية التنفيذ الهندسية

### المرحلة الأولى — Reverse Engineering

نفهم النظام الحالي ونستخرج المتطلبات التجارية والقواعد والوظائف الصحيحة من الحوكمة والشيفرة والعقود وحالة التشغيل.

الهدف ليس إصلاح الملفات القديمة تلقائيًا، بل معرفة السلوك الذي يجب أن يقدمه النظام المعاد تأسيسه. نميّز بين السلوك المطلوب والخلل والازدواجية والتعقيد الذي لا قيمة له.

### المرحلة الثانية — Clean-Slate Architecture

نصمم البنية المستهدفة دون اعتبار الهيكلة القديمة قيدًا.

نحدد مالكًا واحدًا لكل حقيقة، ومحركًا واحدًا لكل وظيفة أساسية، وعقودًا واضحة بين الخدمات والواجهات. نستخدم أبسط معمارية تحقق سلامة البيانات والصلاحيات والمال والتزامن، دون فرض طبقات أو خدمات جديدة لمجرد تطبيق نمط هندسي معروف.

### المرحلة الثالثة — Fresh Foundation

ننشئ الأساس البرمجي والتشغيلي الصحيح:

- مخططات بيانات نظيفة وقيود سلامة أساسية لكل مالك.
- عقود API موحدة ومصادر توليد واضحة.
- تكوين Docker وبيئات تطوير قابلة لإعادة الإنشاء.
- أساس مشترك للواجهات واختبارات العقود والتكامل.

لا نعيد إنشاء مكوّن صحيح فقط لكي يبدو المشروع جديدًا، ولا نحتفظ بمكوّن معيب فقط لأنه موجود.

### المرحلة الرابعة — Contract-Driven Full Rebuild

نعيد بناء الوظائف التجارية على **دفعات رأسية متكاملة**.

كل دفعة تشمل كل المكونات المتأثرة بها: قاعدة البيانات، والخدمة، والعقد، والصلاحيات، والواجهة، والاختبارات. ننقل مستهلكي المسار المستبدل ونتحقق منهم، ثم نزيل المسار الخاسر دون إنشاء مصدر حقيقة ثانٍ دائم.

يسمح بالتنفيذ المتوازي عندما تكون الملفات والموارد والاعتماديات مستقلة، دون تعدد الكتّاب على نفس الملف أو قاعدة البيانات أو Git index.

### المرحلة الخامسة — Automated Verification

نطبق التحقق التدريجي من صحة الشيفرة والعقود والبيانات والسلوك.

نتحقق من الرحلات الحقيقية، والصلاحيات، وعزل الحسابات والمتاجر، والتزامن، والدفع ودفتر WLT، وإعادة المحاولة، واستعادة النظام، وتجربة المستخدم وRTL على المنصات المتأثرة.

**لا يعتبر نجاح البناء أو الاختبارات الوحدوية أو HTTP 200 وحده إثباتًا للتكامل الكامل.** نستخدم أصغر إثبات ذي معنى ثم الاختبارات الأوسع عند المرشح النهائي، ولا نعيد اختبارات غير متأثرة بلا داعٍ.

### المرحلة السادسة — Clean Bootstrap & Final Validation

نثبت أن بثواني المعاد تأسيسها تستطيع العمل من **بيئة نظيفة**: مخططات بيانات جديدة، وتكوين وتشغيل مضبوط، وتطبيقات متصلة، ورحلات تجارية مكتملة مع قراءة نتائجها من المالك القانوني.

بعد ذلك نزيل المكونات القديمة التي لم تعد مستخدمة، ونراجع الاعتماديات المتبقية وأدلة التراجع والاسترداد.

الانتقال إلى Stage أو Production عملية مستقلة تحتاج إلى اعتماد واختبارات وتسليم مأذون، ولا تنفذ تلقائيًا ضمن إعادة التأسيس المحلية.

## 6. مميزات هذا المنهج

**السرعة:** نتخلص من تكلفة المحافظة على بيانات تجريبية وتراكمات برمجية لا تحتاج إلى البقاء، ونستخدم توليد الشيفرة والعقود والاختبارات عندما يوفر وقتًا حقيقيًا.

**الدقة:** نحدد النتيجة الصحيحة قبل التنفيذ، ونربط قبول كل دفعة باختبارات مستقلة قابلة لإعادة التشغيل.

**البساطة:** نزيل الازدواجية والملفات والطبقات غير الضرورية، دون فقدان وظائف تجارية مطلوبة.

**الاستقرار:** يمكن إعادة إنشاء بيئة التطوير من الصفر والتحقق من مطابقة نتائجها للمخططات والعقود المعتمدة.

**قابلية التوسع:** تصبح مسؤوليات الخدمات وملكية البيانات وحدود التكامل واضحة، مع القدرة على إضافة السعة عند الحاجة المثبتة.

**سهولة الصيانة:** يعتمد المشروع على عدد أقل من مصادر الحقيقة وآليات مباشرة وقابلة للفهم.

## 7. موقع التنفيذ وسلطته

بيئة إعادة التأسيس المحددة:

`D:\samrim-governance-refoundation-20261110`

نستخدم الفرع وWorktree القائمين، دون إنشاء مستودع أو Worktree أو محركات تجارية موازية دون تفويض جديد مناسب.

تُنشأ بيئة البيانات الجديدة فقط عندما يثبت عزلها عن البيانات والعمليات الأخرى. Git يثبت تغييرات المصدر، بينما تثبت حالة التشغيل الفعلية صلاحية التنفيذ. لا يخول هذا المستند وحده إجراء Push أو PR أو Merge أو نشر أو حذف بيانات.

## 8. معيار اكتمال إعادة التأسيس

نعتبر إعادة التأسيس مكتملة **ضمن نطاقها المأذون** عندما:

- تعمل الوظائف التجارية المعتمدة على البنية الجديدة.
- تكون البيانات والعقود والصلاحيات متسقة مع الملاك القانونيين.
- تنجح اختبارات الوظائف والتكامل والأمان والمال والحالات الحرجة ذات الصلة.
- يمكن إنشاء بيئة تطوير نظيفة وتشغيلها بصورة قابلة للتكرار.
- لا تبقى محركات أو مصادر حقيقة موازية لنفس الوظيفة.
- تزال الاعتماديات القديمة التي تقرر استبدالها بعد نقل مستهلكيها.
- تجتاز النسخة النهائية المراجعات وبوابات القبول المطلوبة.

**نجاح جميع معايير القبول لا يعني ضمان انعدام الأخطاء المستقبلية بنسبة 100%**، لكنه يوفر أساسًا قابلًا للتحقق والقياس.

## 9. القرار النهائي

نعتمد **Greenfield-Style Full-System Refoundation** بوصفه المنهج المقترح لإعادة تأسيس بثواني.

نبدأ من التصميم الصحيح، ونعيد إنشاء البنية البرمجية وقواعد البيانات وبيئة التشغيل التجريبية بالقدر الذي يخدم التصميم المستهدف، وننفذ الوظائف على دفعات متكاملة قابلة لإثبات صحتها.

**الهدف النهائي ليس الحفاظ على الشيفرة القديمة ولا إعادة كتابة أكبر عدد من الملفات، بل إنشاء أبسط نظام بثواني صحيح ومتكامل وقابل للتطوير والتشغيل والصيانة.**

## 10. ما الذي بقي قبل التنفيذ الهدّام؟

عند التدقيق السابق كانت شجرة العمل نظيفة على `f42cef7c`، لكن الفرع قد يتحرك بفعل عمل متزامن. لذلك تجب إعادة قراءة HEAD وGit status وحالة العمليات قبل الكتابة المؤثرة.

كما أن وحدات تخزين `samrim-local` ليست الوحيدة على Docker؛ توجد موارد أخرى لبيئات واختبارات استعادة. يجب حصر الهدف الفعلي قبل أي Reset، ولا يصح استخدام حذف شامل لكل Docker.

**حالة التدقيق:** جرى تدقيق هيكلي وفحص مصادر الحوكمة وبعض الضوابط الآلية. لم تجرِ مراجعة سطرية شاملة لجميع SQL أو اختبارات نهائية لجميع الوظائف والأجهزة. هذا الملف يحدد **منهج التأسيس وحدوده ومعايير قبول نتائجه**، وليس شهادة باكتمال التدقيق البرمجي أو جاهزية المرشح للإطلاق.


## 11. Mandatory preflight and conservation gate for implementation (reviewed 2026-11-10)

**This is a handoff/preflight procedure, not a new Product, financial or design authority.** Decisions live in `docs/governance/README.md`'s routed owners. Current code/API/runtime prove the baseline, not this document's historical counts. The working source baseline may move while another authorized agent works; always re-read the exact HEAD and status before material edits.

### Before the first product mutation

1. Confirm the existing approved worktree and current HEAD; account for uncommitted edits, other Git writers and active runtime owners. Do not create a branch/worktree, start a competing server or reuse stale device evidence.
2. Check every canonical admitted capability in `product.md` against affected source, API, persistent owner, apps and tests. Identify **subfeatures that a high-level capability label can conceal**; do not infer that a lack of mention means consent to delete.
3. Record each material feature's present behavior, current platform/actor, target owner, retention/rebuild decision, affected readers/writers, known privacy/finance/regression risk and exact falsifying proof. This dated, task-scoped implementation crosswalk is evidence only; never maintain a competing feature catalog.
4. Reconcile approved financial-policy independence from Store relation, Store collection responsibility, one Store/catalog/Order engine, one Design Studio publisher and direct Store web presentation with the **real** contracts/DB/API before redesigning them. Future policy defaults do not activate unsupported payment or subscription.
5. Prove development data and remote runtime isolation before any reset; protect accounts, accepted agreements, historical financial records, media, secrets, identities, shared databases and other work even if much local data is synthetic.
6. Begin with the smallest vertical slice that tests an unresolved owner boundary. Stop an affected slice as BLOCKED rather than falsely considering a mock, interface placeholder or green typecheck complete.

### Subfeatures that must survive the refoundation unless their owner approves retirement

| Existing functional responsibility | Semantic owner / consumers to trace | Minimum future proof |
| --- | --- | --- |
| Privacy-filtered Captain opportunity/heatmap | DSH fulfillment; Captain + authorized Operations | Coarse/thresholded cells, stale rejection, role isolation, actual map interaction |
| Store-scoped short-form videos and discovery banners | DSH commerce/discovery + media adapters; Partner/Client/Operator | Upload/processing, ownership, moderation, eligible publication, consumption, withdrawal |
| Order-scoped private text/image/voice/video | DSH conversation + media adapters; authorized Order participants | Privacy/IDOR, message replay, attachment limits, closed-Order negative paths |
| Store catalog lookup, local products, price and stock, quick edit, import/export | DSH catalog; Partner and Operator/Customer readers | Single product/offer authority, correct bulk results, no duplicate writes, server confirmation |
| Store campaigns, promotions, discounts and content | DSH commerce/marketing and WLT where financial | Effective eligibility, budget/terms, immutable financial readback |
| Multi-Store owners, staff, permission scope and Store-linked Captains | Identity + DSH + fulfillment; Partner/Operator/Captain | Two Stores/two actors, session switch, assignment limits and denial |
| Store financial agreements, commission/subscription plans, collection modes | WLT; DSH and Partner/Operator | Policy defaults versus active accepted terms, exact fees, idempotency, ledger and reconciliation |
| Store direct links, full responsive web Store, compact marketplace view | DSH + Client Expo Web/native | Independent excluded from marketplace, published public data only, allowed and refused checkout |
| Operator reports, settlements, search and filters | Canonical DSH/WLT/Identity/HR as applicable; Control Panel | Source reconciliation, server-bounded selection, role isolation, failure/retry |
| Design Studio global and Store-full-web presentation | DSH publication + Identity rights; all supported consumers | Same publisher, real preview, Store isolation, schema, rollback and accessible rendered output |
| Native maps, push notifications, customer/captain tracking and local device services | DSH and original technical adapters; affected Expo apps | Owner readback, stale/permission failures, supported OS/platform behavior |

The table is a **minimum safeguard** and explicitly not a complete inventory. More capabilities found in the code, documentation, migrations or operating workflows are added to the affected-scope evidence before removal. Feature conservation includes error paths, ownership boundaries and usability, not just visible labels.

### Partner Android/iOS/Web and full Store web acceptance

The Partner app must allow an authorized Merchant to register, create/manage multiple Stores, understand unpublished/public/orderable state, manage Store staff and affiliated Captains, catalog, offers, quick prices, import/export, Orders, finance/agreements, reports, promotions, short-form videos, notifications, and **Design My Store** on permitted full web presentation. The exact available actions depend on canonical eligibility and release gates, not whether a navigation button happens to appear. One Expo project may adapt mobile cards and desktop tables without two business authors. Test two account owners, a scoped staff actor, store switching with late responses, draft and withdrawn media, offline/replay, wrong-role denial, real Android and web and real iOS when available; label unavailable platform proof NOT_RUN.

### Decision and stop conditions

- **Implementation-start readiness** requires reconciled canonical governance, a passing structural/reference/encoding verifier, a protected exact worktree, an explicit first vertical slice, and a clear strategy to preserve every materially affected function. This is not a claim that the full platform is finished.
- **No general delete/reset/launch authority** is conferred by this plan. Destructive data mutation, deployment, push, PR and merge retain their distinct authorization boundaries.
- A successful source audit, isolated unit test or rendered mock is narrower than live E2E acceptance. The final system stays NOT_DONE until every authorized Product slice and material handoff is independently proven.
