"use client";

import { Alert, Typography } from "antd";

export default function WorkspaceUnavailable({ title, description, owner }: Readonly<{
  title: string;
  description: string;
  owner: "Identity" | "DSH" | "WLT" | "متعددة";
}>) {
  return (
    <main aria-labelledby="workspace-title" style={{ maxWidth: 960, marginInline: "auto", paddingBlock: 28 }}>
      <Typography.Title id="workspace-title" level={2}>{title}</Typography.Title>
      <Typography.Paragraph>{description}</Typography.Paragraph>
      <Alert showIcon type="warning" message="البيانات والإجراءات غير مفعّلة"
        description={`يتطلب هذا القسم جلسة مشغّل متحققة وتكاملًا مباشرًا مع المالك القانوني (${owner}). لا تُعرض بيانات تجريبية ولا تُنفّذ عمليات دون اعتماد.`} />
    </main>
  );
}
