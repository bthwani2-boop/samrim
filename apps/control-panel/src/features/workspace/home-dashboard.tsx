import type { ReactNode } from "react";
import { type WorkspaceGroup, workspaceGroupLabels } from "../navigation/workspace-registry";
import styles from "../operator-shell/operator-shell.module.css";
import { type OperatorPermission, visibleWorkspaceEntries } from "../session/operator-permissions";
import dashboardStyles from "./home-dashboard.module.css";

export default function HomeDashboard({ grants, marketOverview }: Readonly<{ grants: readonly OperatorPermission[]; marketOverview?: ReactNode }>) {
  const entries = visibleWorkspaceEntries(grants).filter(entry => entry.href !== "/workspace");
  const sections = (Object.keys(workspaceGroupLabels) as WorkspaceGroup[])
    .filter(group => group !== "home")
    .map(group => ({
      group,
      label: workspaceGroupLabels[group],
      entries: entries.filter(entry => entry.group === group),
    }))
    .filter(section => section.entries.length > 0);

  return (
    <main className={styles.workspace} aria-labelledby="operator-home-title">
      <section className={dashboardStyles.hero}>
        <div className={dashboardStyles.heroCopy}>
          <span className={dashboardStyles.eyebrow}>المساحة التشغيلية</span>
          <h1 id="operator-home-title">مساحة عمل المشغّل</h1>
          <p>تظهر الأقسام المسموح بها وفق صلاحيات Identity الحالية. تُقرأ بيانات كل قسم من خدمته المالكة عند فتحه؛ ظهور الرابط لا يعني أن الخدمة متصلة.</p>
        </div>
        <section className={dashboardStyles.rightsSummary} aria-label="ملخص الصلاحيات الحالية">
          <div>
            <strong>{sections.length}</strong>
            <span>مجموعات عمل متاحة</span>
          </div>
          <div>
            <strong>{entries.length}</strong>
            <span>وظائف مسموح بها</span>
          </div>
        </section>
      </section>
      {marketOverview && <div className={dashboardStyles.marketPanel}>{marketOverview}</div>}
      <section aria-label="الأقسام المصرح بها" className={dashboardStyles.sections}>
        <h2>الأقسام المتاحة لك</h2>
        {sections.length === 0 && (
          <p role="status" className={dashboardStyles.noAccess}>لا توجد وظائف إدارية متاحة وفق الصلاحيات الحالية.</p>
        )}
        {sections.map(section => (
          <section key={section.group} className={dashboardStyles.group} aria-labelledby={`operator-section-${section.group}`}>
            <div className={dashboardStyles.groupHeading}>
              <h3 id={`operator-section-${section.group}`}>{section.label}</h3>
              <span>{section.entries.length} وظيفة</span>
            </div>
            <ul className={styles.sectionGrid}>
              {section.entries.map(entry => (
                <li key={entry.href}>
                  <a className={styles.sectionCard} href={entry.href}>
                    {entry.href === "/policies" ? (
                      <>
                        <strong>سياسات إتاحة المتاجر</strong>
                        <span>قراءة حدود الإيقاف والتحضير وتعديلها عبر خدمة DSH عند اتصالها.</span>
                      </>
                    ) : entry.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
    </main>
  );
}
