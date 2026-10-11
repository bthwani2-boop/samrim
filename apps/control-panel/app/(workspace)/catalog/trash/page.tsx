import { CatalogTrash } from "../../../../src/features/central-catalog/catalog-trash";
import { CatalogWorkspace } from "../../../../src/features/central-catalog/catalog-workspace";

export default function CatalogTrashPage() {
  return <CatalogWorkspace resource="trash"><CatalogTrash /></CatalogWorkspace>;
}
export const metadata = { title: "سلة المحذوفات | الكتالوج" };
