package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func TestStoreCommercialAgreementHTTPResponseIncludesCanonicalFinanceDecisionForApprovalAndRejection(t *testing.T) {
	decidedAt := time.Date(2026, time.October, 4, 12, 30, 0, 0, time.UTC)
	for _, status := range []string{"ACTIVE", "FINANCE_REJECTED"} {
		t.Run(status, func(t *testing.T) {
			record := postgres.StoreCommercialAgreementRecord{
				AgreementID: "agreement-1", StoreID: "store-1", PartnerActorID: "partner-1", AgreementVersion: 1,
				Status: status, FinanceDecisionByActorID: stringRef("finance-1"), FinanceDecisionAt: &decidedAt,
				FinanceDecisionReason: stringRef("Finance reviewed these terms"),
			}
			response := storeCommercialAgreementResponse{Agreement: record, IdempotentReplay: false}
			writer := httptest.NewRecorder()
			writeJSON(writer, http.StatusOK, response)
			if writer.Code != http.StatusOK {
				t.Fatalf("WLT agreement HTTP status = %d, want 200", writer.Code)
			}
			var body struct {
				Agreement map[string]json.RawMessage `json:"agreement"`
			}
			if err := json.Unmarshal(writer.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode WLT agreement response: %v", err)
			}
			for key, want := range map[string]string{
				"financeDecisionByActorId": "\"finance-1\"",
				"financeDecisionAt":        "\"2026-10-04T12:30:00Z\"",
				"financeDecisionReason":    "\"Finance reviewed these terms\"",
			} {
				if string(body.Agreement[key]) != want {
					t.Errorf("%s response %s = %s, want %s", status, key, body.Agreement[key], want)
				}
			}
		})
	}
	t.Run("pending decisions remain explicit null", func(t *testing.T) {
		writer := httptest.NewRecorder()
		writeJSON(writer, http.StatusCreated, storeCommercialAgreementResponse{
			Agreement: postgres.StoreCommercialAgreementRecord{AgreementID: "agreement-2", Status: "PROPOSED"},
		})
		var body struct {
			Agreement map[string]json.RawMessage `json:"agreement"`
		}
		if err := json.Unmarshal(writer.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode pending WLT agreement response: %v", err)
		}
		for _, key := range []string{"financeDecisionByActorId", "financeDecisionAt", "financeDecisionReason"} {
			if value, exists := body.Agreement[key]; !exists || string(value) != "null" {
				t.Errorf("pending agreement %s = %s (exists=%t), want explicit null", key, value, exists)
			}
		}
	})
}

func stringRef(value string) *string { return &value }
