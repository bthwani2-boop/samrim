import Link from "next/link";

// This is an honest entry gate, not a local or browser-side Operator login.
export default function OperatorEntryScreen() {
  return (
    <main style={{ maxWidth: 760, margin: "5rem auto", padding: 24 }}>
      <h1>لوحة تحكم بثواني</h1>
      <p role="alert">لم يتم تفعيل تسجيل دخول المشغّل في النسخة الجديدة.</p>
      <p>
        تتطلب مساحة المشغّل جلسة Operator معتمدة وصلاحيات محددة من Identity.
        ولا تسمح شاشة الدخول هذه بالاطلاع على طلبات أو متاجر أو بيانات مالية.
      </p>
      <Link href="/health">حالة التطبيق التقنية</Link>
    </main>
  );
}
