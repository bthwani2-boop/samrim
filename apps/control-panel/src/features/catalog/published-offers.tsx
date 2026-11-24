import { getPublicStore, listPublicOffers, type PublicOffer, type PublicPage, type PublicStore } from "@bthwani/dsh";
import { currentOperatorAccess } from "../../server/current-operator-access";
import styles from "../operator-shell/operator-shell.module.css";
import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";
import { resolvePublicDshOrigin } from "../stores/public-store-query";
import { parsePublishedOfferQuery, publishedOfferHref } from "./published-offer-query";
import catalogStyles from "./published-offers.module.css";

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
      // Public Store/Offer reads do not confer Store management or publication authority.
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
      <header className={catalogStyles.intro}>
        <span className={catalogStyles.eyebrow}>الكتالوج</span>
        <h1 id="operator-catalog-title">الكتالوج المركزي — العروض المنشورة</h1>
        <p>استعرض العروض العامة المؤكدة من DSH لمتجر محدد. لا تعرض هذه الصفحة المسودات أو المخزون الخاص،
          ولا تمنح صلاحية تعديل السعر أو النشر أو إنشاء طلب.</p>
      </header>

      <form action="/catalog" method="get" className={catalogStyles.filters} aria-label="تصفية العروض المنشورة">
        <label className={catalogStyles.field}>
          معرّف المتجر المنشور
          <input name="store" aria-label="معرّف المتجر المنشور" required
            pattern="[a-z0-9\-]{1,64}" maxLength={64} placeholder="market-sanaa"
            defaultValue={scope?.storeId ?? ""} autoComplete="off" />
        </label>
        <label className={catalogStyles.field}>
          البحث في العروض المنشورة
          <input name="q" aria-label="البحث في العروض" maxLength={80}
            defaultValue={scope?.query ?? ""} placeholder="اسم المنتج" />
        </label>
        <button type="submit" className={catalogStyles.submit}>عرض العروض</button>
      </form>

      {scope && !scope.storeId && !error ? (
        <div role="status" className={catalogStyles.empty}>
          <p>أدخل معرّف متجر منشور لعرض عروضه العامة، أو اختر المتجر من دليل السوق المنشور لدى DSH.</p>
          <a href="/workspace">اختيار المتجر من لمحة السوق</a>
        </div>
      ) : null}
      {error ? <p role="alert" className={catalogStyles.error}>{error}</p> : null}

      {store && offers && scope ? (
        <section className={catalogStyles.results} aria-label="العروض المنشورة لدى DSH">
          <div className={catalogStyles.resultsHeader}>
            <div>
              <h2>{store.name}</h2>
              <p role="status">العروض المعروضة في هذه الصفحة: {offers.items.length} من أصل صفحة محدودة بحد أقصى 20 عرضًا.</p>
            </div>
          </div>
          {offers.items.length === 0 ? (
            <p className={catalogStyles.empty}>لا توجد عروض منشورة مطابقة للبحث.</p>
          ) : (
            <div className={catalogStyles.tableScroll}>
              <table className={catalogStyles.table} aria-label="العروض المنشورة">
                <thead>
                  <tr>
                    <th scope="col">المنتج</th>
                    <th scope="col">حالة العرض</th>
                    <th scope="col">السعر المنشور</th>
                    <th scope="col">رقم العرض</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.items.map(offer => (
                    <tr key={offer.id}>
                      <td><strong>{offer.name}</strong></td>
                      <td>
                        <span className={offer.available ? catalogStyles.available : catalogStyles.unavailable}>
                          {offer.available ? "متاح" : "غير متاح"}
                        </span>
                      </td>
                      <td><code dir="ltr">{String(offer.priceYer)} YER</code></td>
                      <td><code dir="ltr">{offer.id}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <nav aria-label="صفحات العروض" className={catalogStyles.pagination}>
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
