export function reconcileStoreProductSave<T extends { id: string }>(
  requestProductID: string,
  updatedProduct: T,
  currentSelectedProductID: string | null,
  updateCatalog: (product: T) => void,
  updateSelection: (product: T) => void,
): boolean {
  updateCatalog(updatedProduct);
  if (currentSelectedProductID !== requestProductID) return false;
  updateSelection(updatedProduct);
  return true;
}