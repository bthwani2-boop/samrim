/** A logical banner index never depends on the native RTL scroll offset. */
export function wrapBannerIndex(current: number, direction: 1 | -1, count: number): number {
  if (count <= 0) return 0;
  return ((current + direction) % count + count) % count;
}
