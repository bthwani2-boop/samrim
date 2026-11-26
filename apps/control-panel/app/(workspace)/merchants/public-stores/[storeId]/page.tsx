import {
  getPublicStore, listPublicOffers, type PublicOffer, type PublicPage, type PublicStore,
} from "@bthwani/dsh";
import styles from "../../../../../src/features/operator-shell/operator-shell.module.css";
import WorkspaceUnavailable from "../../../../../src/features/operator-shell/workspace-unavailable";
import {
  parsePublicStoreDetail, publicStoreDetailHref, publicStorePageHref, resolvePublicDshOrigin,
} from "../../../../../src/features/stores/public-store-query";
import { currentOperatorAccess } from "../../../../../src/server/current-operator-access";

export const dynamic = "force-dynamic";

const statusLabels: Record<PublicStore["orderabilityStatus"], string> = {
  OPEN_FOR_ORDERS: "مفتوح تشغيليًا",
  CLOSED_BY_SCHEDULE: "مغلق حسب الجدول",
  PAUSED: "موقوف مؤقتًا",
  OPERATIONALLY_UNAVAILABLE: "غير متاح تشغيليًا",
};

export default async function PublicStoreOffers({
  params, searchParams,
}: Readonly<{
  params: Promise<{ storeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("merchant")) {
    return <WorkspaceUnavailable title="العروض العامة" description="تتطلب هذه القراءة صلاحية إدارة التجار الحالية من Identity." owner="Identity" />;
  }

  const { storeId } = await params;
  const scope = parsePublicStoreDetail(storeId, await searchParams);
  const owner = resolvePublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN, process.env.NODE_ENV);
  let store: PublicStore | null = null;
  let offers: PublicPage<PublicOffer> | null = null;
  let error = "";
  let offersError = "";
  if (!scope) {
    error = "رابط المتجر أو المدينة أو الصفحة غير صالح. عد إلى دليل المتاجر.";
  } else if (!owner) {
    error = "اتصال DSH المعزول غير مُهيأ. لا يمكن تأكيد بيانات المتجر.";
  } else {
    try {
      const verified = await getPublicStore(owner, scope.storeId, AbortSignal.timeout(5000));
      if (verified.cityId !== scope.city || (scope.vertical && verified.verticalId !== scope.vertical)) {
        error = "المتجر لا ينتمي إلى المدينة أو نوع النشاط المحدد. أعد البحث من الدليل.";
      } else {
        store = verified;
      }
    } catch {
      error = "لم يتم تأكيد بيانات المتجر لدى DSH. قد يكون النشر تغير أو الخدمة غير متاحة.";
    }
    if (store) {
      try {
        offers = await listPublicOffers(owner, store.id, {
          ...(scope.offerQuery ? { query: scope.offerQuery } : {}),
          ...(scope.cursor ? { cursor: scope.cursor } : {}),
          limit: 20,
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        offersError = "تعذّر قراءة العروض الحالية أو انتهت صلاحية الصفحة؛ أعد العرض من البداية.";
      }
    }
  }

  const directory = scope ? { city: scope.city, query: scope.query, vertical: scope.vertical } : null;
  const firstPage = scope && directory ? publicStoreDetailHref(scope.storeId, { ...directory, offerQuery: scope.offerQuery }) : "";
  return (
    <main className={styles.workspace} aria-labelledby="public-offers-heading">
      <h1 id="public-offers-heading">تفاصيل المتجر وعروضه العامة</h1>
      <p>بيانات منشورة مصدرها DSH مباشرة، للقراءة فقط؛ لا تمثل صلاحية إدارة المتجر أو تأكيد إنشاء طلب.</p>
      <a href={directory ? publicStorePageHref(directory) : "/merchants/public-stores"}>
        العودة إلى دليل المتاجر
      </a>
      {error ? <p role="alert">{error}</p> : null}
      {store && scope && directory ? (
        <section aria-labelledby="store-overview-title">
          <h2 id="store-overview-title">{store.name}</h2>
          <p>معرّف المتجر: <code dir="ltr">{store.id}</code></p>
          <p>المدينة: {store.cityId} — القطاع: {store.verticalId}</p>
          <p>الحالة: {statusLabels[store.orderabilityStatus]}</p>
          <p>إتمام الطلب غير متاح من لوحة التحكم. لا تستنتج أهلية الدفع أو التوصيل من هذه البيانات.</p>
          <h2>العروض المنشورة والمتاحة</h2>
          <form method="get" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end" }}>
            <input type="hidden" name="city" value={scope.city} />
            {scope.query ? <input type="hidden" name="q" value={scope.query} /> : null}
            {scope.vertical ? <input type="hidden" name="vertical" value={scope.vertical} /> : null}
            <label style={{ display: "grid", gap: "0.25rem", flex: "1 1 12rem" }}>
              اسم العرض
              <input name="offerQ" type="search" defaultValue={scope.offerQuery ?? ""} maxLength={160}
                style={{ minHeight: 44 }} />
            </label>
            <button type="submit" style={{ minHeight: 44, paddingInline: "1rem" }}>البحث في عروض المتجر</button>
            {scope.offerQuery ? <a href={publicStoreDetailHref(store.id, directory)}>مسح بحث العروض</a> : null}
          </form>
          {offersError ? (
            <p role="alert">{offersError} <a href={firstPage}>إعادة تحميل أول صفحة</a></p>
          ) : null}
          {offers && (
            <>
              <p role="status">العروض في هذه الصفحة: {offers.items.length} — مراجعة DSH: {offers.revision}</p>
              {offers.items.length === 0 ? <p>{scope.offerQuery ? "لا توجد عروض مطابقة لهذا البحث." : "لا توجد عروض منشورة صالحة للعرض حاليًا."}</p> : (
                <ul className={styles.sectionGrid}>
                  {offers.items.map(offer => (
                    <li key={offer.id} className={styles.sectionCard}>
                      <strong>{offer.name}</strong>
                      <span>السعر الحالي من DSH: <b>{BigInt(offer.priceYer).toLocaleString("ar-YE")} ر.ي</b></span>
                      <span>المعرّف: <code dir="ltr">{offer.id}</code></span>
                    </li>
                  ))}
                </ul>
              )}
              <nav aria-label="صفحات عروض المتجر" style={{
                display: "flex", gap: "1rem", marginBlock: "1rem",
              }}>
                {scope.cursor ? <a href={firstPage}>أول صفحة عروض</a> : null}
                {offers.nextCursor ? <a href={publicStoreDetailHref(scope.storeId, {
                  ...directory, offerQuery: scope.offerQuery, cursor: offers.nextCursor,
                })}>عرض المزيد من العروض</a> : null}
              </nav>
            </>
          )}
        </section>
      ) : null}
    </main>
  );
}
