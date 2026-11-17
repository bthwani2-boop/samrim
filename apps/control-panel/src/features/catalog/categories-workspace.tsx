import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function CategoriesWorkspace({ title = "الفئات" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="تصنيف المنتجات وعلاقتها بالسجل المركزي دون إنشاء تصنيفات موازية." owner="DSH" />;
}
