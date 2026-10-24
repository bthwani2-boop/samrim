"use client";

import { useEffect, useState } from "react";
import { useSession } from "../../session/session-provider";
import { CommandFrame, CommandSectionTabs } from "../shared/command-surface";
import { EmployeeDirectory } from "./employee-directory";
import { HRCommandOverview } from "./hr-command-overview";
import "./hr-command-center.css";

type HRView="command"|"employees";
const views:ReadonlyArray<{id:HRView;label:string}>=[{id:"command",label:"القيادة"},{id:"employees",label:"الموظفون"}];
export function HRCenterWorkspace() {
  const {state}=useSession();
  const [view,setView]=useState<HRView>("command");
  useEffect(()=>{
    const restore=()=>{
      const params=new URLSearchParams(window.location.search);
      setView(params.get("hrView")==="employees"||params.has("employee")?"employees":"command");
    };
    restore();window.addEventListener("popstate",restore);
    return ()=>window.removeEventListener("popstate",restore);
  },[]);
  if(state.kind!=="authenticated")return null;
  if(state.identity.role!=="operator"||!state.identity.permissions?.includes("hr"))
    return <section className="state-content workspace-restricted" role="alert"><h1>صلاحية الموارد البشرية غير متاحة</h1><p>تحتاج إلى صلاحية الموارد البشرية لفتح ملفات الموظفين.</p></section>;
  const navigate=(next:HRView)=>{
    const url=new URL(window.location.href);
    if(next==="command"){url.searchParams.delete("hrView");url.searchParams.delete("employee");}
    else url.searchParams.set("hrView",next);
    window.history.pushState(window.history.state,"",url.pathname+url.search+url.hash);
    setView(next);
  };
  const openEmployee=(employeeId:string)=>{
    const url=new URL(window.location.href);
    url.searchParams.set("hrView","employees");
    url.searchParams.set("employee",employeeId);
    window.history.pushState(window.history.state,"",url.pathname+url.search+url.hash);
    setView("employees");
  };
  return <section className="workspace-page bt-hr-center" data-testid="hr-center">
    <CommandFrame title="الموارد البشرية" subtitle="ملفات الموظفين والهيكل الإداري وقرارات المتابعة">
      <CommandSectionTabs label="أقسام الموارد البشرية" active={view} tabs={views} onSelect={navigate}/>
      {view==="command"?<HRCommandOverview onEmployee={openEmployee} onRegistry={()=>navigate("employees")}/>:
        <div className="bt-hr-register"><EmployeeDirectory/></div>}
    </CommandFrame>
  </section>;
}
