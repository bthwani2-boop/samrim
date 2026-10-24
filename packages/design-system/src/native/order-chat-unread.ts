import { useEffect, useState } from "react";

/** Bounded, scope-isolated unread polling for visible order cards. A failed read is never treated as a zero. */
export function useOrderChatUnreadCounts(
  orderIds: ReadonlyArray<string>,
  actorScope: string,
  enabled: boolean,
  getUnread: (orderId: string) => Promise<number>,
  refreshKey = "",
): Readonly<Record<string, number>> {
  const [counts,setCounts]=useState<Readonly<Record<string,number>>>({});
  const idsKey=orderIds.slice(0,12).join("|");
  useEffect(()=>{
    let active=true;
    setCounts({});
    if(!enabled||!actorScope||!idsKey)return()=>{active=false;};
    const ids=idsKey.split("|");
    const refresh=async()=>{
      const updates:Record<string,number>={};
      for(let i=0;i<ids.length;i+=3){
        const batch=await Promise.all(ids.slice(i,i+3).map(async id=>{
          try {const count=await getUnread(id);return Number.isSafeInteger(count)&&count>=0?{id,count}:null;}
          catch{return null;}
        }));
        if(!active)return;
        for(const item of batch)if(item)updates[item.id]=item.count;
      }
      if(active)setCounts(updates);
    };
    void refresh();
    const interval=setInterval(()=>void refresh(),20000);
    return()=>{active=false;clearInterval(interval);};
  },[idsKey,actorScope,enabled,getUnread,refreshKey]);
  return counts;
}
