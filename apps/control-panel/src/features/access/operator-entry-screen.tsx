import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentOperatorAccess } from "../../server/current-operator-access";
import { resolveIsolatedOperatorConfig } from "../../server/operator-passkey-bff";
import { workspaceRegistry } from "../navigation/workspace-registry";
import styles from "../operator-shell/operator-shell.module.css";
import OperatorBootstrapForm from "./operator-bootstrap-form";
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
        <>
          <OperatorPasskeyForm />
          {process.env.OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF === "true" && <OperatorBootstrapForm />}
        </>
      ) : isolated ? (
        <>
          <p>يتطلب مفتاح المرور استخدام عنوان الدخول المحلي المعتمد.</p>
          <a className={styles.primaryLink} href={isolated.browserOrigin}>فتح عنوان الدخول المعتمد</a>
        </>
      ) : (
        <>
          <p role="status">تسجيل دخول المشغّلين غير متاح على هذه النسخة.</p>
          <p>الواجهة تعمل، لكن اتصال الدخول الآمن لم يُفعّل هنا. لا يعني ذلك فقدان الأقسام أو بياناتها.</p>
          <section aria-label="متطلبات تفعيل الدخول">
            <h2>ما الذي ينقص تسجيل الدخول؟</h2>
            <ol>
              <li>التحقق من حساب المشغّل الأصلي واعتمادات الاستعادة لدى Identity.</li>
              <li>تسجيل مفتاح مرور موثّق لصاحب الحساب، دون إنشاء مشغّل بديل.</li>
              <li>تفعيل بيئة دخول معتمدة، ثم التحقق من الجلسة وصلاحيات كل قسم.</li>
            </ol>
            <p>يمكن معاينة أسماء الأقسام دون تسجيل دخول، لكن البيانات والإجراءات لا تظهر قبل تحقق الصلاحيات.</p>
          </section>
        </>
      )}
      <section className={styles.overview} aria-labelledby="operator-sections-title">
        <h2 id="operator-sections-title">أقسام لوحة التحكم</h2>
        <p>تظهر روابط الأقسام بعد التحقق من صلاحيات حسابك. بعض الأقسام بانتظار ربط خدماتها.</p>
        <ul>
          {workspaceRegistry.filter(entry => entry.permission !== null).map(entry => (
            <li key={entry.href}>{entry.label}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
