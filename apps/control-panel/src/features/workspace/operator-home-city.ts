/** Public DSH filters for the authenticated Operator workspace. */
export function parseOperatorHomeCity(
  params: Record<string, string | string[] | undefined>,
): string | null {
  if (Object.keys(params).some((key) => key !== "city")) return null;
  const city = params.city;
  if (city === undefined || city === "") return "";
  return typeof city === "string" && /^[a-z0-9-]{1,64}$/.test(city) ? city : null;
}
