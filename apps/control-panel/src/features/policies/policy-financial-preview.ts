import type { CaptainMinimumBalanceResponse, OperatorFinancialPolicyRegistry } from "../../server/dsh/dsh-bff";
import type { PolicyResourceKey } from "./policy-capabilities";
import type { PolicyPreviewState } from "./policy-quick-peek";

type Results=Partial<Record<PolicyResourceKey,PolicyPreviewState>>;
const money=(amount:number)=>new Intl.NumberFormat("ar-YE").format(amount)+" ريال";
const failure:PolicyPreviewState={kind:"error"};
async function get(url:string,signal:AbortSignal):Promise<{status:number;body:unknown}>{
 const response=await fetch(url,{cache:"no-store",signal});
 return {status:response.status,body:await response.json()};
}
export async function readFinancialPolicyPreviews(signal:AbortSignal,canReadTerms:boolean):Promise<Results>{
 const [registry,terms,captain]=await Promise.allSettled([
  get("/api/finance/policy-registry",signal),
  canReadTerms?get("/api/finance/partner-financial-terms-policy",signal):Promise.resolve(null),
  get("/api/finance/captain-minimum-balance-policy",signal)
 ]);
 const result:Results={};
 if(registry.status==="fulfilled"&&registry.value.status===200){
  const data=registry.value.body as OperatorFinancialPolicyRegistry;
  if(Array.isArray(data.deliveryFees)&&Number.isSafeInteger(data.deliveryTotal)){
   const global=data.deliveryFees.find(p=>p.id==="");
   const bandsSummary=(items:readonly {upToMeters:number|null;ratePerKmMinor:number}[])=>items.map((b,i)=>`${b.upToMeters===null?"∞":`${b.upToMeters/1000} كم`}: ${money(b.ratePerKmMinor)}/كم`).join(" · ");
   const visibleFees=data.deliveryFees.slice(0,5);
   result["delivery-fees"]={kind:"ready",value:{
    active:data.deliveryTotal,inactive:null,
    headline:data.deliveryTotal===0?"لم تُعتمد شرائح التوصيل بعد":`${data.deliveryTotal} نطاقات تسعير${global ? ` · عام: ${bandsSummary(global.distanceBands)}` : ""}`,
    note:data.deliveryTotal>visibleFees.length?"تظهر عينة من النطاقات؛ جميع القواعد تُقرأ من WLT.":"القاعدة الخاصة بالمدينة تتقدم على القاعدة العامة.",
    records:visibleFees.map(p=>({id:p.id||"global",name:p.name,active:true,version:p.version,createdAt:p.createdAt,createdBy:p.createdBy,
      detail:bandsSummary(p.distanceBands)}))
   }};
  }else{
   result["delivery-fees"]=failure;
  }
 }else{result["delivery-fees"]=failure;}
 if(!canReadTerms){result["partner-financial-terms"]={kind:"restricted"}}
 else if(terms.status==="fulfilled"&&terms.value!==null){
  if(terms.value.status===404){result["partner-financial-terms"]={kind:"missing"}}
  else if(terms.value.status===200){
   const p=(terms.value.body as {policy?:{id:string;settlementPeriod:string;version:number;createdBy:string;createdAt:string}}).policy;
   const label=p?.settlementPeriod==="DAILY"?"يومية":p?.settlementPeriod==="WEEKLY"?"أسبوعية":p?.settlementPeriod==="MONTHLY"?"شهرية":null;
   result["partner-financial-terms"]=p&&label?{kind:"ready",value:{active:1,inactive:null,headline:`التسوية ${label} · v${p.version}`,records:[
    {id:p.id,name:"فترة التسوية",active:true,detail:label,version:p.version,createdAt:p.createdAt,createdBy:p.createdBy}
   ],note:"شروط التسوية لا تمثل عمولة عامة على المتاجر."}}:failure;
  }else result["partner-financial-terms"]=failure;
 }else result["partner-financial-terms"]=failure;
 if(captain.status==="fulfilled"){
  if(captain.value.status===404&&(captain.value.body as {error?:{code?:string}}).error?.code==="CAPTAIN_MINIMUM_BALANCE_NOT_CONFIGURED"){
   result["captain-minimum-balance"]={kind:"missing"};
  }else if(captain.value.status===200){
   const p=(captain.value.body as CaptainMinimumBalanceResponse).policy;
   result["captain-minimum-balance"]=p&&p.state==="ACTIVE"&&p.currency==="YER"&&p.minimumAvailableMinor>0?
    {kind:"ready",value:{active:1,inactive:null,headline:`شحن التفعيل الأول ${money(p.minimumAvailableMinor)} · v${p.version}`,
     records:[{id:p.id,name:"كابتن بثواني · شحن التفعيل الأول",active:true,detail:money(p.minimumAvailableMinor),version:p.version,createdAt:p.createdAt,createdBy:p.createdBy}],
     note:"يُفحص مرة واحدة عند أول إتاحة للعمل، ثم تحمي WLT كل طلب نقدي بحجز قيمته كاملة، دون حد يومي."}}:failure;
  }else result["captain-minimum-balance"]=failure;
 }else result["captain-minimum-balance"]=failure;
 return result;
}
