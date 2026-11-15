import Link from "next/link";
export default function HealthPage() {
  return <main style={{ maxWidth: 720, margin: "40px auto" }}>
    <h1>الملاحة في لوحة التحكم تعمل</h1>
    <p>فحص بنية العرض فقط؛ لا توجد معلومات تجارية أو جلسات مستخدمين.</p>
    <Link href="/">العودة للرئيسية</Link>
  </main>;
}
