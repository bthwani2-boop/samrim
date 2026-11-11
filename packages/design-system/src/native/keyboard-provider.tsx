import type { PropsWithChildren } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";

/** Native keyboard lifecycle belongs to the shared UI composition layer. */
export function AppKeyboardProvider({ children }: PropsWithChildren) {
  return <KeyboardProvider>{children}</KeyboardProvider>;
}
