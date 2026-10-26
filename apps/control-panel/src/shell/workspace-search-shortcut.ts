type ShortcutEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "defaultPrevented" | "target">;

export function shouldOpenWorkspaceSearch(event: ShortcutEvent): boolean {
  if (event.defaultPrevented || event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
  const target = event.target as { isContentEditable?: boolean; closest?: (selector: string) => Element | null } | null;
  return !(target?.isContentEditable || target?.closest?.("input, textarea, select, [contenteditable]"));
}
