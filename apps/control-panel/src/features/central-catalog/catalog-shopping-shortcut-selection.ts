export type ShortcutCategoryOption = Readonly<{ id: string; nameAr: string; active: boolean; pathAr: string }>;

export function retainSelectedCategoryOptions(
  selectedOptions: ReadonlyArray<ShortcutCategoryOption>,
  visibleOptions: ReadonlyArray<ShortcutCategoryOption>,
  selectedIds: ReadonlyArray<string>,
): ReadonlyArray<ShortcutCategoryOption> {
  const optionsById = new Map([...selectedOptions, ...visibleOptions].map((option) => [option.id, option]));
  return selectedIds.flatMap((id) => {
    const option = optionsById.get(id);
    return option ? [option] : [];
  });
}
