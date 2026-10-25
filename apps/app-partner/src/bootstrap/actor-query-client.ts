import { QueryClient } from "@tanstack/react-query";

// Private in-memory server-state cache. Each signed-in partner actor receives a
// new instance, and logout/actor switch destroys the previous instance.
export function createPartnerActorQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
