"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Drawer, Form, Input, Modal, Select, Space, Table, Typography } from "antd";

// Stage-4 component fixture: synthetic labels only, never an Operator query or API.
const rows = [
  { key: "a", title: "عنصر اختبار أ", state: "جاهز" },
  { key: "b", title: "عنصر اختبار ب", state: "قيد الاختبار" },
  { key: "c", title: "عنصر اختبار ج", state: "جاهز" },
];
export default function OperatorComponentLab() {
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  return (
    <main style={{ maxWidth: 960, margin: "36px auto" }}>
      <Space orientation="vertical" size="large" style={{ width: "100%" }}>
        <Typography.Title level={2}>مختبر مكونات Ant Design</Typography.Title>
        <Typography.Paragraph>اختبار هندسي للغة وRTL والثيم والوصول والجدول والنماذج. ليست بيانات فعلية.</Typography.Paragraph>
        <Typography.Paragraph>السَّلَامُ عَلَيْكُمْ — أرقام عربية ١٢٣٤٥ — Latin ABC 2026</Typography.Paragraph>
        <Form layout="vertical" onFinish={(values: { title: string; type: string }) => setSubmitted(values.title)}>
          <Form.Item label="عنوان اختباري" name="title" rules={[{ required: true, message: "أدخل عنوانًا" }]}>
            <Input aria-label="عنوان اختباري" placeholder="أدخل نصًا عربيًا" />
          </Form.Item>
          <Form.Item label="نوع الحالة" name="type" initialValue="first">
            <Select aria-label="اختيار نوع" options={[{ value: "first", label: "الأول" }, { value: "second", label: "الثاني" }]} />
          </Form.Item>
          <Button type="primary" htmlType="submit">اختبار التحقق</Button>
        </Form>
        {submitted && <Typography.Text role="status">تم التحقق من إدخال: {submitted}</Typography.Text>}
        <Table
          aria-label="جدول تجريبي"
          rowKey="key"
          dataSource={rows}
          columns={[{ title: "العنصر", dataIndex: "title", key: "title" }, { title: "الحالة", dataIndex: "state", key: "state" }]}
          pagination={{ pageSize: 2 }}
        />
        <Space wrap>
          <Button onClick={() => setModal(true)}>فتح حوار</Button>
          <Button onClick={() => setDrawer(true)}>فتح لوحة جانبية</Button>
        </Space>
        <Modal title="حوار تجريبي" open={modal} onCancel={() => setModal(false)}
          onOk={() => setModal(false)} okText="موافق" cancelText="إلغاء">
          <Typography.Paragraph>اختبار ظهور الحوار والتركيز والاتجاه.</Typography.Paragraph>
        </Modal>
        <Drawer title="لوحة تجريبية" open={drawer} onClose={() => setDrawer(false)}>
          <Typography.Paragraph>محتوى اختباري لا يعرض بيانات تشغيلية.</Typography.Paragraph>
        </Drawer>
        <Link href="/">العودة إلى الرئيسية</Link>
      </Space>
    </main>
  );
}
