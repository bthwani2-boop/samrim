import { resolveIsolatedOperatorConfig } from "../../server/operator-passkey-bff";
import OperatorPasskeyForm from "./operator-passkey-form";

// No login is available outside explicitly isolated local test mode.
// Isolated sign-in alone never admits private workspace content: Identity
// still verifies current explicit scope at the server render boundary.
export default function OperatorEntryScreen() {
  const isolated = resolveIsolatedOperatorConfig(process.env);
  return (
    <main style={{ maxWidth: 760, margin: "5rem auto", padding: 24 }} dir="rtl">
      <h1>دخول لوحة تحكم بثواني</h1>
      {isolated ? (
        <OperatorPasskeyForm />
      ) : (
        <p role="alert">
          تسجيل دخول المشغّلين غير متاح حاليًا، حتى اعتماد التحقق الآمن من Identity.
        </p>
      )}
      <p>
        صلاحيات المشغّل وإدارة الحساب الأساسي محمية في Identity.
        لا تُعرض صفحات العمل أو بياناتها دون التحقق من الجلسة والصلاحيات الفعلية.
      </p>
    </main>
  );
}
