import Link from "next/link";

export default function NotFound() {
  return (
    <main aria-labelledby="not-found-title" style={{ maxWidth: 720, margin: "40px auto" }}>
      <h1 id="not-found-title">الصفحة غير موجودة</h1>
      <p>الرابط المطلوب غير متاح. يمكنك العودة إلى لوحة المشغّل.</p>
      <Link href="/">العودة إلى لوحة المشغّل</Link>
    </main>
  );
}
