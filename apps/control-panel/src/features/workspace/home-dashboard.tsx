import styles from "../operator-shell/operator-shell.module.css";
import { type OperatorPermission, visibleWorkspaceEntries } from "../session/operator-permissions";

export default function HomeDashboard({ grants }: Readonly<{ grants: readonly OperatorPermission[] }>) {
  const entries = visibleWorkspaceEntries(grants).filter(entry => entry.href !== "/workspace");
  const activePolicies = entries.find(entry => entry.href === "/policies");
  const pendingSections = entries.filter(entry => entry.href !== "/policies");

  return (
    <main className={styles.workspace} aria-labelledby="operator-home-title">
      <h1 id="operator-home-title">مساحة عمل المشغّل</h1>
      {activePolicies && (
        <a className={styles.sectionCard} href={activePolicies.href}>
          <strong>سياسات إتاحة المتاجر</strong>
          <span>قراءة حدود الإيقاف والتحضير وتعديلها عبر خدمة DSH عند اتصالها.</span>
        </a>
      )}
      {pendingSections.length > 0 && (
        <section aria-labelledby="operator-pending-sections">
          <h2 id="operator-pending-sections">أقسام بانتظار ربط الخدمة</h2>
          <ul className={styles.sectionGrid}>
            {pendingSections.map(entry => (
              <li key={entry.href}><a className={styles.sectionCard} href={entry.href}>{entry.label}</a></li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
