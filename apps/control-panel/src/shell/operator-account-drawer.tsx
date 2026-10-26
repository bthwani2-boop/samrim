"use client";

import type { ActorIdentity } from "@bthwani/identity";
import { Alert, Avatar, Button, Descriptions, Drawer, Flex, Tag, Typography } from "antd";
import Link from "next/link";
import { useEffect, useState } from "react";
import { identityFetch } from "../session/identity-fetch";
import { operatorWorkspacePermissions } from "../session/operator-permissions";
import { AppearanceControl } from "./appearance-control";

type Props = Readonly<{
  identity: ActorIdentity | null;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onLogout: () => void;
}>;

function sessionExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "غير متاح"
    : new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** The shared Ant Design provider owns the drawer's RTL, colors, focus and overlay behavior. */
export function OperatorAccountDrawer({ identity, open, busy, onClose, onLogout }: Props) {
  // An account switch must never display the previous operator's phone number.
  const [profile, setProfile] = useState<{ subject: string; phone: string } | null>(null);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState(false);
  const subject = identity?.subject;
  const phone = profile && profile.subject === subject ? profile.phone : null;

  useEffect(() => {
    if (!open || !subject || phone) return;
    const controller = new AbortController();
    setPhoneLoading(true);
    setPhoneError(false);
    void identityFetch("/api/auth/profile", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("operator profile unavailable");
      const body: unknown = await response.json();
      const number = body && typeof body === "object" && "phoneE164" in body
        ? body.phoneE164 : null;
      if (typeof number !== "string" || !number.trim()) throw new Error("operator phone unavailable");
      if (!controller.signal.aborted) setProfile({ subject, phone: number.trim() });
    }).catch(() => {
      if (!controller.signal.aborted) setPhoneError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setPhoneLoading(false);
    });
    return () => controller.abort();
  }, [open, phone, subject]);

  const permissions = operatorWorkspacePermissions.filter(
    (entry) => identity?.permissions?.includes(entry.key) === true,
  );

  return (
    <Drawer
      id="operator-account-drawer"
      title="الملف الشخصي"
      placement="left"
      size="min(432px, 100vw)"
      open={open}
      getContainer={() => document.getElementById("control-panel-overlay-root")!}
      onClose={onClose}
      destroyOnHidden
      extra={<Typography.Text type="secondary">حساب المشغّل وإعدادات الجلسة</Typography.Text>}
      footer={<Button danger block loading={busy} onClick={onLogout}>تسجيل الخروج</Button>}
    >
      <Flex vertical gap="large">
        <Flex align="center" gap="middle">
          <Avatar size={56}>ب</Avatar>
          <Flex vertical gap={4}>
            <Typography.Text strong>{identity?.role === "operator" ? "مشغّل المنصة" : "حساب معتمد"}</Typography.Text>
            <Typography.Text type="secondary">حساب بثواني</Typography.Text>
            <Tag color="success">جلسة نشطة</Tag>
          </Flex>
        </Flex>

        <section aria-label="معلومات الحساب">
          <Descriptions
            title="معلومات الحساب"
            bordered
            size="small"
            column={1}
            items={[
              {
                key: "phone",
                label: "رقم الهاتف",
                children: <span aria-live="polite" dir="ltr">
                  {phone ? phone : phoneLoading ? "جارٍ التحميل…" : phoneError ? "غير متاح حاليًا" : "لم يُحمّل بعد"}
                </span>,
              },
              {
                key: "expires",
                label: "انتهاء الجلسة",
                children: identity?.expiresAt
                  ? <time dateTime={identity.expiresAt}>{sessionExpiry(identity.expiresAt)}</time>
                  : "غير متاح",
              },
            ]}
          />
        </section>

        <section aria-label="صلاحيات الوصول">
          <Flex align="center" justify="space-between">
            <Typography.Title level={5}>صلاحيات الوصول</Typography.Title>
            <Tag>{permissions.length.toLocaleString("ar-YE")} أقسام</Tag>
          </Flex>
          <Flex gap="small" wrap>
            {permissions.map((entry) => <Tag key={entry.key}>{entry.label}</Tag>)}
          </Flex>
          {!permissions.length ? <Alert type="info" message="لا توجد صلاحيات تشغيلية مفعّلة." /> : null}
          {identity?.canManageOperatorPermissions ? (
            <Link href="/access" onClick={onClose}>إدارة وصول المشغّلين</Link>
          ) : null}
        </section>

        <section aria-label="إعدادات المظهر">
          <AppearanceControl />
        </section>
      </Flex>
    </Drawer>
  );
}
