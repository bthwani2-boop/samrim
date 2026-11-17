import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function ProductsWorkspace({ title = "المنتجات" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="استعراض المنتجات ومراجعة تعديلات السعر والمخزون من العقد المعتمد." owner="DSH" />;
}
