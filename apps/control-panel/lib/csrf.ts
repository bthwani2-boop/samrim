export function verifySameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")?.trim();
  const host = request.headers.get("host")?.trim();

  if (!origin) {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "same-site") return false;
    return true;
  }

  if (!host) return false;

  try {
    const originUrl = new URL(origin);
    return originUrl.host === host;
  } catch {
    return false;
  }
}
