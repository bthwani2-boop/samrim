export function verifySameOrigin(request: Request): boolean {
  const method = request.method?.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }

  const origin = request.headers.get("origin")?.trim();
  const host = request.headers.get("host")?.trim();
  const secFetchSite = request.headers.get("sec-fetch-site")?.toLowerCase().trim();
  const configuredOrigin = process.env.CONTROL_PANEL_PUBLIC_ORIGIN?.trim();
  const localDevelopment = process.env.BTHWANI_ENV === "development";

  let expectedOrigin: URL | null = null;
  if (configuredOrigin) {
    try {
      expectedOrigin = new URL(configuredOrigin);
      if (expectedOrigin.pathname !== "/" || expectedOrigin.search || expectedOrigin.hash) return false;
      const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
      if (process.env.NODE_ENV === "production" && expectedOrigin.protocol !== "https:" && !(localDevelopment && loopback.has(expectedOrigin.hostname))) return false;
    } catch {
      return false;
    }
  } else if (process.env.NODE_ENV === "production") {
    return false;
  } else {
    try {
      expectedOrigin = new URL(request.url);
    } catch {
      return false;
    }
  }

  // If Sec-Fetch-Site is present, it MUST be same-origin (reject cross-site, same-site, none)
  if (secFetchSite && secFetchSite !== "same-origin") {
    return false;
  }

  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (!expectedOrigin || originUrl.origin !== expectedOrigin.origin) return false;
      return !configuredOrigin || host === expectedOrigin.host;
    } catch {
      return false;
    }
  }

  // If origin header is not provided, Fetch Metadata or a same-origin Referer
  // must prove browser provenance. Direct requests without either are rejected.
  if (secFetchSite === "same-origin") {
    return !configuredOrigin || host === expectedOrigin?.host;
  }

  const referer = request.headers.get("referer")?.trim();
  if (!referer) return false;
  try {
    const refererUrl = new URL(referer);
    if (!expectedOrigin || refererUrl.origin !== expectedOrigin.origin) return false;
    return !configuredOrigin || host === expectedOrigin.host;
  } catch {
    return false;
  }
}
