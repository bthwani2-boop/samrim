import { listPublicCities, listPublicVerticals, type PublicPage, type PublicVertical } from "@bthwani/dsh";
import styles from "../../../../src/features/operator-shell/operator-shell.module.css";
import WorkspaceUnavailable from "../../../../src/features/operator-shell/workspace-unavailable";
import { parsePublicStoreBrowse, resolvePublicDshOrigin } from "../../../../src/features/stores/public-store-query";
import { currentOperatorAccess } from "../../../../src/server/current-operator-access";

export const dynamic = "force-dynamic";

function categoryPageHref(city: string, cursor?: string): string {
  const params = new URLSearchParams({ city });
  if (cursor) params.set("cursor", cursor);
  return `/catalog/categories?${params.toString()}`;
}

export default async function Page({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  // Layout metadata never grants access; verify Identity again before reading DSH.
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("catalog")) {
    return <WorkspaceUnavailable title="الفئات" description="تحتاج هذه الصفحة صلاحية الكتالوج الحالية من Identity." owner="Identity" />;
  }

  const params = await searchParams;
  const scope = Object.keys(params).every(key => key === "city" || key === "cursor")
    ? parsePublicStoreBrowse(params) : null;
  const owner = resolvePublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN, process.env.NODE_ENV);
  let cities: PublicPage<string> | null = null;
  let verticals: PublicPage<PublicVertical> | null = null;
  let error = "";
  let citiesWarning = "";

  if (!scope) {
    error = "معرف المدينة أو الصفحة غير صالح. أعد اختيار المدينة.";
  } else if (!owner) {
    error = "اتصال DSH المعزول غير مهيأ. لا توجد فئات مؤكدة.";
  } else {
    const [citiesResult, verticalsResult] = await Promise.allSettled([
      listPublicCities(owner, { limit: 50, signal: AbortSignal.timeout(5000) }),
      scope.city ? listPublicVerticals(owner, scope.city, {
        ...(scope.cursor ? { cursor: scope.cursor } : {}),
        limit: 20,
        signal: AbortSignal.timeout(5000),
      }) : Promise.resolve(null),
    ]);
    if (citiesResult.status === "fulfilled") cities = citiesResult.value;
    else if (scope.city) citiesWarning = "تعذّر تحميل دليل المدن، ويمكن متابعة المدينة المحددة.";
    else error = "تعذّر تحميل المدن المعتمدة من DSH. أعد المحاولة.";

    if (scope.city) {
      if (verticalsResult.status === "fulfilled") verticals = verticalsResult.value;
      else error = "تعذّر تأكيد فئات المدينة من DSH أو انتهت صلاحية الصفحة. أعد القراءة من البداية.";
    }
  }

  return (
    <main className={styles.workspace} aria-labelledby="catalog-categories-title">
      <h1 id="catalog-categories-title">فئات الكتالوج — أنواع النشاط المنشورة</h1>
      <p>عرض للقراءة فقط من DSH لأنواع النشاط التي تضم متاجر عامة منشورة داخل المدينة.
        لا يعرض الفئات الداخلية أو المسودات، ولا يتيح إنشاء فئة أو تغيير تصنيف أو صلاحيات متجر.</p>
      <form action="/catalog/categories" method="get" style={{
        display: "flex", alignItems: "end", flexWrap: "wrap", gap: "0.75rem", marginBlock: "1rem",
      }}>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          معرف المدينة المعتمدة
          <input name="city" aria-label="معرف المدينة" required
            list="operator-catalog-city-options" pattern="[a-z0-9-]{1,64}"
            maxLength={64} defaultValue={scope?.city ?? ""} placeholder="sanaa"
            style={{ minHeight: 44 }} />
          {cities ? <datalist id="operator-catalog-city-options">
            {cities.items.map(city => <option key={city} value={city} />)}
          </datalist> : null}
        </label>
        <button type="submit" style={{ minHeight: 44, paddingInline: "1rem", cursor: "pointer" }}>
          عرض أنواع النشاط
        </button>
      </form>
      {citiesWarning ? <p role="status">{citiesWarning}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {scope && !scope.city && !error ? <p role="status">اختر مدينة لقراءة أنواع النشاط من DSH.</p> : null}
      {verticals && scope?.city ? (
        <section aria-label="أنواع النشاط المنشورة">
          <p role="status">عدد الأنواع في الصفحة: {verticals.items.length} — مراجعة DSH: {verticals.revision}</p>
          {verticals.items.length === 0 ? <p>لا توجد أنواع نشاط منشورة في هذه المدينة.</p> : (
            <ul className={styles.sectionGrid}>
              {verticals.items.map(vertical => (
                <li key={vertical.id} className={styles.sectionCard}>
                  <strong>{vertical.id}</strong>
                  <span>متاجر منشورة في المدينة: {vertical.storeCount}</span>
                </li>
              ))}
            </ul>
          )}
          <nav aria-label="صفحات أنواع النشاط" style={{
            display: "flex", gap: "1rem", flexWrap: "wrap", marginBlock: "1rem",
          }}>
            {scope.cursor ? <a href={categoryPageHref(scope.city)}>العودة إلى أول صفحة</a> : null}
            {verticals.nextCursor ? <a href={categoryPageHref(scope.city, verticals.nextCursor)}>
              الصفحة التالية
            </a> : null}
          </nav>
        </section>
      ) : null}
    </main>
  );
}
