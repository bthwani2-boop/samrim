package transporthttp

import (
 "net/http"
 "strings"

 "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// Read and state changes use the existing Identity-backed Operator marketing
// authority. They never grant a Store a funding obligation.
func (s *MarketingServer) readOperatorMarketingCampaign(w http.ResponseWriter,r *http.Request){
 if !s.operatorAuthorized(w,r){return}
 id:=strings.TrimSpace(r.PathValue("campaignId"))
 campaign,err:=postgres.ReadMarketingCampaign(r.Context(),s.db,id)
 if err!=nil{writeMarketingError(w,err);return}
 w.Header().Set("Cache-Control","no-store")
 writeJSON(w,http.StatusOK,struct{Campaign postgres.MarketingCampaignRecord `json:"campaign"`}{campaign})
}

func (s *MarketingServer) setOperatorMarketingCampaignState(w http.ResponseWriter,r *http.Request){
 if !s.operatorAuthorized(w,r){return}
 actor,correlation,idempotency,expected,ok:=requiredVersionedCaseHeaders(w,r)
 if !ok{return}
 var body struct{ State string `json:"state"` }
 if !decodeJSON(w,r,&body){return}
 campaign,replayed,err:=postgres.SetMarketingCampaignState(
  r.Context(),s.db,r.PathValue("campaignId"),body.State,
  actor,correlation,idempotency,expected)
 if err!=nil{writeMarketingError(w,err);return}
 w.Header().Set("Cache-Control","no-store")
 writeJSON(w,responseStatus(replayed),struct {
   Campaign postgres.MarketingCampaignRecord `json:"campaign"`
   IdempotentReplay bool `json:"idempotentReplay"`
 }{campaign,replayed})
}
