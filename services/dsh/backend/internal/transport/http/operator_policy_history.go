package transporthttp

import (
 "net/http"
 "strings"
 "time"

 "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)
func (s *FieldFinanceServer) readPolicyHistory(w http.ResponseWriter,r *http.Request){
 if !s.authorizeOperator(w,r){return}
 actor:=strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
 if !s.requireOperator(w,r.Context(),actor)||!s.requirePermission(w,r.Context(),actor,"platform_policies"){return}
 key:=strings.TrimSpace(r.URL.Query().Get("key"))
 scope:=strings.TrimSpace(r.URL.Query().Get("scopeId"))
 if len(scope)>128{writeError(w,http.StatusBadRequest,"INVALID_INPUT","scope too long");return}
 if key=="partner-financial-terms" && !s.requirePermission(w,r.Context(),actor,"finance"){return}
 var events []wlt.PolicyChange
 if key=="service-cities" || key=="wallet-providers" {
  table:="dsh.service_city_audit"
  scopeColumn:="city_id"
  field:="مدينة الخدمة"
  if key=="wallet-providers"{table="dsh.wallet_provider_audit";scopeColumn="provider_key";field="مزود المحفظة"}
  // Table and column names are fixed literals from the closed key selector, never request SQL.
  query:="SELECT id::text,"+scopeColumn+",result_version,acting_actor_id,created_at,COALESCE(from_active::text,''),to_active::text,display_name_ar,event_type FROM "+table+
   " WHERE ($1='' OR "+scopeColumn+"=$1) ORDER BY created_at DESC,id DESC LIMIT 50"
  rows,err:=s.db.QueryContext(r.Context(),query,scope)
  if err!=nil{writeError(w,http.StatusBadGateway,"DSH_STORAGE_UNAVAILABLE","policy audit unavailable");return}
  events=make([]wlt.PolicyChange,0)
  for rows.Next(){
   var p wlt.PolicyChange
   var before,after,name,eventType string
   var at time.Time
   if err=rows.Scan(&p.ID,&p.ScopeID,&p.Version,&p.ActorID,&at,&before,&after,&name,&eventType);err!=nil{
    rows.Close();writeError(w,http.StatusBadGateway,"DSH_STORAGE_UNAVAILABLE","policy audit read unavailable");return
   }
   p.CreatedAt=at.UTC().Format(time.RFC3339Nano)
   p.Field=field+" · "+name
   p.Before=before;p.After=after
   p.Reason=eventType
   events=append(events,p)
  }
  err=rows.Err();rows.Close()
  if err!=nil{writeError(w,http.StatusBadGateway,"DSH_STORAGE_UNAVAILABLE","policy audit read unavailable");return}
 }else if key=="delivery-fees"||key=="field-acquisition"||key=="partner-financial-terms"||key=="captain-minimum-balance"{
  var err error
  events,err=s.payment.ReadOperatorPolicyHistory(r.Context(),key,scope)
  if err!=nil{writeWLTFinanceError(w,err);return}
 }else{
  writeError(w,http.StatusBadRequest,"INVALID_INPUT","unknown policy");return
 }
 w.Header().Set("Cache-Control","no-store")
 if events==nil{events=[]wlt.PolicyChange{}}
 writeJSON(w,http.StatusOK,map[string]any{"items":events})
}
