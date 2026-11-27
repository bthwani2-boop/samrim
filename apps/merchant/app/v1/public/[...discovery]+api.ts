import { servePublicDiscovery } from "@bthwani/dsh";

// Merchant Web exposes public Store detail and Offers only, never private grants.
export function GET(request: Request) {
  return servePublicDiscovery(
    request, "merchant", process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN ?? "http://127.0.0.1:3202",
    process.env.NODE_ENV === "development",
  );
}
