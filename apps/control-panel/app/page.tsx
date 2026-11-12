"use client";
import Link from "next/link";
import { Alert, Button, Input, Space, Typography } from "antd";

export default function FoundationPage() {
  return <main style={{ maxWidth: 800, margin: "40px auto", direction: "rtl" }}>
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Title level={2}>بثواني — لوحة المشغّل</Typography.Title>
      <Typography.Paragraph>واجهة اختبار هندسية فقط. لا توجد جلسة مشغّل أو صلاحيات مالية أو متاجر حقيقية.</Typography.Paragraph>
      <Input aria-label="اختبار إدخال عربي" placeholder="أدخل نصًا عربيًا" />
      <Button type="primary" aria-label="زر اختبار">اختبار Ant Design</Button>
      <Alert showIcon type="success" title="نجاح إعداد الثيم والمكوّنات" />
      <Alert showIcon type="error" title="الخدمات التجارية غير مفعّلة بعد" />
      <Link href="/health">اختبار التنقل إلى صفحة التحقق</Link>
    </Space>
  </main>;
}
