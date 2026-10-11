import { CatalogWorkspace } from "../../../../src/features/central-catalog/catalog-workspace";
import { TrashContents } from "../../../../src/features/central-catalog/trash-contents";

export default function CatalogTrashPage() {
  return <CatalogWorkspace resource="trash"><TrashContents /></CatalogWorkspace>;
}
export const metadata = { title: "سلة المحذوفات | لوحة التحكم" };
