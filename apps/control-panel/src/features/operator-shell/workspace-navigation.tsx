"use client";
import { Menu } from "antd";
import Link from "next/link";
import { workspaceRegistry } from "../navigation/workspace-registry";
import { canShowNavigation } from "../session/operator-permissions";
import { useOperatorSessionView } from "../session/session-provider";

export default function WorkspaceNavigation() {
  const session = useOperatorSessionView();
  const items = workspaceRegistry
    .filter((item) => canShowNavigation(session.status === "verified", session.grants, item.permission))
    .map((item) => ({ key: item.href, label: <Link href={item.href}>{item.label}</Link> }));
  return <nav aria-label="أقسام لوحة التحكم"><Menu mode="inline" items={items} /></nav>;
}
