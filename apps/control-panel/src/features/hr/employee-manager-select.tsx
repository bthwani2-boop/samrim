"use client";
import { useMemo,useState } from "react";
import type { HREmployee,HREmployeePage } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";

type Props=Readonly<{value:string;initial:readonly HREmployee[];excludeId?:string;onChange:(id:string)=>void;disabled?:boolean}>;
export function EmployeeManagerSelect({value,initial,excludeId="",onChange,disabled=false}:Props){
 const [search,setSearch]=useState("");
 const [matches,setMatches]=useState<readonly HREmployee[]>([]);
 const [loading,setLoading]=useState(false);
 const [nextCursor,setNextCursor]=useState("");
 const [error,setError]=useState("");
 const people=useMemo(()=>{
  const byId=new Map<string,HREmployee>();
  for(const entry of [...initial,...matches])if(entry.status==="active"&&entry.id!==excludeId)byId.set(entry.id,entry);
  return [...byId.values()];
 },[initial,matches,excludeId]);
 const hasSelected=people.some(person=>person.id===value);
 async function find(cursor=""){
  if(loading)return;
  setLoading(true);setError("");
  try{
   const params=new URLSearchParams({q:search.trim(),limit:"50",cursor});
   const result=await identityFetch(`/api/hr/employees?${params}`);
   if(!result.ok)throw new Error("تعذر البحث عن الموظفين");
   const page=await result.json() as HREmployeePage;
   setMatches(previous=>cursor?[...previous,...page.items]:page.items);
   setNextCursor(page.nextCursor??"");
  }catch(e){setError(e instanceof Error?e.message:"تعذر البحث");}
  finally{setLoading(false)}
 }
 return <div className="form-section" style={{maxInlineSize:400}}>
  <label className="field-label">البحث عن المسؤول المباشر
   <input value={search} maxLength={80} disabled={disabled||loading} onChange={e=>setSearch(e.target.value)} placeholder="اسم الموظف أو القسم"/>
  </label>
  <button className="button button-quiet" type="button" disabled={disabled||loading} onClick={()=>void find("")}>{loading?"جارٍ البحث…":"بحث عن مسؤول"}</button>
  <label className="field-label">المسؤول المباشر (اختياري)
   <select value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>
    <option value="">غير محدد</option>
    {value&&!hasSelected?<option value={value}>المسؤول الحالي — خارج نتائج البحث</option>:null}
    {people.map(person=><option key={person.id} value={person.id}>{person.fullNameAr}</option>)}
   </select>
  </label>
  {nextCursor?<button type="button" className="button button-quiet" disabled={disabled||loading} onClick={()=>void find(nextCursor)}>عرض المزيد من نتائج البحث</button>:null}
  {error?<p role="alert">{error}</p>:null}
 </div>;
}
