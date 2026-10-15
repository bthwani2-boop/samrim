import { CatalogCenterWorkspace } from "../../../src/features/central-catalog/catalog-center-workspace";
import { CatalogWorkspace } from "../../../src/features/central-catalog/catalog-workspace";

export default function CentralCatalogPage() {
  return <CatalogWorkspace resource="products" title="الكتالوج"><CatalogCenterWorkspace /></CatalogWorkspace>;
}

export const metadata = { title: "الكتالوج" };
