import type { MiddlewareFunction } from "expo-router/server";

// Merchant Identity/DSH admission is not implemented yet. The existing native
// Stack.Protected guard denies these routes; an HTTP deep link also needs to
// redirect before SDK 58 attempts its server render (which can be blank).
// Keep this matcher aligned with the private routes in app/_layout.tsx.
export const unstable_settings = {
  matcher: {
    patterns: [/^\/(?:orders|products|wallet|more|onboarding|promotions|store|account|activity|employees|insights|notifications)(?:\/|$)/],
  },
};

const middleware: MiddlewareFunction = request => {
  // A protected URI is not an authorization mechanism. Never redirect a
  // non-navigation request in a way that could forward an unsafe method.
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 403 });
  }
  return Response.redirect(new URL("/", request.url), 302);
};

export default middleware;
