export function verifySameOrigin(request: Request): boolean {
  const method = request.method?.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }

  const origin = request.headers.get("origin")?.trim();
  const host = request.headers.get("host")?.trim();
  const secFetchSite = request.headers.get("sec-fetch-site")?.toLowerCase().trim();

  // If Sec-Fetch-Site is present, it MUST be same-origin (reject cross-site, same-site, none)
  if (secFetchSite && secFetchSite !== "same-origin") {
    return false;
  }

  if (origin) {
    if (!host) return false;
    try {
      const originUrl = new URL(origin);
      return originUrl.host === host;
    } catch {
      return false;
    }
  }

  // If origin header is not provided, Sec-Fetch-Site must prove same-origin
  return secFetchSite === "same-origin";
}
