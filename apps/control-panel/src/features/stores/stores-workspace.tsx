import styles from "../operator-shell/operator-shell.module.css";

export default function StoresWorkspace({ title = "الشركاء والمتاجر" }: Readonly<{ title?: string }>) {
  return (
    <main className={styles.workspace} aria-labelledby="stores-workspace-heading">
      <h1 id="stores-workspace-heading">{title}</h1>
      <p>تُقرأ حالة النشر والكتالوج العام من المالك DSH؛ حساب Merchant منفصل عن مورد Store.</p>
      <h2>القدرات المتصلة</h2>
      <ul className={styles.sectionGrid}>
        <li>
          <a className={styles.sectionCard} href="/merchants/public-stores">
            <strong>المتاجر المعروضة للعملاء</strong>
            <span>استعراض آمن للمتاجر المنشورة بالقناة العامة حسب المدينة والبحث.</span>
          </a>
        </li>
      </ul>
      <section aria-label="قدرات لم تُفعّل بعد">
        <h2>قدرات تحتاج تكاملًا إضافيًا</h2>
        <p>انضمام التجار، صلاحيات إدارة المتاجر وتعديل حالة النشر تتطلب تحققًا مستقلًا من
          Identity وDSH وعقود العمليات؛ لا توجد أزرار تعديل صورية.</p>
      </section>
    </main>
  );
}
