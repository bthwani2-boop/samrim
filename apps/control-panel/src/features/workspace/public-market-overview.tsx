import type { PublicPage, PublicStore, PublicVertical } from "@bthwani/dsh";
import { listPublicCities, listPublicStores, listPublicVerticals } from "@bthwani/dsh";
import styles from "../operator-shell/operator-shell.module.css";
import { resolvePublicDshOrigin } from "../stores/public-store-query";
import { parseOperatorHomeCity } from "./operator-home-city";

const orderabilityLabels: Record<PublicStore["orderabilityStatus"], string> = {
  OPEN_FOR_ORDERS: "متاح للطلبات وفق حالة DSH",
  CLOSED_BY_SCHEDULE: "مغلق حسب الجدول",
  PAUSED: "موقوف مؤقتًا",
  OPERATIONALLY_UNAVAILABLE: "غير متاح تشغيليًا",
};

export default async function PublicMarketOverview({ searchParams, canVisitStores, canVisitCatalog, action = "/workspace" }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  canVisitStores: boolean;
  canVisitCatalog: boolean;
  action?: "/workspace" | "/merchants";
}>) {
  // The workspace page is already protected by Identity, but this view
  // contains public DSH facts only. Never infer management grants from them.
  if (!canVisitStores && !canVisitCatalog) return null;
  const city = parseOperatorHomeCity(await searchParams);
  const origin = resolvePublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN, process.env.NODE_ENV);
  let cities: PublicPage<string> | null = null;
  let stores: PublicPage<PublicStore> | null = null;
  let verticals: PublicPage<PublicVertical> | null = null;
  let citiesError = "";
  let storesError = "";
  let verticalsError = "";

  if (city === null) {
    citiesError = "معاملات المدينة غير صالحة. اختر مدينة معتمدة.";
  } else if (!origin) {
    citiesError = "اتصال DSH المعزول غير مُهيأ. لا توجد بيانات مؤكدة.";
  } else if (!city) {
    try {
      cities = await listPublicCities(origin, { limit: 50, signal: AbortSignal.timeout(5000) });
    } catch {
      citiesError = "تعذّرت قراءة المدن المنشورة من DSH.";
    }
  } else {
    // Independent public readings: one failed endpoint must not hide the other.
    const results = await Promise.allSettled([
      listPublicStores(origin, city, { limit: 10, signal: AbortSignal.timeout(5000) }),
      listPublicVerticals(origin, city, { limit: 10, signal: AbortSignal.timeout(5000) }),
    ] as const);
    if (results[0].status === "fulfilled") stores = results[0].value;
    else storesError = "تعذّر تأكيد المتاجر المنشورة من DSH.";
    if (results[1].status === "fulfilled") verticals = results[1].value;
    else verticalsError = "تعذّرت قراءة أنواع النشاط من DSH.";
  }

  return (
    <section aria-labelledby="operator-public-market-heading">
      <h2 id="operator-public-market-heading">لمحة السوق المنشور</h2>
      <p>بيانات عامة للقراءة فقط من DSH. الأعداد المعروضة تخص الصفحة المحدودة، وليست إجمالي الطلبات أو المتاجر أو الإيرادات.</p>
      <form method="get" action={action} style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: "0.75rem" }}>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          مدينة منشورة
          <input type="text" name="city" list="operator-home-cities" defaultValue={city ?? ""}
            required pattern="[a-z0-9-]{1,64}" maxLength={64} placeholder="sanaa"
            style={{ minHeight: 44, paddingInline: "0.75rem" }} />
          {cities && <datalist id="operator-home-cities">
            {cities.items.map(item => <option key={item} value={item} />)}
          </datalist>}
        </label>
        <button type="submit" style={{ minHeight: 44, paddingInline: "1rem", cursor: "pointer" }}>
          قراءة السوق من DSH
        </button>
      </form>
      {citiesError && <p role="alert">{citiesError}</p>}
      {cities && <p role="status">مدن الصفحة: {cities.items.length}
        {cities.nextCursor ? " — توجد صفحات أخرى؛ القائمة ليست شاملة." : ""}
      </p>}
      {city && storesError && <p role="alert">{storesError}</p>}
      {city && verticalsError && <p role="alert">{verticalsError}</p>}
      {city && stores && (
        <div>
          <h3>المتاجر المنشورة — الصفحة الأولى</h3>
          <p role="status">عدد النتائج: {stores.items.length} — مراجعة DSH: {stores.revision}</p>
          {stores.items.length === 0 ? <p>لا توجد متاجر عامة منشورة مطابقة لهذه المدينة.</p> :
            <ul className={styles.sectionGrid}>
              {stores.items.map(store => <li className={styles.sectionCard} key={store.id}>
                <strong>{store.name}</strong>
                <span>{orderabilityLabels[store.orderabilityStatus]}</span>
                <span>نوع النشاط: {store.verticalId}</span>
              </li>)}
            </ul>}
          {stores.nextCursor && <p>توجد متاجر أخرى؛ المعروض ليس إجمالي المدينة.</p>}
        </div>
      )}
      {city && verticals && (
        <div>
          <h3>أنواع النشاط المنشورة — الصفحة الأولى</h3>
          <p role="status">عدد الأنواع المعروضة: {verticals.items.length} — مراجعة DSH: {verticals.revision}</p>
          {verticals.items.length === 0 ? <p>لا توجد أنواع نشاط منشورة.</p> :
            <ul className={styles.sectionGrid}>
              {verticals.items.map(item => <li className={styles.sectionCard} key={item.id}>
                <strong>{item.id}</strong>
                <span>عدد المتاجر المنشورة بهذا النوع لدى DSH: {item.storeCount}</span>
              </li>)}
            </ul>}
          {verticals.nextCursor && <p>توجد أنواع نشاط أخرى خارج هذه الصفحة.</p>}
        </div>
      )}
      {city && (canVisitStores || canVisitCatalog) && <nav aria-label="الانتقال إلى أقسام السوق" style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBlock: "1rem" }}>
        {canVisitStores && <a href={`/merchants/public-stores?city=${city}`}>استعراض المتاجر</a>}
        {canVisitCatalog && <a href={`/catalog/categories?city=${city}`}>استعراض أنواع النشاط</a>}
      </nav>}
    </section>
  );
}
