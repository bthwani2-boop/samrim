"use client";

import type { ActorIdentity } from "@bthwani/identity";
import { Button, Empty, Input, Listy, Modal, Typography, type InputRef } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceRecordSearch } from "./workspace-record-search";
import { shouldOpenWorkspaceSearch } from "./workspace-search-shortcut";

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
  const previousContext = useRef({ pathname, navigationOpen, accountOpen, subject: identity?.subject });
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
    const previous = previousContext.current;
    const contextChanged = previous.pathname !== pathname
      || previous.navigationOpen !== navigationOpen
      || previous.accountOpen !== accountOpen
      || previous.subject !== identity?.subject;
    previousContext.current = { pathname, navigationOpen, accountOpen, subject: identity?.subject };
    if (contextChanged) {
      setOpen(false);
      setQuery("");
    }
  }, [pathname, navigationOpen, accountOpen, identity?.subject]);

  useEffect(() => {
    const onSearchShortcut = (event: KeyboardEvent) => {
      if (!shouldOpenWorkspaceSearch(event)) return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onSearchShortcut);
    return () => document.removeEventListener("keydown", onSearchShortcut);
  }, []);

  function navigate(href: string) {
    close();
    router.push(href);
  }

  const content = (
    <section className="workspace-global-search-content" id="workspace-search-panel" aria-label="نتائج البحث">
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
    </section>
  );

  return (
    <search className="workspace-search-control" aria-label="البحث في صفحات لوحة التحكم">
      <Button
        ref={triggerRef}
        type="text"
        size="large"
        aria-label="البحث في صفحات لوحة التحكم"
        aria-expanded={open}
        aria-controls="workspace-search-panel"
        aria-keyshortcuts="Control+K Meta+K"
        title="البحث (Ctrl+K)"
        onClick={() => setOpen(true)}
        icon={<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><circle cx="10.8" cy="10.8" r="6.4" /><path d="m15.5 15.5 5 5" /></svg>}
      />
      <Modal
        open={open}
        title="البحث في لوحة التحكم"
        footer={null}
        width={560}
        destroyOnHidden
        onCancel={() => close(true)}
        getContainer={() => document.getElementById("control-panel-overlay-root") ?? document.body}
        afterOpenChange={(visible) => { if (visible) inputRef.current?.focus(); }}
      >
        {content}
      </Modal>
    </search>
  );
}
