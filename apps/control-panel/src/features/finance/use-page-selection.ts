import { useMemo, useState } from "react";

export function usePageSelection<T extends Readonly<{ id: string }>>(items: readonly T[]) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const visibleIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const selected = useMemo(() => items.filter((item) => selectedIds.has(item.id)), [items, selectedIds]);
  const allVisibleSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));
  const toggle = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllVisible = () => setSelectedIds((current) => {
    const next = new Set(current);
    if (items.length > 0 && items.every((item) => next.has(item.id))) for (const id of visibleIds) next.delete(id);
    else for (const id of visibleIds) next.add(id);
    return next;
  });
  const clear = () => setSelectedIds(new Set());
  return { selectedIds, selected, allVisibleSelected, toggle, toggleAllVisible, clear } as const;
}
