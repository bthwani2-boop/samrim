/** Render exact, owner-validated YER integers on Web and Hermes without Number coercion. */
export function formatExactYer(amount: string | bigint): string {
  if (typeof amount === "string") {
    if (!/^(?:0|[1-9][0-9]{0,28})$/.test(amount)) throw new RangeError("INVALID_YER_AMOUNT");
  } else if (typeof amount !== "bigint") {
    throw new RangeError("INVALID_YER_AMOUNT");
  }
  return BigInt(amount).toLocaleString("ar-YE");
}
