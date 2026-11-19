import styles from "../operator-shell/operator-shell.module.css";

export default function OrdersWorkspace({ title = "العمليات والطلبات" }: Readonly<{ title?: string }>) {
  return (
    <main className={styles.workspace} aria-labelledby="operations-heading">
      <h1 id="operations-heading">{title}</h1>
      <p>أدوات التشغيل مرتبطة بصلاحية operations الحالية لدى Identity وحقائق DSH.</p>
      <h2>القدرات المتصلة</h2>
      <ul className={styles.sectionGrid}>
        <li>
          <a className={styles.sectionCard} href="/operations/store-availability">
            <strong>جدول وإتاحة متجر</strong>
            <span>التحقق من ساعات التشغيل والإيقاف المؤقت ووقت التجهيز عبر DSH.</span>
          </a>
        </li>
      </ul>
      <section aria-label="قدرات غير مفعلة">
        <h2>الطلبات والتوزيع</h2>
        <p>إدارة الطلبات والإسناد والاستثناءات تتطلب ربطًا مثبتًا بعقود DSH
          والصلاحيات وحالات الطلب الحقيقية؛ لن تظهر بيانات تشغيل أو أوامر صورية.</p>
      </section>
    </main>
  );
}
