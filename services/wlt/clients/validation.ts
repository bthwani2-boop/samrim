export const actorValid = (id: unknown): id is string =>
  typeof id === "string" && id.length > 0 && Array.from(id).length <= 128 &&
  id.trim() === id && !/\p{Cc}/u.test(id);
export const amountValid = (value: unknown, positive: boolean): value is string =>
  typeof value === "string" &&
  (positive ? /^[1-9][0-9]{0,37}$/ : /^(0|[1-9][0-9]{0,37})$/).test(value);
export const fundingIdValid = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(value);
