import { listPublicStores, type PublicPage, type PublicStore } from "@bthwani/dsh";
import styles from "../../../../src/features/operator-shell/operator-shell.module.css";
import WorkspaceUnavailable from "../../../../src/features/operator-shell/workspace-unavailable";
import {
  isolatedPublicDshOrigin, parsePublicStoreBrowse, publicStorePageHref,
} from "../../../../src/features/stores/public-store-query";
import { currentOperatorAccess } from "../../../../src/server/current-operator-access";

export const dynamic = "force-dynamic";

const orderabilityLabels: Record<PublicStore["orderabilityStatus"], string> = {
  OPEN_FOR_ORDERS: "مفتوح تشغيليًا — إتمام الطلب غير مفعّل من هذه الصفحة",
  CLOSED_BY_SCHEDULE: "مغلق حسب الجدول",
  PAUSED: "موقوف مؤقتًا",
  OPERATIONALLY_UNAVAILABLE: "غير متاح تشغيليًا",
};

export default async function PublicStoresMonitor({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  // The layout gate alone is not an authorization check for parallel RSC rendering.
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("partners")) {
    return <WorkspaceUnavailable title="المتاجر المنشورة" description="يتطلب هذا العرض صلاحية الشركاء الحالية من Identity." owner="Identity" />;
  }

  const scope = parsePublicStoreBrowse(await searchParams);
  const owner = isolatedPublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN ??
    (process.env.NODE_ENV === "development" ? "http://127.0.0.1:3202" : undefined));
  let page: PublicPage<PublicStore> | null = null;
  let error = "";
  if (!scope) {
    error = "معاملات المدينة أو البحث أو الصفحة غير صالحة. أعد البحث من البداية.";
  } else if (scope.city && !owner) {
    error = "اتصال DSH المعزول غير مُهيأ للوحة التحكم. لا توجد بيانات مؤكدة.";
  } else if (scope.city && owner) {
    try {
      page = await listPublicStores(owner, scope.city, {
        ...(scope.query ? { query: scope.query } : {}),
        ...(scope.cursor ? { cursor: scope.cursor } : {}),
        limit: 20,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      error = "تعذّر التحقق من المتاجر لدى DSH أو تغيرت الصفحة. أعد البحث من البداية.";
    }
  }

  return (
    <main className={styles.workspace} aria-labelledby="public-stores-heading">
      <h1 id="public-stores-heading">المتاجر المنشورة للعملاء</h1>
      <p>قراءة مباشرة من DSH للمتاجر المعروضة في قناة السوق العامة فقط؛ لا تعرض
        المتاجر غير المنشورة أو علاقات DIRECT الخاصة أو صلاحيات التاجر الداخلية.</p>
      <p>هذا العرض للقراءة فقط، ولا يتيح تغيير النشر أو الأسعار أو إنشاء الطلبات.</p>
      <form action="/merchants/public-stores" method="get" style={{
        display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBlock: "1rem",
        alignItems: "end",
      }}>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          معرّف المدينة لدى DSH
          <input name="city" aria-label="معرّف المدينة" required maxLength={64}
            defaultValue={scope?.city ?? ""} placeholder="sanaa"
            pattern="[a-z0-9-]{1,64}" style={{ minHeight: 44 }} />
        </label>
        <label style={{ display: "grid", gap: "0.25rem", flex: "1 1 12rem" }}>
          البحث باسم المتجر
          <input name="q" aria-label="البحث باسم المتجر" maxLength={80}
            defaultValue={scope?.query ?? ""} placeholder="اسم المتجر"
            style={{ minHeight: 44, width: "100%" }} />
        </label>
        <button type="submit" style={{ minHeight: 44, paddingInline: "1rem", cursor: "pointer" }}>
          عرض المتاجر
        </button>
      </form>
      {!scope?.city && !error ? <p role="status">حدد مدينة لقراءة متاجرها من DSH.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {page && scope ? (
        <section aria-label="نتائج المتاجر المنشورة">
          <p role="status">عدد المتاجر في هذه الصفحة: {page.items.length} — مراجعة DSH: {page.revision}</p>
          {page.items.length === 0 ? <p>لا توجد متاجر عامة مطابقة لهذا البحث.</p> : (
            <ul className={styles.sectionGrid}>
              {page.items.map(store => (
                <li key={store.id} className={styles.sectionCard}>
                  <strong>{store.name}</strong>
                  <span>المدينة: {store.cityId} — القطاع: {store.verticalId}</span>
                  <span>معرّف المتجر: <code dir="ltr">{store.id}</code></span>
                  <span>{orderabilityLabels[store.orderabilityStatus]}</span>
                </li>
              ))}
            </ul>
          )}
          <nav aria-label="صفحات المتاجر" style={{ display: "flex", gap: "1rem", marginBlock: "1rem" }}>
            {scope.cursor ? <a href={publicStorePageHref({ city: scope.city, query: scope.query })}>
              العودة إلى أول صفحة
            </a> : null}
            {page.nextCursor ? <a href={publicStorePageHref({
              city: scope.city, query: scope.query, cursor: page.nextCursor,
            })}>عرض الصفحة التالية</a> : null}
          </nav>
        </section>
      ) : null}
    </main>
  );
}
