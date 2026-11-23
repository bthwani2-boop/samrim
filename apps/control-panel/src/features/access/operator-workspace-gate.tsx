import styles from "../operator-shell/operator-shell.module.css";

export const operatorIdentityUnavailableMessage =
  "تعذّر التحقق من الجلسة والصلاحيات لدى Identity. أعد تحميل الصفحة للمحاولة مجددًا.";

export default function OperatorWorkspaceGate({ hasWorkspace, identityUnavailable }: Readonly<{
  hasWorkspace: boolean;
  identityUnavailable?: boolean;
}>) {
  return (
    <main className={styles.landing} aria-labelledby="workspace-denied-title">
      <h1 id="workspace-denied-title">لوحة تحكم بثواني</h1>
      <p role="alert">الوصول إلى هذه المساحة غير متاح.</p>
      <p>{identityUnavailable ? operatorIdentityUnavailableMessage : hasWorkspace
        ? "حسابك لا يملك الصلاحية الحالية لهذا القسم."
        : "تتطلب مساحة العمل جلسة مشغّل وصلاحية سارية."}</p>
      <a className={styles.primaryLink} href={hasWorkspace ? "/workspace" : "/"}>
        {hasWorkspace ? "العودة إلى مساحة العمل" : "فتح صفحة دخول المشغّل"}
      </a>
    </main>
  );
}
