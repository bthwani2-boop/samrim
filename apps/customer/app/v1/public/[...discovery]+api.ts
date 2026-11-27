import { servePublicDiscovery } from "@bthwani/dsh";

// Customer Web and its isolated DSH owner share the development host.
export function GET(request: Request) {
  return servePublicDiscovery(request, "customer", "http://127.0.0.1:3202", process.env.NODE_ENV === "development");
}
