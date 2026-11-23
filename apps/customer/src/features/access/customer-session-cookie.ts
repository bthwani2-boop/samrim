export const customerCookieName = process.env.BTHWANI_SURFACE_PREVIEW === "1"
  ? "bthwani_surface_customer_auth" : "bthwani_customer_auth";

export function bearerForCustomerRequest(request: Request): string | null {
  return request.headers.get("Cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(customerCookieName + "="))?.slice(customerCookieName.length + 1) ?? null;
}
