package transporthttp

import (
	"encoding/json"
	"testing"
)

func TestFieldJoiningCaseDraftRequestKeepsOptionalFactsHonest(t *testing.T) {
	var partial fieldJoiningCaseDraftRequest
	if err := json.Unmarshal([]byte(`{"contactPhoneE164":"+967700000001"}`), &partial); err != nil {
		t.Fatalf("decode partial draft: %v", err)
	}
	if !partial.applyDraftScalars() || partial.FirstStoreLatitude != nil || partial.CreateFieldJoiningCaseDraftRequest.FirstStoreLatitude != 0 || partial.CreateFieldJoiningCaseDraftRequest.FirstStoreLongitude != 0 || partial.FirstStoreProofNumber != nil {
		t.Fatalf("omitted coordinates or private proof number were misrepresented: %+v", partial)
	}

	var oneCoordinate fieldJoiningCaseDraftRequest
	if err := json.Unmarshal([]byte(`{"contactPhoneE164":"+967700000001","firstStoreLatitude":15.3}`), &oneCoordinate); err != nil {
		t.Fatalf("decode incomplete coordinate pair: %v", err)
	}
	if oneCoordinate.applyDraftScalars() {
		t.Fatal("one supplied coordinate was treated as a complete location")
	}

	var complete fieldJoiningCaseDraftRequest
	if err := json.Unmarshal([]byte(`{"contactPhoneE164":"+967700000001","firstStoreLatitude":15.3,"firstStoreLongitude":44.2,"firstStoreProofNumber":""}`), &complete); err != nil {
		t.Fatalf("decode complete coordinate pair: %v", err)
	}
	if !complete.applyDraftScalars() {
		t.Fatal("complete draft scalar facts were rejected")
	}
	converted := complete.createRequest()
	if complete.CreateFieldJoiningCaseDraftRequest.FirstStoreLatitude != 15.3 || complete.CreateFieldJoiningCaseDraftRequest.FirstStoreLongitude != 44.2 || complete.FirstStoreProofNumber == nil || *complete.FirstStoreProofNumber != "" || converted.FirstStoreLatitude != 15.3 || converted.FirstStoreLongitude != 44.2 {
		t.Fatalf("supplied draft facts were not retained: %+v", complete)
	}
}
