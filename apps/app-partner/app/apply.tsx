import { useSyncExternalStore } from "react";
import { currentProspectSession, subscribeProspectSession } from "../src/bootstrap/applicant-identity";
import { ProspectivePartnerApplication } from "../src/features/partner-onboarding/prospective-partner-application";

function currentApplicantActor():string {
 const session=currentProspectSession();
 return session.kind==="authenticated"?session.identity.subject:"";
}

export default function PartnerApplicationRoute(){
 const actorID=useSyncExternalStore(subscribeProspectSession,currentApplicantActor,()=> "");
 // Changing applicants invalidates all pending form, readback and UI state.
 return <ProspectivePartnerApplication key={actorID || "signed-out"}/>;
}
