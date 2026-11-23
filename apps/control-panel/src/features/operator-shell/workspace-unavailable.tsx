"use client";

import { Alert, Typography } from "antd";
import styles from "./workspace-unavailable.module.css";

export default function WorkspaceUnavailable({ title, description, owner }: Readonly<{
  title: string;
  description: string;
  owner: "Identity" | "DSH" | "WLT" | "متعددة";
}>) {
  return (
    <main aria-labelledby="workspace-title" className={styles.workspace}>
      <section className={styles.card}>
        <span className={styles.kicker}>حالة القسم</span>
        <Typography.Title id="workspace-title" level={1}>{title}</Typography.Title>
        <Typography.Paragraph className={styles.description ?? ""}>{description}</Typography.Paragraph>
        <Alert showIcon type="warning" className={styles.warning ?? ""}
          message="البيانات والإجراءات غير مفعّلة"
          description={`يتطلب هذا القسم جلسة مشغّل متحققة وتكاملًا مباشرًا مع المالك القانوني (${owner}). لا تُعرض بيانات تجريبية ولا تُنفّذ عمليات دون اعتماد.`} />
        <div className={styles.footer}>
          <Typography.Paragraph>لا توجد إجراءات متاحة في هذا القسم حاليًا.</Typography.Paragraph>
          <a className={styles.returnLink} href="/workspace">العودة إلى مساحة العمل</a>
        </div>
      </section>
    </main>
  );
}
