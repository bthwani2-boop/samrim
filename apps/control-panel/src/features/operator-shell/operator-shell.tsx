import { Layout } from "antd";
import type { ReactNode } from "react";
import WorkspaceHeader from "./workspace-header";
import WorkspaceNavigation from "./workspace-navigation";
import WorkspaceSearch from "./workspace-search";

// Only mount after server-verified Identity authorization. Not an auth boundary.
export default function OperatorShell({ children }: Readonly<{ children: ReactNode }>) {
  return <Layout style={{ minHeight: "100vh" }}>
    <Layout.Sider width={256} theme="light" breakpoint="lg" collapsedWidth={0}>
      <WorkspaceHeader /><WorkspaceSearch /><WorkspaceNavigation />
    </Layout.Sider>
    <Layout.Content style={{ padding: 24 }}>{children}</Layout.Content>
  </Layout>;
}
