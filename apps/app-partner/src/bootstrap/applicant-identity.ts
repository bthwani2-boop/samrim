import { createMobileIdentityRuntime, type IdentitySessionState } from "@bthwani/identity";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import * as SecureStore from "./compatible-storage";

// An applicant uses an existing Identity client-role proof before admission.
// It has a separate local session namespace and cannot operate Partner surfaces.
// The web has no native SecureStore: keep only short-lived proof in memory;
// Identity owns the browser refresh secret in a separate HttpOnly cookie.
const applicantWebStorage=new Map<string,string>();
const runtime=createMobileIdentityRuntime({
 role:"client",surface:"app-client",namespace:"bthwani.partner.prospect",
 allowDevelopmentSessionFallback:false,
 // Expo Web applicants use a dedicated HttpOnly refresh cookie on the trusted Partner origin.
 // Native applicants retain the platform keychain and refresh-token pair.
 clientBrowserSession:Platform.OS==="web",
 secureStorage:{
  getItem:(key)=>Platform.OS==="web"?Promise.resolve(applicantWebStorage.get(key)??null):SecureStore.getItemAsync(key),
  setItem:(key,value)=>Platform.OS==="web"?Promise.resolve(void applicantWebStorage.set(key,value)):SecureStore.setItemAsync(key,value),
  removeItem:(key)=>Platform.OS==="web"?Promise.resolve(void applicantWebStorage.delete(key)):SecureStore.deleteItemAsync(key),
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
export function requestProspectRecovery(phone:string){return runtime.identityClient().requestClientRecovery({phone})}
export async function recoverProspect(phone:string,code:string,password:string):Promise<IdentitySessionState>{
 await runtime.identityClient().recoverClient({phone,code,password});
 return runtime.identitySession().clearLocalSession();
}
export async function registerDirectPartnerFromVerifiedAccount(){
 const token=await runtime.getUsableAccessToken();
 return runtime.identityClient().registerVerifiedSelfPartner(token,{clientInstanceId:await runtime.clientInstanceId()});
}
export const logoutProspect=runtime.logoutIdentity;
