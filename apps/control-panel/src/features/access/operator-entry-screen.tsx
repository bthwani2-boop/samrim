import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentOperatorAccessState } from "../../server/current-operator-access";
import {
  canonicalOperatorEntryRedirect,
  OPERATOR_REFRESH_COOKIE,
  resolveInitialOperatorBootstrapConfig,
  resolveIsolatedOperatorConfig,
  resolveOperatorRecoveryConfig,
} from "../../server/operator-passkey-bff";
import styles from "../operator-shell/operator-shell.module.css";
import OperatorBootstrapForm from "./operator-bootstrap-form";
import OperatorPasskeyForm from "./operator-passkey-form";
import { operatorIdentityUnavailableMessage } from "./operator-workspace-gate";

export default async function OperatorEntryScreen() {
  const requestHeaders = await headers();
  const canonicalEntry = canonicalOperatorEntryRedirect(requestHeaders.get("host"));
  if (canonicalEntry) redirect(canonicalEntry);
  const state = await currentOperatorAccessState();
  if (state.status === "verified" && state.access.grants.length) redirect("/workspace");

  const isolated = resolveIsolatedOperatorConfig(process.env);
  const bootstrap = resolveInitialOperatorBootstrapConfig(process.env);
  const recovery = resolveOperatorRecoveryConfig(process.env);
  const signInOnThisAddress = isolated &&
    requestHeaders.get("host") === new URL(isolated.browserOrigin).host;
  // A retained refresh credential is not authority to enter the workspace.
  // It only enables the existing Identity recovery action on the canonical origin.
  const recoverable = signInOnThisAddress &&
    /^[A-Za-z0-9_-]{43}$/.test((await cookies()).get(OPERATOR_REFRESH_COOKIE)?.value ?? "");
  return (
    <main className={styles.entryLayout} aria-labelledby="operator-entry-title">
      <section className={styles.entryPanel} aria-labelledby="operator-entry-title">
        <h1 id="operator-entry-title">دخول المشغّل</h1>
        {state.status === "unavailable" ? (
          <div className={styles.entryStatus}>
            <p role="alert">{operatorIdentityUnavailableMessage}</p>
            <a href="/">إعادة المحاولة</a>
          </div>
        ) : state.status === "verified" ? (
          <p className={styles.entryStatus} role="status">
            تم التحقق من حسابك. اطلب من مسؤول الوصول منحك صلاحية لمساحة العمل المطلوبة.
          </p>
        ) : recoverable ? (
          <OperatorPasskeyForm recoveryOnly />
        ) : signInOnThisAddress ? (
          <>
            <OperatorPasskeyForm />
            {bootstrap && <OperatorBootstrapForm mode="initial" />}
            {recovery && <OperatorBootstrapForm mode="recovery" />}
          </>
        ) : isolated ? (
          <>
            <p>يتطلب مفتاح المرور استخدام عنوان الدخول المحلي المعتمد.</p>
            <a className={styles.primaryLink} href={isolated.browserOrigin}>فتح عنوان الدخول المعتمد</a>
          </>
        ) : (
          <>
            <div className={styles.entryStatus} role="status">
              <strong>تسجيل دخول المشغّلين غير متاح على هذه النسخة.</strong>
              <p>راجع مسؤول التشغيل لتفعيل الدخول بمفتاح المرور.</p>
            </div>
            <details className={styles.entryDetails}>
              <summary>متطلبات تفعيل الدخول</summary>
              <ol>
                <li>التحقق من حساب المشغّل الأصلي واعتماد الاستعادة لدى Identity.</li>
                <li>تسجيل مفتاح مرور موثّق لصاحب الحساب.</li>
                <li>تفعيل الدخول على العنوان المعتمد والتحقق من صلاحيات الأقسام.</li>
              </ol>
            </details>
          </>
        )}
      </section>
    </main>
  );
}
