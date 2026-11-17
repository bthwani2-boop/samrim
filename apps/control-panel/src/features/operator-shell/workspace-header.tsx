import { Typography } from "antd";

export default function WorkspaceHeader() {
  return <header style={{ padding: 12 }}>
    <Typography.Title level={3} style={{ margin: 0 }}>لوحة تحكم بثواني</Typography.Title>
    <Typography.Text type="secondary">مساحة تشغيل مقيّدة بجلسة وصلاحيات Identity</Typography.Text>
  </header>;
}
