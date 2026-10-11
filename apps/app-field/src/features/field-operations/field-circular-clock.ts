// Pure dial math: a complete hand rotation advances twelve hours.
// Keep the persisted schedule value in the existing 24-hour HH:mm format.
const DAY_MINUTES = 24 * 60;
const HALF_DAY_MINUTES = 12 * 60;
const FULL_TURN = 2 * Math.PI;

export function wrapDayMinutes(value: number): number {
  return ((value % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

export function parseClockTime(value: string): number {
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) return 9 * 60;
  const [hours = 9, minutes = 0] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatClockTime(value: number): string {
  const wrapped = Math.round(wrapDayMinutes(value)) % DAY_MINUTES;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

// Show a 12-hour clock in the UI; leave DSH's canonical HH:mm unchanged.
export function formatClockDisplay(value: string): string {
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) return value;
  const minuteOfDay = parseClockTime(value);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "صباحًا" : "مساءً"}`;
}

export function clockHandAtRadius(radius: number): "hour" | "minute" {
  "worklet";
  // The inner ring selects the short hand; the outer ring selects minutes.
  return radius <= 75 ? "hour" : "minute";
}

export function finishClockHour(value: number, originalMinute: number): number {
  return wrapDayMinutes(Math.round((value - originalMinute) / 60) * 60 + originalMinute);
}

export function rotateClockMinutes(value: number, fromAngle: number, toAngle: number, hand: "hour" | "minute" = "hour"): number {
  // Signed shortest arc avoids jumps on crossing 12 at the top of the dial.
  const delta = Math.atan2(Math.sin(toAngle - fromAngle), Math.cos(toAngle - fromAngle));
  return wrapDayMinutes(value + (delta * (hand === "hour" ? HALF_DAY_MINUTES : 60)) / FULL_TURN);
}

export function clockHandDegrees(value: number): number {
  return (wrapDayMinutes(value) % HALF_DAY_MINUTES) / HALF_DAY_MINUTES * 360;
}

export function clockDarkness(value: number): number {
  const minute = wrapDayMinutes(value);
  if (minute < 360) return 1;
  if (minute < 420) return (420 - minute) / 60;
  if (minute < 1080) return 0;
  if (minute < 1260) return (minute - 1080) / 180;
  return 1;
}
