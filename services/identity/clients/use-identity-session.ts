import { useCallback, useSyncExternalStore } from "react";
import type { ActivationActorType, TokenResponse } from "./identity-client.ts";
import {
  subscribeIdentityState,
  getIdentityState,
  loginIdentity,
  requestOtpIdentity,
  activateIdentity,
  retryIdentityBootstrap,
  listIdentitySessions,
  revokeIdentitySession,
  logoutIdentity,
  changePasswordIdentity,
  deleteAccountIdentity,
  adoptIdentityTokenPair,
} from "./identity-session-store.ts";

export type IdentityActivationAction = {
  (phone: string, code: string): Promise<void>;
  (actorType: ActivationActorType, phone: string, code: string): Promise<void>;
};

let configuredActivationActorType: ActivationActorType | null = null;

// React must receive the same server snapshot during SSR and the hydration
// pass. The live store is process-global and may already have advanced on the
// server while a fresh browser store is still bootstrapping. A stable restoring
// snapshot prevents session/readiness timing from changing the rendered tree.
const identityHydrationState = { kind: "restoring" } as const;
const getIdentityHydrationState = () => identityHydrationState;

export function configureIdentityActivationActorType(actorType: ActivationActorType): void {
  configuredActivationActorType = actorType;
}

export function useIdentitySession() {
  const state = useSyncExternalStore(
    subscribeIdentityState,
    getIdentityState,
    getIdentityHydrationState,
  );

  const login = useCallback(
    (username: string, password: string) => loginIdentity(username, password),
    [],
  );
  const requestOtp = useCallback(
    (actorType: ActivationActorType, phone: string) => requestOtpIdentity(actorType, phone),
    [],
  );
  const activate = useCallback<IdentityActivationAction>(
    (...args: [string, string] | [ActivationActorType, string, string]) => {
      if (args.length === 2) {
        if (configuredActivationActorType === null) {
          return Promise.reject(new Error("IDENTITY_ACTOR_TYPE_NOT_CONFIGURED"));
        }
        return activateIdentity(configuredActivationActorType, args[0], args[1]);
      }
      return activateIdentity(args[0], args[1], args[2]);
    },
    [],
  );
  const retryBootstrap = useCallback(() => retryIdentityBootstrap(), []);
  const adoptSession = useCallback(
    (pair: TokenResponse) => adoptIdentityTokenPair(pair),
    [],
  );
  const listSessions = useCallback(() => listIdentitySessions(), []);
  const revokeSession = useCallback(
    (sessionId: string) => revokeIdentitySession(sessionId),
    [],
  );
  const logout = useCallback(() => logoutIdentity(), []);
  const changePassword = useCallback(
    (password: string) => changePasswordIdentity(password),
    [],
  );
  const deleteAccount = useCallback(() => deleteAccountIdentity(), []);

  return {
    state,
    login,
    requestOtp,
    activate,
    retryBootstrap,
    adoptSession,
    listSessions,
    revokeSession,
    logout,
    changePassword,
    deleteAccount,
  };
}
