import type { ReactNode } from "react";
import styles from "../operator-shell/operator-shell.module.css";

export default function StoresWorkspace({ title = "التجار والمتاجر", marketOverview }: Readonly<{
  title?: string;
  marketOverview?: ReactNode;
}>) {
  return (
    <main className={styles.workspace} aria-labelledby="stores-workspace-heading">
      <h1 id="stores-workspace-heading">{title}</h1>
      <p>تُقرأ حقائق المتاجر والكتالوج العام من المالك DSH؛ حساب التاجر منفصل عن مورد المتجر.</p>
      {marketOverview}
      <h2>القدرات المتصلة</h2>
      <ul className={styles.sectionGrid}>
        <li>
          <a className={styles.sectionCard} href="/merchants/joining">
            <strong>مراجعة المتاجر غير المنشورة</strong>
            <span>مراجعة حقائق التجهيز ونواقصها حسب المدينة والعلاقة، دون قرار نشر أو تفعيل.</span>
          </a>
        </li>
        <li>
          <a className={styles.sectionCard} href="/merchants/public-stores">
            <strong>المتاجر المعروضة للعملاء</strong>
            <span>استعراض آمن للمتاجر المنشورة بالقناة العامة حسب المدينة والبحث.</span>
          </a>
        </li>
      </ul>
      <section aria-label="قدرات لم تُفعّل بعد">
        <h2>قدرات تحتاج تكاملًا إضافيًا</h2>
        <p>إنشاء حساب تاجر ومعالجة طلب الانضمام وتفويض صلاحيات المتاجر وتعديل حالة النشر تتطلب
          عقود عمليات المالكين Identity وDSH؛ المراجعة الحالية للقراءة فقط.</p>
      </section>
    </main>
  );
}
