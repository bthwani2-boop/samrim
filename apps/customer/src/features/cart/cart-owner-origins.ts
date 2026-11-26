/**
 * Customer Cart is presentation-only. Neither this helper nor the Web BFF
 * can admit a caller: Identity and DSH verify every request.
 */
export function customerCartOwnerOrigins(url: URL): { dsh: string; identity: string } | null {
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) return null;
  const dsh = process.env.CUSTOMER_SYNTHETIC_DSH_ORIGIN;
  const identity = process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN;
  const dockerRequested = process.env.BTHWANI_DOCKER_CART_WEB_PREVIEW === "1";
  // Docker uses exactly the independently verified, isolated Lenovo owners,
  // not a caller-selected local port or a Native-public origin.
  const dockerPreview = dockerRequested &&
    process.env.BTHWANI_ISOLATED_TEST_MODE === "true" &&
    dsh === "http://127.0.0.1:3202" &&
    identity === "http://127.0.0.1:3201";
  return dockerPreview && dsh && identity ? { dsh, identity } : null;
}
