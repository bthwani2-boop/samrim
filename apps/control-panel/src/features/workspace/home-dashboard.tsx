import type { ReactNode } from "react";
import { type WorkspaceGroup, workspaceGroupLabels } from "../navigation/workspace-registry";
import { OperatorIcon, type OperatorIconName } from "../operator-shell/operator-icon";
import styles from "../operator-shell/operator-shell.module.css";
import { type OperatorPermission, visibleWorkspaceEntries } from "../session/operator-permissions";
import dashboardStyles from "./home-dashboard.module.css";

const ownerLabels = { Identity: "الهوية", DSH: "الخدمات والتجارة", WLT: "المالية", multiple: "أنظمة متعددة" } as const;

export default function HomeDashboard({ grants, originalOperator = false, marketOverview }: Readonly<{
  grants: readonly OperatorPermission[];
  originalOperator?: boolean;
  marketOverview?: ReactNode;
}>) {
  const entries = visibleWorkspaceEntries(grants, originalOperator).filter(entry => entry.href !== "/workspace");
  const sections = (Object.keys(workspaceGroupLabels) as WorkspaceGroup[])
    .filter(group => group !== "home")
    .map(group => ({
      group,
      label: workspaceGroupLabels[group],
      entries: entries.filter(entry => entry.group === group),
    }))
    .filter(section => section.entries.length > 0);
  const hasVerifiedAccess = grants.length > 0 || originalOperator;
  const actionIcons: Record<WorkspaceGroup, OperatorIconName> = {
    home: "home", operations: "operations", stores: "store", catalog: "catalog",
    marketing: "marketing", finance: "finance", administration: "people", policies: "policy",
  };
  const date = new Intl.DateTimeFormat("ar-YE", {
    timeZone: "Asia/Aden", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date());

  const facts: { label: string; value: string; note: string; icon: OperatorIconName; available: boolean }[] = [
    { label: "مجموعات العمل", value: String(sections.length), note: hasVerifiedAccess ? "مصرّح بها من Identity" : "لا توجد صلاحيات مؤكدة", icon: "layers", available: hasVerifiedAccess },
    { label: "الوظائف المتاحة", value: String(entries.length), note: "يمكن الانتقال إليها", icon: "check", available: hasVerifiedAccess },
  ];

  return (
    <main className={`${styles.workspace} ${dashboardStyles.dashboard}`} aria-labelledby="operator-home-title">
      <header className={dashboardStyles.pageIntro}>
        <div>
          <span className={dashboardStyles.eyebrow}>الرئيسية / لوحة التحكم</span>
          <h1 id="operator-home-title">مرحبًا بك في لوحة تحكم بثواني</h1>
          <p>{hasVerifiedAccess ? "إدارة العمل من مساحة واحدة، وفق صلاحياتك المؤكدة من Identity." : "لا توجد صلاحيات مؤكدة لعرض مساحات العمل."}</p>
        </div>
        <div className={dashboardStyles.dateStamp}>
          <OperatorIcon name="clock" />
          <span>{date}</span>
        </div>
      </header>

      <section aria-label="ملخص الصلاحيات الحالية" className={dashboardStyles.statsGrid}>
        {facts.map(fact => (
          <article key={fact.label} className={dashboardStyles.metricCard}>
            <div className={dashboardStyles.metricIcon}><OperatorIcon name={fact.icon} /></div>
            <div className={dashboardStyles.metricBody}>
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
              <small className={fact.available ? dashboardStyles.verifiedNote : dashboardStyles.unavailableNote}>
                {fact.note}
              </small>
            </div>
          </article>
        ))}
      </section>

      <section className={dashboardStyles.panel} aria-labelledby="quick-actions-heading">
        <header className={dashboardStyles.panelHeading}>
          <h2 id="quick-actions-heading"><OperatorIcon name="activity" /> إجراءات سريعة</h2>
        </header>
        {entries.length > 0 ? (
          <ul className={[dashboardStyles.actionList, styles.sectionGrid].join(" ")}>
            {entries.map(entry => <li key={entry.href}>
              <a href={entry.href}>
                <OperatorIcon name={entry.href === "/captains" ? "captain" : entry.href === "/studio" ? "studio" :
                  entry.href === "/access" ? "shield" : actionIcons[entry.group]} />
                <span>{entry.label}</span>
                <OperatorIcon name="arrow" />
              </a>
            </li>)}
          </ul>
        ) : <p className={dashboardStyles.panelHint}>لا توجد إجراءات سريعة مصرح بها حاليًا.</p>}
      </section>

      {marketOverview && (
        <div className={dashboardStyles.marketPanel}>{marketOverview}</div>
      )}

      <section className={dashboardStyles.panel} aria-labelledby="operational-status-heading">
        <header className={dashboardStyles.panelHeading}>
          <h2 id="operational-status-heading"><OperatorIcon name="bell" /> حالة الأنظمة والبيانات</h2>
        </header>
        <ul className={dashboardStyles.statusList}>
          <li><span className={hasVerifiedAccess ? dashboardStyles.statusDotGood : dashboardStyles.statusDotNeutral} /><span>صلاحيات المشغّل</span><strong>{hasVerifiedAccess ? "مؤكدة" : "غير مؤكدة"}</strong></li>
          <li><span className={dashboardStyles.statusDotNeutral} /><span>بيانات DSH العامة</span><strong>تُقرأ عند الطلب</strong></li>
          <li><span className={dashboardStyles.statusDotNeutral} /><span>الأرصدة والتسويات</span><strong>ليست معروضة</strong></li>
        </ul>
        <p className={dashboardStyles.panelHint}>إحصاءات الطلبات وإجمالي المتاجر والأرصدة غير متاحة في هذه الصفحة حاليًا.</p>
        {entries.length > 0 && <a className={dashboardStyles.panelLink} href="/health">عرض حالة الواجهة <OperatorIcon name="arrow" /></a>}
      </section>

      <section className={dashboardStyles.tablePanel} aria-labelledby="enabled-destinations-heading">
        <header className={dashboardStyles.panelHeading}>
          <h2 id="enabled-destinations-heading"><OperatorIcon name="operations" /> الوظائف المتاحة للمشغّل</h2>
          <span className={dashboardStyles.readonlyLabel}>الصلاحيات الحالية</span>
        </header>
        <div className={dashboardStyles.tableScroll}>
          <table className={dashboardStyles.table}>
            <thead><tr><th scope="col">الوظيفة</th><th scope="col">الخدمة المالكة</th><th scope="col">الوصول</th></tr></thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.href}>
                  <td><a href={entry.href}>{entry.label}</a></td>
                  <td>{ownerLabels[entry.owner]}</td>
                  <td><span className={dashboardStyles.accessLabel}>مسموح بالتنقل</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <p role="status" className={dashboardStyles.noAccess}>لا توجد وظائف مصرح بها.</p>}
        </div>
      </section>

      <details aria-label="الأقسام المصرح بها" className={dashboardStyles.sections}>
        <summary className={dashboardStyles.disclosureSummary}>جميع الأقسام المتاحة <span>{sections.length} مجموعات</span></summary>
        <div className={dashboardStyles.sectionsTitle}>
          <h2>الأقسام المتاحة لك</h2>
          <span>{sections.length} مجموعات</span>
        </div>
        {sections.length === 0 && (
          <p role="status" className={dashboardStyles.noAccess}>لا توجد وظائف إدارية متاحة وفق الصلاحيات الحالية.</p>
        )}
        <div className={dashboardStyles.groupGrid}>
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
        </div>
      </details>
    </main>
  );
}
