import { getStoreOperationalAvailability, type StoreOperationalAvailability } from "@bthwani/dsh";
import { cookies } from "next/headers";
import { parseStoreAvailabilityQuery } from "../../../../src/features/operations/store-availability-query";
import StorePauseForm from "../../../../src/features/operations/store-pause-form";
import styles from "../../../../src/features/operator-shell/operator-shell.module.css";
import WorkspaceUnavailable from "../../../../src/features/operator-shell/workspace-unavailable";
import { resolvePublicDshOrigin } from "../../../../src/features/stores/public-store-query";
import { currentOperatorAccess } from "../../../../src/server/current-operator-access";
import { OPERATOR_COOKIE } from "../../../../src/server/operator-passkey-bff";

export const dynamic = "force-dynamic";

const weekdays = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const localClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export default async function StoreOperationalInspector({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("operations")) {
    return <WorkspaceUnavailable title="إتاحة المتجر التشغيلية" description="تتطلب بيانات التشغيل الخاصة صلاحية operations من Identity." owner="Identity" />;
  }

  const storeId = parseStoreAvailabilityQuery(await searchParams);
  const owner = resolvePublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN, process.env.NODE_ENV);
  let snapshot: StoreOperationalAvailability | null = null;
  let message = "";
  if (storeId === null) {
    message = "معرّف المتجر أو معاملات الرابط غير صالحة. أعد البحث.";
  } else if (storeId) {
    const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
    if (!bearer || !/^[A-Za-z0-9_-]{43}$/.test(bearer)) {
      message = "الجلسة غير مؤكدة لدى Identity. أعد تسجيل الدخول.";
    } else if (!owner) {
      message = "اتصال DSH المعزول غير مهيأ؛ لا يمكن عرض بيانات التشغيل.";
    } else {
      try {
        snapshot = await getStoreOperationalAvailability(
          owner, storeId, bearer, AbortSignal.timeout(5000),
        );
      } catch {
        message = "رفض المالك قراءة المتجر أو تعذّر الاتصال. لا تُعرض بيانات تشغيل غير مؤكدة.";
      }
    }
  }

  return (
    <main className={styles.workspace} aria-labelledby="availability-inspector-heading">
      <h1 id="availability-inspector-heading">إتاحة المتجر التشغيلية</h1>
      <p>راجع جدول تشغيل المتجر وأوقف استقبال الطلبات مؤقتًا عند الحاجة.</p>
      <form action="/operations/store-availability" method="get" style={{
        display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end", marginBlock: "1rem",
      }}>
        <label style={{ display: "grid", gap: "0.25rem", flex: "1 1 15rem" }}>
          معرّف المتجر في DSH
          <input name="storeId" aria-label="معرّف المتجر" required
            maxLength={64} pattern="[a-z0-9-]{1,64}"
            defaultValue={storeId ?? ""} placeholder="معرّف متجر فعلي"
            style={{ minHeight: 44, width: "100%" }} />
        </label>
        <button type="submit" style={{ minHeight: 44, paddingInline: "1rem", cursor: "pointer" }}>
          قراءة الحالة الحالية
        </button>
      </form>
      {!storeId && !message ? <p role="status">حدد متجرًا لقراءة جدول تشغيله الحالي.</p> : null}
      {message ? <p role="alert">{message}</p> : null}
      {snapshot && (
        <section aria-labelledby="availability-current-heading">
          <h2 id="availability-current-heading">الحالة الحالية المؤكدة</h2>
          <p>المتجر: <code dir="ltr">{snapshot.storeId}</code> — الإصدار: {snapshot.version}</p>
          <p>المنطقة الزمنية: <code dir="ltr">{snapshot.timezone}</code></p>
          <p>مدة التجهيز: {snapshot.preparationMinutes} دقيقة</p>
          <p>الإيقاف المؤقت حتى: {snapshot.pausedUntil ?? "لا يوجد إيقاف مؤقت"}</p>
          <h2>ساعات العمل المعتمدة</h2>
          {snapshot.weekly === null ? <p>لم يُحدد جدول أسبوعي لدى المالك.</p> : snapshot.weekly.length === 0 ?
            <p>المتجر مغلق طوال الأسبوع بحسب السجل الحالي.</p> : (
              <ul className={styles.sectionGrid}>
                {snapshot.weekly.map(period => (
                  <li key={`${period.weekday}-${period.opens}-${period.closes}`} className={styles.sectionCard}>
                    <strong>{weekdays[period.weekday] ?? "يوم غير معروف"}</strong>
                    <span dir="ltr">{localClock(period.opens)} – {localClock(period.closes)}</span>
                  </li>
                ))}
              </ul>
            )}
          <p>سبب التعديل المسجل: {snapshot.reason}</p>
          <p>آخر تعديل بواسطة صاحب الصلاحية لدى المالك: <code dir="ltr">{snapshot.actingActorId}</code></p>
          {snapshot.weekly !== null ? (
            <StorePauseForm key={JSON.stringify([access.actorId, snapshot.storeId, snapshot.version])}
              snapshot={snapshot} actorId={access.actorId} />
          ) : null}
        </section>
      )}
    </main>
  );
}
