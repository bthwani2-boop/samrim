import { headers } from "next/headers";
import { redirect } from "next/navigation";
import styles from "../operator-shell/operator-shell.module.css";
import { currentOperatorAccess } from "../../server/current-operator-access";
import { resolveIsolatedOperatorConfig } from "../../server/operator-passkey-bff";
import OperatorPasskeyForm from "./operator-passkey-form";

export default async function OperatorEntryScreen() {
  const [access, requestHeaders] = await Promise.all([currentOperatorAccess(), headers()]);
  if (access?.grants.length) redirect("/workspace");

  const isolated = resolveIsolatedOperatorConfig(process.env);
  const signInOnThisAddress = isolated &&
    requestHeaders.get("host") === new URL(isolated.browserOrigin).host;
  return (
    <main className={styles.landing} aria-labelledby="operator-entry-title">
      <h1 id="operator-entry-title">لوحة تحكم بثواني</h1>
      {access ? (
        <p role="status">
          تم التحقق من حسابك. اطلب من مسؤول الوصول منحك صلاحية لمساحة العمل المطلوبة.
        </p>
      ) : signInOnThisAddress ? (
        <OperatorPasskeyForm />
      ) : isolated ? (
        <>
          <p>يتطلب مفتاح المرور استخدام عنوان الدخول المحلي المعتمد.</p>
          <a className={styles.primaryLink} href={isolated.browserOrigin}>فتح عنوان الدخول المعتمد</a>
        </>
      ) : (
        <>
          <p role="status">تسجيل دخول المشغّلين غير متاح على هذه النسخة.</p>
          <p>للوصول إلى أقسام العمل، استخدم بيئة دخول معتمدة ومفتاح مرور مسجّل لحسابك.</p>
        </>
      )}
    </main>
  );
}
