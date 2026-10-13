export function mergeOrderPageRecords<T>(
  current: Readonly<Record<string, T>>,
  page: Readonly<Record<string, T>>,
  append: boolean,
): Readonly<Record<string, T>> {
  return append ? { ...current, ...page } : page;
}
