package http

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/cashin"
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type Server struct {
	db                       *sql.DB
	serviceToken             string
	rootApprovalProofSecret  []byte
	destinationEncryptionKey *postgres.DestinationCipher
	financeEvidenceCipher    *postgres.DestinationCipher
	cashInRail               cashin.CashInRail
	cashInSimulatorEnabled   bool
}

func New(db *sql.DB, serviceToken, destinationEncryptionKey string, financeEvidenceEncryptionKey ...string) (*Server, error) {
	if db == nil || strings.TrimSpace(serviceToken) == "" {
		return nil, errors.New("WLT HTTP server configuration is invalid")
	}
	cipher, err := postgres.NewDestinationCipher(destinationEncryptionKey)
	if err != nil {
		return nil, err
	}
	if len(financeEvidenceEncryptionKey) != 1 || strings.TrimSpace(financeEvidenceEncryptionKey[0]) == "" {
		return nil, errors.New("WLT_FINANCE_EVIDENCE_ENCRYPTION_KEY is required")
	}
	evidenceCipher, err := postgres.NewDestinationCipher(financeEvidenceEncryptionKey[0])
	if err != nil {
		return nil, err
	}
	return &Server{db: db, serviceToken: strings.TrimSpace(serviceToken), destinationEncryptionKey: cipher, financeEvidenceCipher: evidenceCipher}, nil
}

func (s *Server) ConfigureRootApprovalProofSecret(secret string) error {
	secret = strings.TrimSpace(secret)
	if secret != "" && len(secret) < 32 {
		return errors.New("Root Owner proof key is too short")
	}
	s.rootApprovalProofSecret = []byte(secret)
	return nil
}

func NewWithCashInConfig(db *sql.DB, serviceToken, destinationEncryptionKey, financeEvidenceEncryptionKey, cashInMode, environment string, mockURL ...string) (*Server, error) {
	rail, simulatorEnabled, err := cashInRailForConfig(cashInMode, environment, mockURL...)
	if err != nil {
		return nil, err
	}
	server, err := New(db, serviceToken, destinationEncryptionKey, financeEvidenceEncryptionKey)
	if err != nil {
		return nil, err
	}
	server.cashInRail = rail
	server.cashInSimulatorEnabled = simulatorEnabled
	return server, nil
}

func cashInRailForConfig(cashInMode, environment string, mockURL ...string) (cashin.CashInRail, bool, error) {
	mode := strings.ToLower(strings.TrimSpace(cashInMode))
	environment = strings.ToLower(strings.TrimSpace(environment))
	if mode == "" || mode == "disabled" {
		return nil, false, nil
	}
	if environment != "development" {
		return nil, false, errors.New("WLT Cash-In testing rails are permitted only in development; production requires an approved real rail")
	}
	if mode == "simulator" {
		return cashin.DevelopmentSimulator{}, true, nil
	}
	if mode == "wiremock" && len(mockURL) == 1 {
		rail, err := cashin.NewWireMockRail(mockURL[0])
		return rail, err == nil, err
	}
	return nil, false, errors.New("unsupported WLT Cash-In rail configuration")
}

func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /wlt/v1/payment-intents", s.create)
	mux.HandleFunc("POST /wlt/v1/order-adjustment-reconciliation-cases", s.recordOrderAdjustmentReconciliationCase)
	mux.HandleFunc("GET /wlt/v1/order-adjustment-reconciliation-cases", s.listOrderAdjustmentReconciliationCases)
	mux.HandleFunc("POST /wlt/v1/operator/order-adjustment-reconciliation-cases/{caseId}/wallet-credit", s.creditReviewedCustomerWallet)
	mux.HandleFunc("GET /wlt/v1/payment-intents/by-external-reference", s.readByExternalReference)
	mux.HandleFunc("GET /wlt/v1/payment-intents/{intentId}", s.read)
	mux.HandleFunc("POST /wlt/v1/payment-intents/{intentId}/collect", s.collect)
	mux.HandleFunc("POST /wlt/v1/payment-intents/{intentId}/cancel", s.cancel)
	mux.HandleFunc("GET /wlt/v1/captains/{captainActorId}/cash-liability", s.cashLiability)
	mux.HandleFunc("GET /wlt/v1/captains/{captainActorId}/wallet-state", s.captainWalletState)
	mux.HandleFunc("POST /wlt/v1/captain-cod-reservations", s.reserveCaptainCOD)
	mux.HandleFunc("POST /wlt/v1/captain-cod-reservations/{orderId}/release", s.releaseCaptainCOD)
	mux.HandleFunc("POST /wlt/v1/captain-cod-reservations/{orderId}/finalize", s.finalizeCaptainCOD)
	mux.HandleFunc("GET /wlt/v1/operator/cash-liability", s.operatorCashLiability)
	mux.HandleFunc("POST /wlt/v1/payment-intents/{intentId}/remit", s.remitCash)
	mux.HandleFunc("POST /wlt/v1/operator/cash-remittances/{remittanceId}/reconcile", s.reconcileCashRemittance)
	mux.HandleFunc("POST /wlt/v1/delivery-quotes", s.deliveryQuote)
	mux.HandleFunc("GET /wlt/v1/operator/promotion-settlement/{promotionId}", s.readOperatorPromotionSettlement)
	mux.HandleFunc("GET /wlt/v1/operator/policy-history", s.readOperatorPolicyHistory)
	mux.HandleFunc("GET /wlt/v1/operator/policy-registry", s.readOperatorPolicyRegistry)
	mux.HandleFunc("GET /wlt/v1/operator/captain-minimum-balance-policy", s.readCaptainMinimumBalancePolicy)
	mux.HandleFunc("POST /wlt/v1/operator/captain-minimum-balance-policy", s.createCaptainMinimumBalancePolicy)
	mux.HandleFunc("GET /wlt/v1/operator/captain-minimum-balance-policy/history", s.listCaptainMinimumBalancePolicyHistory)
	mux.HandleFunc("GET /wlt/v1/operator/distance-band-fee-policies", s.readDistanceBandFeePolicy)
	mux.HandleFunc("POST /wlt/v1/operator/distance-band-fee-policies", s.createDistanceBandFeePolicy)
	mux.HandleFunc("GET /wlt/v1/operator/delivery-fee-policies", s.readDeliveryFeePolicy)
	mux.HandleFunc("POST /wlt/v1/operator/delivery-fee-policies", func(w http.ResponseWriter, r *http.Request) {
		if !s.authorize(w, r) {
			return
		}
		writeError(w, http.StatusGone, "LEGACY_PRICING_DISABLED", "Use the distance-band delivery fee policy")
	})
	mux.HandleFunc("GET /wlt/v1/operator/partner-financial-terms-policy", s.readPartnerFinancialTermsPolicy)
	mux.HandleFunc("POST /wlt/v1/operator/partner-financial-terms-policy", s.createPartnerFinancialTermsPolicy)
	mux.HandleFunc("POST /wlt/v1/partner-financial-profiles", s.preparePartnerFinancialProfile)
	mux.HandleFunc("GET /wlt/v1/partner-financial-profiles/{profileId}", s.readPartnerFinancialProfile)
	mux.HandleFunc("POST /wlt/v1/partner-financial-profiles/{profileId}/activate", s.activatePartnerFinancialProfile)
	mux.HandleFunc("GET /wlt/v1/operator/commercial-store-type-commission-defaults", s.readStoreTypeCommissionDefaults)
	mux.HandleFunc("POST /wlt/v1/operator/commercial-store-type-commission-defaults", s.updateStoreTypeCommissionDefault)
	mux.HandleFunc("GET /wlt/v1/store-commercial-agreements", s.readStoreCommercialAgreements)
	mux.HandleFunc("GET /wlt/v1/operator/store-commercial-agreements", s.listStoreCommercialAgreementsForFinance)
	mux.HandleFunc("POST /wlt/v1/store-commercial-agreements", s.proposeStoreCommercialAgreement)
	mux.HandleFunc("POST /wlt/v1/store-commercial-agreements/{agreementId}/accept", s.acceptStoreCommercialAgreement)
	mux.HandleFunc("POST /wlt/v1/operator/store-commercial-agreements/{agreementId}/decision", s.decideStoreCommercialAgreement)
	mux.HandleFunc("POST /wlt/v1/partner-order-earnings/finalize", s.finalizePartnerOrderEarning)
	mux.HandleFunc("POST /wlt/v1/partner-store-cash-commissions/finalize", s.finalizePartnerStoreCashCommission)
	mux.HandleFunc("POST /wlt/v1/operator/partners/{partnerActorId}/commission-remittances", s.recordPartnerCommissionRemittance)
	mux.HandleFunc("GET /wlt/v1/partners/{partnerActorId}/financial-summary", s.readPartnerFinancialSummary)
	mux.HandleFunc("GET /wlt/v1/partners/{partnerActorId}/financial-activity", s.readPartnerActivity)
	mux.HandleFunc("GET /wlt/v1/operator/partner-commission-receivables", s.listPartnerCommissionReceivables)
	mux.HandleFunc("POST /wlt/v1/operator/official-wallet-destinations", s.createOfficialWalletDestination)
	mux.HandleFunc("POST /wlt/v1/operator/official-wallet-destinations/{destinationId}/verify", s.verifyOfficialWalletDestination)
	mux.HandleFunc("POST /wlt/v1/operator/official-wallet-destinations/{destinationId}/activate", s.activateOfficialWalletDestination)
	mux.HandleFunc("GET /wlt/v1/official-wallet-destinations/{actorType}/{actorId}", s.readOfficialWalletDestination)
	mux.HandleFunc("GET /wlt/v1/official-wallet-destinations/by-id/{destinationId}", s.readOfficialWalletDestinationByID)
	mux.HandleFunc("POST /wlt/v1/payout-intents", s.createPayoutIntent)
	mux.HandleFunc("POST /wlt/v1/settlement-intakes", s.createSettlementIntake)
	mux.HandleFunc("GET /wlt/v1/settlement-intakes/{actorType}/{actorId}", s.listSettlementIntakes)
	mux.HandleFunc("GET /wlt/v1/operator/settlement-intakes", s.operatorSettlementIntakes)
	mux.HandleFunc("GET /wlt/v1/settlement-intakes/by-id/{intakeId}", s.readSettlementIntake)
	mux.HandleFunc("POST /wlt/v1/operator/settlement-intakes/{intakeId}/convert", s.convertSettlementIntake)
	mux.HandleFunc("POST /wlt/v1/operator/settlement-intakes/{intakeId}/cancel", s.cancelSettlementIntake)
	mux.HandleFunc("GET /wlt/v1/partners/{partnerActorId}/store-payout-recipients", s.readPartnerStorePayoutRecipients)
	mux.HandleFunc("GET /wlt/v1/partners/{partnerActorId}/store-payout-recipients/{storeId}", s.readStorePayoutRecipientByStore)
	mux.HandleFunc("PUT /wlt/v1/store-payout-recipients/{storeId}", s.selectStorePayoutRecipient)
	mux.HandleFunc("POST /wlt/v1/store-payout-recipients/{storeId}/revert", s.revertStorePayoutRecipient)
	mux.HandleFunc("POST /wlt/v1/store-payout-recipients/{storeId}/review-required", s.markStorePayoutRecipientReviewRequired)
	mux.HandleFunc("POST /wlt/v1/partners/{partnerActorId}/payout-requests", s.createPartnerPayoutRequest)
	mux.HandleFunc("GET /wlt/v1/partners/{partnerActorId}/payout-requests/{requestId}", s.readPartnerPayoutRequest)
	mux.HandleFunc("GET /wlt/v1/partners/{partnerActorId}/payout-requests", s.readPartnerPayoutRequest)
	mux.HandleFunc("GET /wlt/v1/payout-state/{actorType}/{actorId}", s.readPayoutState)
	mux.HandleFunc("GET /wlt/v1/operator/payout-requests", s.listPayoutRequests)
	mux.HandleFunc("GET /wlt/v1/operator/beneficiaries", s.listBeneficiaryPayoutStates)
	mux.HandleFunc("GET /wlt/v1/operator/beneficiaries/{actorType}/{actorId}/financial-statement", s.readFinancialStatement)
	mux.HandleFunc("GET /wlt/v1/operator/financial-statements", s.listFinancialStatementSummaries)
	mux.HandleFunc("GET /wlt/v1/operator/payout-requests/{payoutId}", s.readOperatorPayoutRequest)
	mux.HandleFunc("POST /wlt/v1/operator/payout-requests/{payoutId}/prepare", s.preparePayout)
	mux.HandleFunc("POST /wlt/v1/operator/payout-requests/{payoutId}/approve", s.approvePayout)
	mux.HandleFunc("POST /wlt/v1/operator/payout-requests/{payoutId}/cancel", s.cancelPayout)
	mux.HandleFunc("POST /wlt/v1/operator/settlement-batches", s.createSettlementBatch)
	mux.HandleFunc("GET /wlt/v1/operator/settlement-batches", s.listSettlementBatches)
	mux.HandleFunc("GET /wlt/v1/operator/settlement-batches/{batchId}", s.readSettlementBatch)
	mux.HandleFunc("POST /wlt/v1/operator/settlement-batches/{batchId}/export", s.exportSettlementBatch)
	mux.HandleFunc("POST /wlt/v1/operator/settlement-batches/{batchId}/approve", s.approveSettlementBatch)
	mux.HandleFunc("POST /wlt/v1/operator/settlement-batches/{batchId}/freeze", s.freezeSettlementBatch)
	mux.HandleFunc("POST /wlt/v1/operator/settlement-batches/{batchId}/transfers", s.recordManualTransfer)
	mux.HandleFunc("POST /wlt/v1/operator/transfers/{transferId}/verify", s.verifyManualTransfer)
	mux.HandleFunc("POST /wlt/v1/operator/transfers/{transferId}/reconcile", s.reconcileManualTransfer)
	mux.HandleFunc("POST /wlt/v1/operator/settlement-statements", s.registerSettlementStatement)
	mux.HandleFunc("POST /wlt/v1/operator/settlement-statements/{statementId}/rows", s.recordSettlementStatementRow)
	mux.HandleFunc("POST /wlt/v1/operator/finance-evidence-documents", s.uploadFinanceEvidenceDocument)
	mux.HandleFunc("GET /wlt/v1/operator/finance-evidence-documents/{documentId}", s.readFinanceEvidenceDocument)
	mux.HandleFunc("POST /wlt/v1/operator/customer-withdrawal-intakes", s.createCustomerWithdrawalIntake)
	mux.HandleFunc("GET /wlt/v1/operator/customer-withdrawal-intakes", s.listCustomerWithdrawalIntakes)
	mux.HandleFunc("GET /wlt/v1/operator/customer-withdrawal-intakes/{intakeId}", s.readCustomerWithdrawalIntake)
	mux.HandleFunc("POST /wlt/v1/operator/customer-withdrawal-intakes/{intakeId}/prepare-destination", s.prepareCustomerWithdrawalDestination)
	mux.HandleFunc("POST /wlt/v1/operator/customer-withdrawal-intakes/{intakeId}/accept", s.acceptCustomerWithdrawal)
	mux.HandleFunc("POST /wlt/v1/operator/customer-withdrawal-intakes/{intakeId}/reject", s.rejectCustomerWithdrawal)
	mux.HandleFunc("POST /wlt/v1/wallets/{actorType}/{actorId}/funding-intents", s.createCashInFundingIntent)
	mux.HandleFunc("GET /wlt/v1/wallets/{actorType}/{actorId}/state", s.readWalletState)
	mux.HandleFunc("GET /wlt/v1/wallets/{actorType}/{actorId}/funding-intents", s.listCashInFundingIntents)
	mux.HandleFunc("GET /wlt/v1/funding-intents/{fundingIntentId}", s.readCashInFundingIntent)
	if _, ok := s.cashInRail.(cashInSimulator); ok && s.cashInSimulatorEnabled {
		mux.HandleFunc("POST /wlt/v1/development/funding-intents/{fundingIntentId}/simulate", s.simulateCashInFundingIntent)
	}
	if isProviderMock(s.cashInRail) && s.cashInSimulatorEnabled {
		mux.HandleFunc("POST /wlt/v1/development/funding-intents/{fundingIntentId}/reconcile", s.reconcileDevelopmentFundingIntent)
	}
}
