import { listOperatorStorePublicationReview, type PublicationReviewPage, type StoreRegistrationRelation } from "@bthwani/dsh";
import { cookies } from "next/headers";
import Link from "next/link";
import styles from "../../../../src/features/operator-shell/operator-shell.module.css";
import WorkspaceUnavailable from "../../../../src/features/operator-shell/workspace-unavailable";
import { isolatedPublicDshOrigin } from "../../../../src/features/stores/public-store-query";
import { currentOperatorAccess } from "../../../../src/server/current-operator-access";
import { OPERATOR_COOKIE } from "../../../../src/server/operator-passkey-bff";

export const dynamic = "force-dynamic";
const publicId = /^[a-z0-9-]{1,64}$/;
function reviewScope(input: Record<string, string | string[] | undefined>) {
  if (Object.keys(input).some(key => !["city", "relation", "after"].includes(key))) return null;
  const { city, relation, after } = input;
  if (city === undefined && relation === undefined && after === undefined) return { city: "", relation: "MARKETPLACE" as const };
  if (typeof city !== "string" || !publicId.test(city) ||
    (relation !== "MARKETPLACE" && relation !== "DIRECT") ||
    (after !== undefined && (typeof after !== "string" || !publicId.test(after)))) return null;
  return { city, relation: relation as StoreRegistrationRelation, ...(after ? { after } : {}) };
}

export default async function Page({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("merchant")) return <WorkspaceUnavailable title="مراجعة المتاجر" description="تتطلب القراءة صلاحية إدارة التجار الحالية من Identity." owner="Identity" />;
  const scope = reviewScope(await searchParams);
  const origin = isolatedPublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN);
  let result: PublicationReviewPage | null = null;
  let error = "";
  if (!scope) error = "نطاق المراجعة غير صالح.";
  else if (scope.city) {
    const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
    if (!origin || !bearer) error = "تعذّر الوصول إلى مالك المتاجر بجلسة موثقة.";
    else {
      try {
        result = await listOperatorStorePublicationReview(origin, scope.city, scope.relation, bearer,
          "after" in scope ? scope.after : undefined, AbortSignal.timeout(5000));
      } catch {
        error = "تعذرت قراءة المتاجر من DSH. لا تعني هذه الحالة عدم وجود متاجر أو قبولها.";
      }
    }
  }
  return (
    <main className={styles.workspace}>
      <h1>مراجعة المتاجر غير المنشورة</h1>
      <p>قائمة من DSH للمتاجر المسجلة وغير المنشورة، وليست سجل طلبات موافقة أو قرارات نشر. تعرض حقائق التأسيس فقط؛ الاتفاق المالي والتحقق القانوني واعتماد الكتالوج والتوصيل ما زالت شروطًا مستقلة.</p>
      <form action="/merchants/joining" method="get" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
        <label>المدينة <input name="city" required pattern="[a-z0-9-]{1,64}" maxLength={64} defaultValue={scope?.city ?? ""} style={{ minHeight: 44 }} /></label>
        <label>طريقة العمل <select name="relation" defaultValue={scope?.relation ?? "MARKETPLACE"} style={{ minHeight: 44 }}>
          <option value="MARKETPLACE">السوق</option><option value="DIRECT">المباشر</option>
        </select></label>
        <button type="submit" style={{ minHeight: 44 }}>قراءة المتاجر من DSH</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && <section aria-label="حقائق مراجعة المتاجر">
        {result.items.length === 0 ? <p role="status">لا توجد متاجر غير منشورة في هذه الصفحة.</p> :
          <ul className={styles.sectionGrid}>{result.items.map(store => (
            <li key={store.id} className={styles.sectionCard}>
              <strong>{store.name}</strong>
              <span>المعرّف: <code dir="ltr">{store.id}</code></span>
              <span>النشاط: {store.verticalId}</span>
              <span>المدينة والنشاط: {store.cityActive && store.verticalActive ? "نشطان" : "غير مكتمل"}</span>
              <span>الموقع: {store.locationRecorded ? "مسجل" : "غير مسجل"}</span>
              <span>قبول شروط التسجيل من المالك الحالي: {store.registrationTermsRecorded ? "موثق" : "غير مثبت"}</span>
              <span>ساعات العمل: {store.weeklyHoursRecorded ? "مسجلة" : "غير مسجلة"}</span>
              <span>الكتالوج: {store.catalogRecorded ? "توجد عروض مسجلة" : "لا توجد عروض"}</span>
              <span>النشر: غير منشور — اعتماد النشر والاتفاق المالي غير مثبتين من هذه القراءة.</span>
            </li>
          ))}</ul>}
        {result.nextCursor && <Link href={`/merchants/joining?city=${result.cityId}&relation=${result.relation}&after=${result.nextCursor}`}>الصفحة التالية</Link>}
      </section>}
    </main>
  );
}
