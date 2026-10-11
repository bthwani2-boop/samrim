// Pure dial math: a complete hand rotation advances twelve hours.
// Keep the persisted schedule value in the existing 24-hour HH:mm format.
const DAY_MINUTES = 24 * 60;

function wrapDayMinutes(value: number): number {
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

