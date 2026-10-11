import type { StoreWorkingHoursInterval } from "./generated/dsh-types";

export type JoiningCaseImageContentType = "image/jpeg" | "image/png";

// React Native FormData uploads local images by URI, not by appending a fetched Blob.
// Browser uploads retain the Blob representation.
export function joiningCaseImageMultipartPart(uri: string, name: string, type: string, blob?: Blob): Blob {
  if (/^(?:file|content):\/\//i.test(uri)) return { uri, name, type } as unknown as Blob;
  return blob ?? ({ uri, name, type } as unknown as Blob);
}

export function resolveJoiningCaseImageContentType(
  assetType: string | null | undefined,
  blobType: string | null | undefined,
  fileName: string | null | undefined,
  uri: string,
): JoiningCaseImageContentType | null {
  for (const candidate of [assetType, blobType]) {
    const normalized = candidate?.split(";", 1)[0]?.trim().toLowerCase();
    if (normalized === "image/jpeg" || normalized === "image/png") return normalized;
  }

  const path = `${fileName ?? ""} ${uri}`.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  if (/\.png(?:\s|$)/.test(path)) return "image/png";
  if (/\.(?:jpe?g)(?:\s|$)/.test(path)) return "image/jpeg";
  return null;
}

// Field staff should not need to mark the next day manually when a Store closes
// after midnight. The backend still validates 24-hour length and overlaps.
export function normalizeOvernightWorkingHours(interval: StoreWorkingHoursInterval): StoreWorkingHoursInterval {
  const open = parseClock(interval.opensAt);
  const close = parseClock(interval.closesAt);
  return { ...interval, closesNextDay: interval.closesNextDay || (open !== null && close !== null && close < open) };
}

export function isValidStoreWorkingHours(intervals: readonly StoreWorkingHoursInterval[]): boolean {
  if (intervals.length === 0 || intervals.length > 28) return false;
  const weekMinutes = 7 * 24 * 60;
  const occupied: Array<{ start: number; end: number }> = [];
  for (const interval of intervals) {
    if (!Number.isInteger(interval.dayOfWeek) || interval.dayOfWeek < 1 || interval.dayOfWeek > 7) return false;
    const open = parseClock(interval.opensAt);
    const close = parseClock(interval.closesAt);
    if (open === null || close === null) return false;
    if (interval.closesNextDay ? close > open : close <= open) return false;
    const start = (interval.dayOfWeek - 1) * 1440 + open;
    const end = (interval.dayOfWeek - 1) * 1440 + close + (interval.closesNextDay ? 1440 : 0);
    const pieces = [{ start, end: Math.min(end, weekMinutes) }];
    if (end > weekMinutes) pieces.push({ start: 0, end: end - weekMinutes });
    for (const piece of pieces) {
      if (occupied.some((previous) => piece.start < previous.end && previous.start < piece.end)) return false;
      occupied.push(piece);
    }
  }
  return true;
}

function parseClock(value: string): number | null {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
