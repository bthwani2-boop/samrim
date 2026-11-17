import {type CaptainFix,isAcceptableFix, type OwnerFixPolicy} from "./presence-publisher.ts";
/** Only the currently assigned Captain can publish a mission's single latest fix. */
export async function publishActiveMissionFix(f:CaptainFix,p:OwnerFixPolicy,
  scope:Readonly<{assignmentId:string|null;identityVerified:boolean;isAssignedCaptain:boolean;foregroundGranted:boolean}>,
  ownerPublish:(assignmentId:string,fix:CaptainFix)=>Promise<void>,now=Date.now()):Promise<boolean> {
  if(!scope.assignmentId?.trim() || !scope.identityVerified || !scope.isAssignedCaptain ||
    !scope.foregroundGranted || !isAcceptableFix(f,p,now)) return false;
  await ownerPublish(scope.assignmentId,f);
  return true;
}
