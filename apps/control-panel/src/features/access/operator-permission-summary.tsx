import {
  identityOperatorPermissions, type IdentityOperatorPermission, type OperatorPermissionRevision,
} from "@bthwani/identity";
import styles from "../operator-shell/operator-shell.module.css";

const labels: Record<IdentityOperatorPermission, string> = {
  operations: "العمليات",
  merchant: "التجّار",
  catalog: "الكتالوج",
  marketing: "التسويق",
  finance: "المالية",
  hr: "الموظفون",
  platform_policies: "سياسات المنصّة",
};

export default function OperatorPermissionSummary({ permissions }: Readonly<{
  permissions: readonly OperatorPermissionRevision[];
}>) {
  const byScope = new Map(permissions.map(item => [item.permission, item]));
  return (
    <ul className={styles.sectionGrid} aria-label="حالة الصلاحيات وإصداراتها">
      {identityOperatorPermissions.map(permission => {
        const revision = byScope.get(permission);
        return (
          <li key={permission} className={styles.sectionCard}>
            <strong>{labels[permission]}</strong>
            <span>{revision?.state === "ACTIVE" ? "فعّالة" : revision ? "ملغاة" : "غير ممنوحة"}</span>
            {revision && <span>الإصدار {revision.version}</span>}
          </li>
        );
      })}
    </ul>
  );
}
