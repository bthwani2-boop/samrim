"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CommandFrame, CommandSectionTabs } from "../shared/command-surface";
import { PartnersWorkbench } from "./partners-workbench";
import { PartnersCommandOverview } from "./partners-command-overview";
import "./partners-command-center.css";

type PartnerSection="command"|"directory"|"joining"|"access";
const tabs:ReadonlyArray<{id:PartnerSection;label:string}>=[
  {id:"command",label:"القيادة"},{id:"directory",label:"الشركاء والمتاجر"},
  {id:"joining",label:"طلبات الانضمام"},{id:"access",label:"تفويضات الوصول"},
];
export function PartnersCommandCenter() {
  const router=useRouter();
  const params=useSearchParams();
  const explicit=params.get("tab");
  const initialLegacy=Boolean(params.get("kind")||params.get("view")||params.get("inspect")||params.get("case")||params.get("grant")||params.get("actor")||params.get("q")||params.get("status")||params.get("state"));
  const active:PartnerSection=explicit==="directory"||explicit==="joining"||explicit==="access"?explicit:
    explicit==="command"?"command":initialLegacy?(params.get("kind")==="joining"||params.get("case")?"joining":params.get("kind")==="access"||params.get("grant")?"access":"directory"):"command";
  const navigate=(next:PartnerSection)=>{
    if(next==="command"){router.push("/partners",{scroll:false});return;}
    router.push("/partners?tab="+next,{scroll:false});
  };
  const openCase=(caseId:string)=>router.push("/partners?tab=joining&case="+encodeURIComponent(caseId),{scroll:false});
  return <section className="workspace-page bt-partners-command" data-testid="partners-command-center">
    <CommandFrame title="مركز الشركاء" subtitle="شبكة الشركاء والمتاجر والانضمام والتفويضات">
      <CommandSectionTabs label="أقسام الشركاء" active={active} tabs={tabs} onSelect={navigate}/>
      {active==="command"?<PartnersCommandOverview onTab={navigate} onCase={openCase}/>:
        <div className="bt-partners-register" data-active-section={active}>
          <PartnersWorkbench/>
        </div>}
    </CommandFrame>
  </section>;
}
