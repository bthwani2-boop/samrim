"use client";

import type { ActorIdentity } from "@bthwani/identity";
import { Button, Empty, Input, Listy, Popover, Typography, type InputRef } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceRecordSearch } from "./workspace-record-search";

type SearchEntry = Readonly<{ href: string; label: string; context: string; searchText: string }>;

export function WorkspaceGlobalSearch({
  entries,
  identity,
  pathname,
  navigationOpen,
  accountOpen,
}: Readonly<{
  entries: readonly SearchEntry[];
  identity: ActorIdentity | null;
  pathname: string;
  navigationOpen: boolean;
  accountOpen: boolean;
}>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<InputRef>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("ar");
  const results = normalizedQuery
    ? entries.filter((entry) => entry.searchText.toLocaleLowerCase("ar").includes(normalizedQuery)).slice(0, 12)
    : [];

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  useEffect(() => {
    close();
  }, [pathname, navigationOpen, accountOpen, identity?.subject, close]);

  function navigate(href: string) {
    close();
    router.push(href);
  }

  const content = (
    <div className="workspace-global-search-content" id="workspace-search-panel" role="region" aria-label="نتائج البحث">
      <Input.Search
        ref={inputRef}
        id="workspace-search-input"
        allowClear
        autoComplete="off"
        placeholder="ابحث عن صفحة أو سجل"
        aria-label="البحث في صفحات لوحة التحكم"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onSearch={() => { const first = results[0]; if (first) navigate(first.href); }}
        enterButton="انتقال"
      />
      <div className="workspace-global-search-results" aria-live="polite">
        {normalizedQuery ? results.length ? (
          <>
            <Typography.Text type="secondary">الصفحات المطابقة</Typography.Text>
            <Listy<SearchEntry>
              items={results}
              rowKey="href"
              itemRender={(entry) => (
                <Link
                  href={entry.href}
                  aria-current={pathname === entry.href ? "page" : undefined}
                  onClick={() => close()}
                >
                  <span>{entry.label}</span>
                  <Typography.Text type="secondary">{entry.context}</Typography.Text>
                </Link>
              )}
            />
          </>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="لا توجد صفحات مطابقة." /> : (
          <Typography.Text type="secondary">اكتب اسم الصفحة أو المساحة للبحث.</Typography.Text>
        )}
        {open && normalizedQuery && identity ? (
          <WorkspaceRecordSearch key={identity.subject} query={query} identity={identity} onNavigate={() => close()} />
        ) : null}
      </div>
    </div>
  );

  return (
    <search className="workspace-search-control" aria-label="البحث في صفحات لوحة التحكم">
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setOpen(true);
          else close();
        }}
        trigger="click"
        placement="bottom"
        arrow={false}
        content={content}
        getPopupContainer={() => document.getElementById("control-panel-overlay-root") ?? document.body}
      >
        <Button
          ref={triggerRef}
          type="text"
          size="large"
          aria-label="البحث في صفحات لوحة التحكم"
          aria-expanded={open}
          aria-controls="workspace-search-panel"
          icon={<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><circle cx="10.8" cy="10.8" r="6.4" /><path d="m15.5 15.5 5 5" /></svg>}
        />
      </Popover>
    </search>
  );
}
