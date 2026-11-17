import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function CatalogWorkspace({ title = "الكتالوج المركزي" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="استعراض المنتجات والأصناف والمنشورات عبر محرك الكتالوج القانوني الواحد." owner="DSH" />;
}
