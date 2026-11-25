export const customerCookieName = "bthwani_customer_auth";

export function bearerForCustomerRequest(request: Request): string | null {
  return request.headers.get("Cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(customerCookieName + "="))?.slice(customerCookieName.length + 1) ?? null;
}
