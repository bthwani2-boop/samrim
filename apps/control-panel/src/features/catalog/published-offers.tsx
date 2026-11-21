import { getPublicStore, listPublicOffers, type PublicOffer, type PublicPage, type PublicStore } from "@bthwani/dsh";
import { currentOperatorAccess } from "../../server/current-operator-access";
import styles from "../operator-shell/operator-shell.module.css";
import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";
import { resolvePublicDshOrigin } from "../stores/public-store-query";
import { parsePublishedOfferQuery, publishedOfferHref } from "./published-offer-query";

export default async function PublishedOffers({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  // A route-group layout alone is not a data authorization boundary during RSC rendering.
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("catalog")) {
    return <WorkspaceUnavailable title="الكتالوج المركزي" description="يلزم تصريح الكتالوج الحالي من Identity." owner="Identity" />;
  }

  const scope = parsePublishedOfferQuery(await searchParams);
  const owner = resolvePublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN, process.env.NODE_ENV);
  let store: PublicStore | null = null;
  let offers: PublicPage<PublicOffer> | null = null;
  let error = "";
  if (!scope) {
    error = "معلمات المتجر أو البحث أو الصفحة غير صالحة. أعد البحث من البداية.";
  } else if (scope.storeId && !owner) {
    error = "اتصال DSH غير مهيأ؛ لا توجد عروض مؤكدة.";
  } else if (scope.storeId && owner) {
    try {
      // A public Store read is not a Store-management grant or a checkout decision.
      store = await getPublicStore(owner, scope.storeId, AbortSignal.timeout(5000));
      offers = await listPublicOffers(owner, scope.storeId, {
        ...(scope.query ? { query: scope.query } : {}),
        ...(scope.cursor ? { cursor: scope.cursor } : {}),
        limit: 20,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      store = null;
      offers = null;
      error = "تعذّر تأكيد المتجر أو عروضه المنشورة من DSH. أعد القراءة أو اختر متجرًا آخر.";
    }
  }

  return (
    <main className={styles.workspace} aria-labelledby="operator-catalog-title">
      <h1 id="operator-catalog-title">الكتالوج المركزي — العروض المنشورة</h1>
      <p>هذا العرض قراءة مباشرة من DSH لعروض متجر منشور علنًا فقط. لا يشمل المسودات
        أو المنتجات الداخلية أو المخزون الخاص، ولا يسمح بتعديل الأسعار أو النشر أو إنشاء طلب.</p>
      <form action="/catalog" method="get" style={{
        display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end", marginBlock: "1rem",
      }}>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          معرّف المتجر المنشور
          <input name="store" aria-label="معرّف المتجر المنشور" required
            pattern="[a-z0-9-]{1,64}" maxLength={64} placeholder="market-sanaa"
            defaultValue={scope?.storeId ?? ""} style={{ minHeight: 44 }} />
        </label>
        <label style={{ display: "grid", gap: "0.25rem", flex: "1 1 12rem" }}>
          البحث في العروض المنشورة
          <input name="q" aria-label="البحث في العروض" maxLength={80}
            defaultValue={scope?.query ?? ""} placeholder="اسم المنتج"
            style={{ width: "100%", minHeight: 44 }} />
        </label>
        <button type="submit" style={{ minHeight: 44, paddingInline: "1rem", cursor: "pointer" }}>
          قراءة العروض من DSH
        </button>
      </form>
      {scope && !scope.storeId && !error ? (
        <p role="status">أدخل معرّف متجر منشور لعرض عروضه العامة.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {store && offers && scope ? (
        <section aria-label="العروض المنشورة لدى DSH">
          <h2>{store.name}</h2>
          <p role="status">عدد العروض في هذه الصفحة: {offers.items.length} — مراجعة DSH: {offers.revision}</p>
          {offers.items.length === 0 ? <p>لا توجد عروض منشورة مطابقة للبحث.</p> : (
            <ul className={styles.sectionGrid}>
              {offers.items.map(offer => (
                <li key={offer.id} className={styles.sectionCard}>
                  <strong>{offer.name}</strong>
                  <span>السعر المنشور: <code dir="ltr">{String(offer.priceYer)} YER</code></span>
                  <span>معرّف العرض: <code dir="ltr">{offer.id}</code></span>
                </li>
              ))}
            </ul>
          )}
          <nav aria-label="صفحات العروض" style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBlock: "1rem" }}>
            {scope.cursor ? <a href={publishedOfferHref({ storeId: scope.storeId, query: scope.query })}>
              العودة إلى أول صفحة
            </a> : null}
            {offers.nextCursor ? <a href={publishedOfferHref({
              storeId: scope.storeId, query: scope.query, cursor: offers.nextCursor,
            })}>الصفحة التالية</a> : null}
          </nav>
        </section>
      ) : null}
    </main>
  );
}
