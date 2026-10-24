type ProductAction = "create" | "prices" | "list";
type Listener = (action: ProductAction) => void;
const listeners = new Set<Listener>();
export function onPartnerProductAction(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function dispatchPartnerProductAction(action: ProductAction): void {
  for (const listener of listeners) listener(action);
}
