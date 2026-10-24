export function publicStoreImageSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("STORE_IMAGE_DIMENSIONS_INVALID");
  }
  const longest = Math.max(width, height);
  if (longest <= 1600) return { width, height };
  const scale = 1600 / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
