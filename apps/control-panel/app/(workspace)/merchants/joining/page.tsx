import { listPublicCities } from "@bthwani/dsh";
import styles from "../../../../src/features/operator-shell/operator-shell.module.css";
import WorkspaceUnavailable from "../../../../src/features/operator-shell/workspace-unavailable";
import { isolatedPublicDshOrigin } from "../../../../src/features/stores/public-store-query";
import { publicationReviewHref } from "../../../../src/features/stores/publication-review-query";
import { PublicationReviewFacts, PublicationReviewPageSummary } from "../../../../src/features/stores/store-details";
import { readOperatorPublicationReview } from "../../../../src/server/operator-publication-review";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const review = await readOperatorPublicationReview(await searchParams);
  if (review.kind === "denied") return <WorkspaceUnavailable title="مراجعة المتاجر"
    description="تتطلب القراءة صلاحية إدارة التجار الحالية من Identity." owner="Identity" />;

  const scope = "scope" in review ? review.scope : null;
  const origin = isolatedPublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN);
  const cityDirectory = scope && origin
    ? await listPublicCities(origin, { limit: 50, signal: AbortSignal.timeout(3000) }).catch(() => null)
    : null;
  const cities = cityDirectory?.items ?? [];
  const cityOptionsId = cities.length ? "publication-review-city-options" : undefined;

  return <main className={styles.workspace}>
    <h1>مراجعة المتاجر غير المنشورة</h1>
    <p>قائمة من DSH للمتاجر المسجلة وغير المنشورة، وليست سجل طلبات موافقة أو قرارات نشر. تعرض حقائق التأسيس فقط؛ الاتفاق المالي والتحقق القانوني واعتماد الكتالوج والتوصيل ما زالت شروطًا مستقلة.</p>
    <form action="/merchants/joining" method="get" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
      <label>المدينة <input name="city" required pattern="[a-z0-9\-]{1,64}" maxLength={64}
        list={cityOptionsId} aria-describedby="publication-review-city-help" dir="ltr"
        defaultValue={scope?.city ?? ""} style={{ minHeight: 44 }} /></label>
      {cityOptionsId && <datalist id={cityOptionsId}>
        {cities.map(city => <option key={city} value={city} />)}
      </datalist>}
      <label>طريقة العمل <select name="relation" defaultValue={scope?.relation ?? "MARKETPLACE"} style={{ minHeight: 44 }}>
        <option value="MARKETPLACE">السوق</option><option value="DIRECT">المباشر</option>
      </select></label>
      <button type="submit" style={{ minHeight: 44 }}>قراءة المتاجر من DSH</button>
    </form>
    <p id="publication-review-city-help">
      {cityOptionsId ? "اختر من اقتراحات المدن النشطة أو أدخل معرّف المدينة." :
        "أدخل معرّف المدينة لمراجعة المتاجر."}
      {scope && !cityDirectory ? " تعذّر تحميل اقتراحات المدن من DSH." : null}
    </p>
    {review.kind === "invalid" ? <p role="alert">نطاق المراجعة غير صالح.</p> : null}
    {review.kind === "unavailable" ? <p role="alert">تعذّرت قراءة المتاجر من DSH. حاول مجددًا.</p> : null}
    {review.kind === "ready" && <section aria-label="حقائق مراجعة المتاجر">
      <PublicationReviewPageSummary items={review.page.items} />
      {review.page.items.length === 0 ? <p role="status">لا توجد متاجر غير منشورة في هذه الصفحة.</p> :
        <ul className={styles.sectionGrid}>{review.page.items.map(store => (
          <li key={store.id} className={styles.sectionCard}>
            <strong>{store.name}</strong>
            <span>المعرّف: <code dir="ltr">{store.id}</code></span>
            <span>النشاط: {store.verticalId}</span>
            <PublicationReviewFacts store={store} />
            <a href={publicationReviewHref(review.scope, store.id)}>فتح ملف {store.name}</a>
          </li>
        ))}</ul>}
      {review.scope.after && <a href={publicationReviewHref({ city: review.scope.city, relation: review.scope.relation })}>أول صفحة</a>}
      {review.page.nextCursor && <a href={publicationReviewHref({ ...review.scope, after: review.page.nextCursor })}>الصفحة التالية</a>}
    </section>}
  </main>;
}
