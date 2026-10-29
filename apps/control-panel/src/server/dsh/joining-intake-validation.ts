import type { StoreWorkingHoursInterval } from "@bthwani/dsh";

const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

// Validate untrusted JSON shape before invoking DSH's canonical schedule rules.
export function isJoiningIntakeHoursShape(value: unknown): value is StoreWorkingHoursInterval[] {
  return Array.isArray(value) && value.length <= 28 && value.every((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const interval = item as Record<string, unknown>;
    return Number.isInteger(interval.dayOfWeek) &&
      Number(interval.dayOfWeek) >= 1 && Number(interval.dayOfWeek) <= 7 &&
      typeof interval.opensAt === "string" && localTimePattern.test(interval.opensAt) &&
      typeof interval.closesAt === "string" && localTimePattern.test(interval.closesAt) &&
      typeof interval.closesNextDay === "boolean";
  });
}

export function isValidOptionalJoiningWalletProvider(value: unknown): value is string | undefined {
  return value === undefined || (
    typeof value === "string" &&
    Array.from(value.trim()).length <= 64 &&
    !/\p{Cc}/u.test(value)
  );
}
