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

export function rotateClockMinutes(value: number, fromAngle: number, toAngle: number): number {
  // Signed shortest arc avoids jumps on crossing 12 at the top of the dial.
  const delta = Math.atan2(Math.sin(toAngle - fromAngle), Math.cos(toAngle - fromAngle));
  return wrapDayMinutes(value + (delta * HALF_DAY_MINUTES) / FULL_TURN);
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
