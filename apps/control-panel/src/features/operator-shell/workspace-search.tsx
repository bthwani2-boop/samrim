"use client";
import { Input, List } from "antd";
import Link from "next/link";
import { useState } from "react";
import { workspaceRegistry } from "../navigation/workspace-registry";
import { canShowNavigation } from "../session/operator-permissions";
import { useOperatorSessionView } from "../session/session-provider";

export default function WorkspaceSearch() {
  const [query, setQuery] = useState("");
  const session = useOperatorSessionView();
  const items = workspaceRegistry.filter((item) =>
    canShowNavigation(session.status === "verified", session.grants, item.permission)
    && item.label.includes(query.trim()));
  return <section aria-label="البحث في صفحات لوحة التحكم">
    <Input aria-label="البحث في الصفحات" placeholder="البحث في الصفحات"
      value={query} onChange={(event) => setQuery(event.target.value)} />
    {query.trim() && <List size="small" dataSource={items}
      locale={{ emptyText: "لا توجد صفحات متاحة مطابقة" }}
      renderItem={(item) => <List.Item><Link href={item.href}>{item.label}</Link></List.Item>} />}
  </section>;
}
