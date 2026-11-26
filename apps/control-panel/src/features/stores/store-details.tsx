import type { PublicationReviewItem } from "@bthwani/dsh";
import { type PublicationReviewScope, publicationReviewHref } from "./publication-review-query";

export function PublicationReviewFacts({ store }: Readonly<{ store: PublicationReviewItem }>) {
  const facts = [
    ["المدينة", store.cityActive ? "نشطة" : "غير نشطة"],
    ["النشاط", store.verticalActive ? "نشط" : "غير نشط"],
    ["الموقع", store.locationRecorded ? "مسجل" : "غير مسجل"],
    ["قبول شروط التسجيل من المالك الحالي", store.registrationTermsRecorded ? "موثق" : "غير مثبت"],
    ["ساعات العمل", store.weeklyHoursRecorded ? "مسجلة" : "غير مسجلة"],
    ["الكتالوج", store.catalogRecorded ? "توجد عروض مسجلة" : "لا توجد عروض"],
  ];
  return <dl>{facts.map(([label, value]) => <div key={label}>
    <dt>{label}</dt><dd>{value}</dd>
  </div>)}</dl>;
}

export default function StoreDetails({ store, scope }: Readonly<{ store: PublicationReviewItem; scope: PublicationReviewScope }>) {
  return <section aria-labelledby="publication-store-name">
    <h2 id="publication-store-name">{store.name}</h2>
    <p>المعرّف <code dir="ltr">{store.id}</code> · المدينة <code dir="ltr">{scope.city}</code> · النشاط <code dir="ltr">{store.verticalId}</code></p>
    <p>طريقة العمل {scope.relation === "DIRECT" ? "مباشر" : "سوق بثواني"}</p>
    <PublicationReviewFacts store={store} />
    <p>غير منشور. تتطلب الموافقة على النشر والاتفاق المالي أدلة مستقلة.</p>
    <a href={publicationReviewHref(scope)}>العودة إلى صفحة المراجعة</a>
  </section>;
}
