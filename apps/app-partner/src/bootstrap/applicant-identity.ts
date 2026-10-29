import { createMobileIdentityRuntime, type IdentitySessionState } from "@bthwani/identity";
import * as Crypto from "expo-crypto";
import * as SecureStore from "./compatible-storage";

// An applicant uses an existing Identity client-role proof before admission.
// It has a separate local session namespace and cannot operate Partner surfaces.
const runtime=createMobileIdentityRuntime({
 role:"client",surface:"app-client",namespace:"bthwani.partner.prospect",
 allowDevelopmentSessionFallback:false,
 secureStorage:{
  getItem:(key)=>SecureStore.getItemAsync(key),
  setItem:(key,value)=>SecureStore.setItemAsync(key,value),
  removeItem:(key)=>SecureStore.deleteItemAsync(key),
 },
 cryptoRandomUUID:()=>Crypto.randomUUID(),
 explicitApiUrl:process.env.EXPO_PUBLIC_IDENTITY_API_URL,
});
export const restoreProspectSession=runtime.restoreIdentitySession;
export const currentProspectSession=runtime.currentIdentityState;
export const subscribeProspectSession=runtime.subscribeIdentityState;
export const prospectAccessToken=runtime.getUsableAccessToken;
export function requestProspectRegistration(phone:string){return runtime.identityClient().requestClientRegistration({phone})}
export async function registerProspect(phone:string,code:string,password:string):Promise<IdentitySessionState>{
 const pair=await runtime.identityClient().registerClient({phone,code,password,clientInstanceId:await runtime.clientInstanceId()});
 return runtime.identitySession().adopt(pair);
}
export async function loginProspect(phone:string,password:string):Promise<IdentitySessionState>{
 const pair=await runtime.identityClient().loginClient({phone,password,clientInstanceId:await runtime.clientInstanceId()});
 return runtime.identitySession().adopt(pair);
}
export const logoutProspect=runtime.logoutIdentity;
