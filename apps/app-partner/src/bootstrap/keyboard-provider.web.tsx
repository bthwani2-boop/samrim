import type { PropsWithChildren } from "react";

// Expo Web does not initialize the native keyboard controller.
export function AppKeyboardProvider({ children }: PropsWithChildren) {
  return <>{children}</>;
}
