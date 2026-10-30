import { StoreAccessInvitationInbox as DshStoreAccessInvitationInbox } from "./store-access-invitation-inbox";
import * as Crypto from "expo-crypto";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

export function StoreAccessInvitationInbox() {
  return <DshStoreAccessInvitationInbox baseURL={process.env.EXPO_PUBLIC_DSH_API_URL?.trim() ?? ""} cryptoRandomUUID={Crypto.randomUUID} getAccessToken={getUsableIdentityAccessToken} hideWhenEmpty />;
}
