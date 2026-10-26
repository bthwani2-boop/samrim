"use client";

import { Button, ConfigProvider, Flex, Popover, Typography } from "antd";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * One accessible column-control popover across registries. The backend retains
 * ownership of all-results filtering; page-only controls announce their scope.
 */
export function RegistryColumnHeader({
  label, children, active = false, scope = "results",
}: Readonly<{ label: string; children?: ReactNode; active?: boolean; scope?: "results" | "page" }>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupId = useId();

  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open]);

  if (!children) return <th scope="col">{label}</th>;

  return (
    <th scope="col" className="registry-column-head">
      <Popover
        open={open}
        onOpenChange={setOpen}
        placement="bottomRight"
        trigger="click"
        arrow={false}
        autoAdjustOverflow
        destroyOnHidden
        getPopupContainer={() => document.getElementById("control-panel-overlay-root") ?? document.body}
        content={(
          <ConfigProvider getPopupContainer={(trigger) => trigger?.closest(".registry-column-panel") ?? document.body}>
            <div id={popupId} className="registry-column-panel" aria-label={"تصفية " + label} dir="rtl"
              style={{ width: "min(270px, calc(100vw - 32px))", maxHeight: "65vh", overflowY: "auto", padding: 4 }}>
              <Flex vertical gap="small">
                <Flex align="center" justify="space-between" gap="small">
                  <Typography.Text strong>{label}</Typography.Text>
                  <Button size="small" type="text" onClick={() => {
                    setOpen(false);
                    window.requestAnimationFrame(() => triggerRef.current?.focus());
                  }}>إغلاق</Button>
                </Flex>
                <Typography.Text type="secondary">
                  {scope === "page" ? "الصفحة الحالية فقط" : "كل النتائج المطابقة"}
                </Typography.Text>
                <div className="registry-column-controls">{children}</div>
              </Flex>
            </div>
          </ConfigProvider>
        )}
      >
        <Button
          ref={triggerRef}
          type="text"
          title={"بحث أو تصفية أو ترتيب: " + label}
          aria-label={"تصفية " + label}
          aria-expanded={open}
          aria-controls={open ? popupId : undefined}
          data-active={active || undefined}
          style={{ minHeight: 36, display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          {label} <span aria-hidden="true">⌄</span>
          {active ? <span aria-hidden="true">•</span> : null}
        </Button>
      </Popover>
    </th>
  );
}
