import type { PublicationReviewItem } from "@bthwani/dsh";
import { type PublicationReviewScope, publicationReviewHref } from "./publication-review-query";

// These are DSH observation fields, not publication conditions or an eligibility engine.
const foundationFacts = [
  { key: "cityActive", label: "المدينة", present: "نشطة", missing: "غير نشطة", metric: "المدينة غير نشطة", action: "راجع تفعيل مدينة الخدمة." },
  { key: "verticalActive", label: "النشاط", present: "نشط", missing: "غير نشط", metric: "النشاط غير نشط", action: "راجع تفعيل النشاط التجاري." },
  { key: "locationRecorded", label: "الموقع", present: "مسجل", missing: "غير مسجل", metric: "الموقع غير مسجل", action: "اطلب استكمال موقع المتجر لدى DSH." },
  { key: "registrationTermsRecorded", label: "قبول شروط التسجيل من المالك الحالي", present: "موثق", missing: "غير مثبت", metric: "قبول شروط التسجيل غير مثبت", action: "تحقق من قبول شروط التسجيل للمالك الحالي." },
  { key: "weeklyHoursRecorded", label: "ساعات العمل", present: "مسجلة", missing: "غير مسجلة", metric: "ساعات العمل غير مسجلة", action: "اطلب استكمال ساعات العمل لدى DSH." },
  { key: "catalogRecorded", label: "الكتالوج", present: "توجد عروض مسجلة", missing: "لا توجد عروض", metric: "الكتالوج غير مسجل", action: "اطلب استكمال عروض الكتالوج؛ اعتمادها خطوة مستقلة." },
] as const;

export function PublicationReviewFacts({ store }: Readonly<{ store: PublicationReviewItem }>) {
  return <dl>{foundationFacts.map(fact => (
    <div key={fact.key}>
      <dt>{fact.label}</dt>
      <dd>{store[fact.key] ? fact.present : fact.missing}
        {!store[fact.key] && <p>{fact.action}</p>}
      </dd>
    </div>
  ))}</dl>;
}

export function PublicationReviewPageSummary({ items }: Readonly<{ items: readonly PublicationReviewItem[] }>) {
  const total = items.length;
  const complete = items.filter(store => foundationFacts.every(fact => store[fact.key])).length;
  const fraction = (count: number) => total === 0 ? "لا ينطبق" : `${count} من ${total}`;
  const metrics = [
    ["متاجر في الصفحة الحالية", String(total)],
    ["متاجر لديها حقائق تأسيس ناقصة", fraction(total - complete)],
    ["متاجر سجلت جميع الحقائق الست", fraction(complete)],
    ...foundationFacts.map(fact => [fact.metric, fraction(items.filter(store => !store[fact.key]).length)]),
  ];
  return <section aria-label="مؤشرات تجهيز الصفحة الحالية">
    <h2>مؤشرات تجهيز الصفحة الحالية</h2>
    <p>مصدر البيانات: قراءة DSH الحالية للمتاجر غير المنشورة في نطاق المدينة وطريقة العمل المختارين. هذه المؤشرات ليست إجمالي المدينة.</p>
    <p>الحقائق الست لا تعني موافقة النشر أو اتفاقية مالية نافذة أو أهلية استقبال الطلبات. قد تظهر عدة نواقص للمتجر نفسه.</p>
    <dl>{metrics.map(([label, value]) => <div key={label}>
      <dt>{label}</dt><dd>{value}</dd>
    </div>)}</dl>
  </section>;
}

export default function StoreDetails({ store, scope }: Readonly<{ store: PublicationReviewItem; scope: PublicationReviewScope }>) {
  return <section aria-labelledby="publication-store-name">
    <h2 id="publication-store-name">{store.name}</h2>
    <p>المعرّف <code dir="ltr">{store.id}</code> · المدينة <code dir="ltr">{scope.city}</code> · النشاط <code dir="ltr">{store.verticalId}</code></p>
    <p>طريقة العمل {scope.relation === "DIRECT" ? "مباشر" : "سوق بثواني"}</p>
    <h3>حقائق التأسيس والإجراءات التالية</h3>
    <PublicationReviewFacts store={store} />
    <p>غير منشور. تتطلب الموافقة على النشر والاتفاق المالي أدلة مستقلة.</p>
    <a href={publicationReviewHref(scope)}>العودة إلى صفحة المراجعة</a>
  </section>;
}
