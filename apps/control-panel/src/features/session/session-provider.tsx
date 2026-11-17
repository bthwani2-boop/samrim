"use client";
import { createContext, type ReactNode, useContext } from "react";
import type { OperatorPermission } from "./operator-permissions";

export type OperatorSessionView =
  | { status: "unavailable"; grants: readonly [] }
  | { status: "verified"; grants: readonly OperatorPermission[] };
const unavailable: OperatorSessionView = { status: "unavailable", grants: [] };
const Context = createContext<OperatorSessionView>(unavailable);

// A client projection, never a permission grant. It must be populated only after
// a real server-verified Identity session (not implemented in this checkout).
export function SessionProvider({ children, session = unavailable }: Readonly<{
  children: ReactNode;
  session?: OperatorSessionView;
}>) {
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function useOperatorSessionView(): OperatorSessionView { return useContext(Context); }
