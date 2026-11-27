import type { PublicPage, PublicStore, PublicVertical } from "@bthwani/dsh";
import { listPublicCities, listPublicStores, listPublicVerticals } from "@bthwani/dsh";
import styles from "../operator-shell/operator-shell.module.css";
import { parsePublicStoreBrowse, resolvePublicDshOrigin } from "../stores/public-store-query";
import { parseOperatorHomeCity } from "./operator-home-city";

const orderabilityLabels: Record<PublicStore["orderabilityStatus"], string> = {
  OPEN_FOR_ORDERS: "متاح للطلبات وفق حالة DSH",
  CLOSED_BY_SCHEDULE: "مغلق حسب الجدول",
  PAUSED: "موقوف مؤقتًا",
  OPERATIONALLY_UNAVAILABLE: "غير متاح تشغيليًا",
};

type MarketReads = {
  cities: PublicPage<string> | null;
  stores: PublicPage<PublicStore> | null;
  verticals: PublicPage<PublicVertical> | null;
};

/**
 * Each Store has one DSH vertical. A complete vertical page contains the exact
 * count of published MARKETPLACE Stores per active category, not all Stores.
 * An empty page alone does not prove that the requested city is active.
 */
function publishedTotal(city: string, { cities, verticals }: MarketReads) {
  if (!verticals) return { value: null, reason: "تعذّر تأكيد تصنيفات DSH." };
  if (verticals.nextCursor) return { value: null, reason: "توجد تصنيفات خارج الصفحة؛ الإجمالي غير مؤكد." };
  if (verticals.items.length === 0 &&
      !(cities?.revision === verticals.revision && cities.items.includes(city))) {
    return { value: null, reason: "لم تُؤكد مدينة نشطة في مراجعة التصنيفات نفسها؛ الصفر غير مؤكد." };
  }
  let value = 0;
  for (const { storeCount } of verticals.items) {
    value += storeCount;
    if (!Number.isSafeInteger(value)) return { value: null, reason: "الإجمالي خارج مجال الأعداد الدقيقة المدعوم." };
  }
  return { value, reason: "جميع تصنيفات السوق المنشور في المدينة، وفق مراجعة DSH للتصنيفات." };
}

function marketFacts(city: string, reads: MarketReads) {
  const { stores, verticals } = reads;
  const total = publishedTotal(city, reads);
  const page = stores ? {
    size: stores.items.length,
    revision: stores.revision,
    partial: Boolean(stores.nextCursor),
    counts: stores.items.reduce<Record<PublicStore["orderabilityStatus"], number>>((counts, item) => {
      counts[item.orderabilityStatus]++;
      return counts;
    }, { OPEN_FOR_ORDERS: 0, CLOSED_BY_SCHEDULE: 0, PAUSED: 0, OPERATIONALLY_UNAVAILABLE: 0 }),
  } : null;
  return (
    <section aria-label="مؤشرات السوق من DSH">
      <h3>مؤشرات السوق المنشور</h3>
      <dl>
        <dt>إجمالي متاجر السوق المنشورة في المدينة</dt>
        <dd data-testid="market-published-total">{total.value ?? "غير متاح"}</dd>
      </dl>
      <p>{total.reason}{verticals ? ` مراجعة DSH: ${verticals.revision}.` : ""}</p>
      {page ? <>
        <p data-testid="market-page-scope">حالات المتاجر في الصفحة المعروضة: {page.size} — مراجعة DSH: {page.revision}.
          {page.partial ? " توجد صفحات أخرى." : " لا توجد صفحة تالية."} هذه الأعداد تخص نتائج الصفحة ولا تثبت أهلية إتمام الطلب.</p>
        <dl>
          <dt>متاح وفق حالة DSH</dt><dd data-testid="market-page-open">{page.counts.OPEN_FOR_ORDERS}</dd>
          <dt>مغلق حسب الجدول</dt><dd>{page.counts.CLOSED_BY_SCHEDULE}</dd>
          <dt>موقوف مؤقتًا</dt><dd data-testid="market-page-paused">{page.counts.PAUSED}</dd>
          <dt>غير متاح تشغيليًا</dt><dd>{page.counts.OPERATIONALLY_UNAVAILABLE}</dd>
        </dl>
        {verticals && verticals.revision !== page.revision &&
          <p role="status">مراجعتا قائمة المتاجر والتصنيفات مختلفتان؛ لا تُدمج القراءتان في نسبة أو نتيجة واحدة.</p>}
      </> : <p>حالات متاجر الصفحة غير متاحة.</p>}
    </section>
  );
}

export default async function PublicMarketOverview({ searchParams, canVisitStores, canVisitCatalog, canViewPublicMarket = false, action = "/workspace" }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  canVisitStores: boolean;
  canVisitCatalog: boolean;
  canViewPublicMarket?: boolean;
  action?: "/workspace" | "/merchants" | "/marketing" | "/catalog/products";
}>) {
  // The workspace page is already protected by Identity, but this view
  // contains public DSH facts only. Never infer management grants from them.
  if (!canVisitStores && !canVisitCatalog && !canViewPublicMarket) return null;
  const params = await searchParams;
  const products = action === "/catalog/products";
  const productStores = products
    ? parsePublicStoreBrowse({ city: params.city, q: params.storeQ, cursor: params.storeCursor })
    : null;
  const city = products ? productStores?.city ?? null : parseOperatorHomeCity(params);
  function productStoresHref(cursor?: string) {
    const query = new URLSearchParams({ city: city ?? "" });
    if (productStores?.query) query.set("storeQ", productStores.query);
    if (cursor) query.set("storeCursor", cursor);
    return `${action}?${query.toString()}`;
  }
  const origin = resolvePublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN, process.env.NODE_ENV);
  const reads: MarketReads = { cities: null, stores: null, verticals: null };
  let citiesError = "";
  let storesError = "";
  let verticalsError = "";

  if (city === null) {
    citiesError = "معاملات المدينة غير صالحة. اختر مدينة معتمدة.";
  } else if (!origin) {
    citiesError = "اتصال DSH المعزول غير مُهيأ. لا توجد بيانات مؤكدة.";
  } else if (!city) {
    try {
      reads.cities = await listPublicCities(origin, { limit: 50, signal: AbortSignal.timeout(5000) });
    } catch {
      citiesError = "تعذّرت قراءة المدن المنشورة من DSH.";
    }
  } else {
    // Independent owner snapshots: preserve successful reads and their own
    // revision even when another endpoint fails or changes.
    const results = await Promise.allSettled([
      listPublicCities(origin, { limit: 50, signal: AbortSignal.timeout(5000) }),
      listPublicStores(origin, city, {
        ...(productStores?.query ? { query: productStores.query } : {}),
        ...(productStores?.cursor ? { cursor: productStores.cursor } : {}),
        limit: products ? 20 : 10,
        signal: AbortSignal.timeout(5000),
      }),
      products ? Promise.resolve(null) : listPublicVerticals(origin, city, { limit: 10, signal: AbortSignal.timeout(5000) }),
    ] as const);
    if (results[0].status === "fulfilled") reads.cities = results[0].value;
    else citiesError = "تعذّرت قراءة المدن المنشورة من DSH.";
    if (results[1].status === "fulfilled") reads.stores = results[1].value;
    else storesError = "تعذّر تأكيد المتاجر المنشورة من DSH.";
    if (results[2].status === "fulfilled") reads.verticals = results[2].value;
    else verticalsError = "تعذّرت قراءة أنواع النشاط من DSH.";
  }
  const { cities, stores, verticals } = reads;

  return (
    <section aria-labelledby="operator-public-market-heading">
      <h2 id="operator-public-market-heading">{products ? "اختيار متجر منشور" : "لمحة السوق المنشور"}</h2>
      {!products && <p>حقائق عامة للقراءة فقط من DSH. يوضح كل مؤشر نطاقه ومراجعته، دون احتساب الطلبات أو الإيرادات من صفحات المتاجر.</p>}
      <form method="get" action={action} style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: "0.75rem" }}>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          مدينة منشورة
          <input type="text" name="city" list="operator-home-cities" defaultValue={city ?? ""}
            required pattern="[a-z0-9\-]{1,64}" maxLength={64} placeholder="sanaa"
            style={{ minHeight: 44, paddingInline: "0.75rem" }} />
          {cities && <datalist id="operator-home-cities">
            {cities.items.map(item => <option key={item} value={item} />)}
          </datalist>}
        </label>
        {products && <label style={{ display: "grid", gap: "0.25rem" }}>
          اسم المتجر
          <input name="storeQ" maxLength={80} defaultValue={productStores?.query ?? ""}
            style={{ minHeight: 44, paddingInline: "0.75rem" }} />
        </label>}
        <button type="submit" style={{ minHeight: 44, paddingInline: "1rem", cursor: "pointer" }}>
          {products ? "البحث عن متجر" : "قراءة السوق من DSH"}
        </button>
      </form>
      {citiesError && <p role="alert">{citiesError}</p>}
      {cities && <p role="status">مدن الصفحة: {cities.items.length}
        {cities.nextCursor ? " — توجد صفحات أخرى؛ القائمة ليست شاملة." : ""}
      </p>}
      {city && storesError && <p role="alert">{storesError}</p>}
      {city && storesError && products && productStores?.cursor && <a href={productStoresHref()}>أول صفحة</a>}
      {city && verticalsError && <p role="alert">{verticalsError}</p>}
      {city && !products && marketFacts(city, reads)}
      {city && stores && (
        <div>
          <h3>{products ? "المتاجر المطابقة" : "المتاجر المنشورة — الصفحة الأولى"}</h3>
          <p role="status">عدد النتائج: {stores.items.length} — مراجعة DSH: {stores.revision}</p>
          {stores.items.length === 0 ? <p>لا توجد متاجر عامة منشورة مطابقة لهذه المدينة.</p> :
            <ul className={styles.sectionGrid}>
              {stores.items.map(store => <li className={styles.sectionCard} key={store.id}>
                <strong>{store.name}</strong>
                <span>{orderabilityLabels[store.orderabilityStatus]}</span>
                <span>نوع النشاط: {store.verticalId}</span>
                {canVisitCatalog && /^[a-z0-9-]{1,64}$/.test(store.id) && (
                  <a className={styles.primaryLink} href={`${action === "/catalog/products" ? action : "/catalog"}?store=${encodeURIComponent(store.id)}`}>
                    عرض العروض المنشورة
                  </a>
                )}
              </li>)}
            </ul>}
          {products && (productStores?.cursor || stores.nextCursor) ? <nav aria-label="صفحات المتاجر">
            {productStores?.cursor && <a href={productStoresHref()}>أول صفحة</a>}
            {stores.nextCursor && <a href={productStoresHref(stores.nextCursor)}>الصفحة التالية</a>}
          </nav> : null}
          {!products && stores.nextCursor && <p>توجد متاجر أخرى؛ المعروض ليس إجمالي المدينة.</p>}
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
            </ul>
          }
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
