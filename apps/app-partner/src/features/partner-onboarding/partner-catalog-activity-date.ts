// Catalog activity filters use Aden local calendar days, independent of the device timezone.
export function validCatalogActivityDay(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00+03:00");
  // JavaScript normalizes invalid calendar dates; compare the Aden calendar day.
  return !Number.isNaN(date.getTime())
    && new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10) === value;
}

export function catalogActivityDateBound(value: string, end: boolean): string {
  if (!value) return "";
  const date = new Date(value + "T00:00:00+03:00");
  // The DSH query treats "to" as an exclusive upper boundary.
  if (end) date.setTime(date.getTime() + 24 * 60 * 60 * 1000);
  return date.toISOString();
}
