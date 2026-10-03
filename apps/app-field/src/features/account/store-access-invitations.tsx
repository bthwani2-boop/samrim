import { StoreAccessInvitationInbox as DshStoreAccessInvitationInbox } from "@bthwani/dsh/mobile/store-access-invitations";
import * as Crypto from "expo-crypto";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

export function StoreAccessInvitationInbox() {
  return <DshStoreAccessInvitationInbox baseURL={process.env.EXPO_PUBLIC_DSH_API_URL?.trim() ?? ""} cryptoRandomUUID={Crypto.randomUUID} getAccessToken={getUsableIdentityAccessToken} />;
}
