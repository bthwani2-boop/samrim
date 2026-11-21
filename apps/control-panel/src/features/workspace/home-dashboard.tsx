import { type WorkspaceGroup, workspaceGroupLabels } from "../navigation/workspace-registry";
import styles from "../operator-shell/operator-shell.module.css";
import { type OperatorPermission, visibleWorkspaceEntries } from "../session/operator-permissions";

export default function HomeDashboard({ grants }: Readonly<{ grants: readonly OperatorPermission[] }>) {
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
      <h1 id="operator-home-title">مساحة عمل المشغّل</h1>
      <p>تظهر الأقسام المسموح بها وفق صلاحيات Identity الحالية. تُقرأ بيانات كل قسم من خدمته المالكة عند فتحه؛ ظهور الرابط لا يعني أن الخدمة متصلة.</p>
      {sections.map(section => (
        <section key={section.group} aria-labelledby={`operator-section-${section.group}`}>
          <h2 id={`operator-section-${section.group}`}>{section.label}</h2>
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
    </main>
  );
}
