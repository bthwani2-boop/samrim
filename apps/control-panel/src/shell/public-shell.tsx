"use client";

import { Button, Result, Spin } from "antd";
import { type ReactNode } from "react";
function BrandHeader() {
  return (
    <header className="brand-header">
      <div className="brand-lockup">
        <span className="brand-rail" aria-hidden="true" />
        <span className="brand-name">بثواني</span>
      </div>
      <span className="surface-label">لوحة التحكم</span>
    </header>
  );
}

export function ControlShell({
  children,
  className = "",
  surface = "public",
  header = <BrandHeader />,
  footer = null,
}: Readonly<{ children: ReactNode; className?: string; surface?: "public" | "workspace" | "state"; header?: ReactNode; footer?: ReactNode }>) {
  return (
    <div className={"control-shell control-shell-" + surface + " " + className}>
      <div className="control-frame">
        {header}
        {children}
        {footer}
      </div>
    </div>
  );
}

export function LoadingState({ title = "جارٍ تجهيز لوحة التحكم", message = "نستعيد جلسة المشغل بأمان." }: Readonly<{ title?: string; message?: string }>) {
  return (
    <ControlShell className="state-shell">
      <main className="state-content" aria-live="polite" aria-busy="true">
        <Result icon={<Spin size="large" />} title={title} subTitle={message} />
      </main>
    </ControlShell>
  );
}

export function UnavailableState({ message, onRetry, busy }: Readonly<{ message: string; onRetry: () => void; busy: boolean }>) {
  return (
    <ControlShell className="state-shell">
      <main className="state-content" role="alert">
        <Result
          status="warning"
          title="تعذر الوصول إلى الهوية"
          subTitle={message}
          extra={<Button type="primary" loading={busy} onClick={onRetry}>إعادة المحاولة</Button>}
        />
      </main>
    </ControlShell>
  );
}
