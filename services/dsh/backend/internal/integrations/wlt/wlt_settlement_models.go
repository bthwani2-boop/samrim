package wlt

import (
	"time"
)

type FinancialStatementEntry struct {
	TransactionID   string                   `json:"transactionId"`
	TransactionType string                   `json:"transactionType"`
	SourceType      string                   `json:"sourceType"`
	SourceID        string                   `json:"sourceId"`
	Direction       string                   `json:"direction"`
	AmountMinor     int64                    `json:"amountMinor"`
	Currency        string                   `json:"currency"`
	CreatedAt       string                   `json:"createdAt"`
	BalanceAfter    int64                    `json:"balanceAfterMinor"`
	Order           *FinancialStatementOrder `json:"order,omitempty"`
	Store           *FinancialStatementStore `json:"store,omitempty"`
}

type FinancialStatementStore struct {
	StoreID          string `json:"storeId"`
	Name             string `json:"name"`
	PublicationState string `json:"publicationState"`
}

type FinancialStatementOrder struct {
	OrderID       string                        `json:"orderId"`
	StoreName     string                        `json:"storeName"`
	State         string                        `json:"state"`
	Fulfillment   string                        `json:"fulfillmentMode"`
	SubtotalMinor int64                         `json:"subtotalAmountMinor"`
	DiscountMinor int64                         `json:"discountMinor"`
	TotalMinor    int64                         `json:"totalAmountMinor"`
	Currency      string                        `json:"currency"`
	CreatedAt     string                        `json:"createdAt"`
	Lines         []FinancialStatementOrderLine `json:"lines"`
}

type FinancialStatementOrderLine struct {
	ProductName       string `json:"productName"`
	VariantTitle      string `json:"variantTitle"`
	QuantityBaseUnits int64  `json:"quantityBaseUnits"`
	UnitPriceMinor    int64  `json:"unitPriceMinor"`
	LineAmountMinor   int64  `json:"lineAmountMinor"`
	Currency          string `json:"currency"`
}

type FinancialStatement struct {
	ActorType      string                    `json:"actorType"`
	ActorID        string                    `json:"actorId"`
	Currency       string                    `json:"currency"`
	PeriodStart    string                    `json:"periodStart"`
	PeriodEnd      string                    `json:"periodEnd"`
	OpeningBalance int64                     `json:"openingBalanceMinor"`
	Credits        int64                     `json:"creditsMinor"`
	Debits         int64                     `json:"debitsMinor"`
	ClosingBalance int64                     `json:"closingBalanceMinor"`
	CurrentBalance int64                     `json:"currentBalanceMinor"`
	Entries        []FinancialStatementEntry `json:"entries"`
	NextCursor     string                    `json:"nextCursor,omitempty"`
	Limit          int                       `json:"limit"`
}

type FinancialStatementSummary struct {
	ActorType              string `json:"actorType"`
	ActorID                string `json:"actorId"`
	BeneficiaryName        string `json:"beneficiaryName"`
	WalletIdentifierMasked string `json:"walletIdentifierMasked"`
	Currency               string `json:"currency"`
	OpeningBalance         int64  `json:"openingBalanceMinor"`
	Credits                int64  `json:"creditsMinor"`
	Debits                 int64  `json:"debitsMinor"`
	ClosingBalance         int64  `json:"closingBalanceMinor"`
	CurrentBalance         int64  `json:"currentBalanceMinor"`
	HeldMinor              int64  `json:"heldMinor"`
	AvailableMinor         int64  `json:"availableMinor"`
}

type FinancialStatementSummaryTotals struct {
	OpeningBalance int64 `json:"openingBalanceMinor"`
	Credits        int64 `json:"creditsMinor"`
	Debits         int64 `json:"debitsMinor"`
	ClosingBalance int64 `json:"closingBalanceMinor"`
	CurrentBalance int64 `json:"currentBalanceMinor"`
	HeldMinor      int64 `json:"heldMinor"`
	AvailableMinor int64 `json:"availableMinor"`
}

type FinancialStatementSummaryRegistry struct {
	ActorType   string                          `json:"actorType"`
	PeriodStart string                          `json:"periodStart"`
	PeriodEnd   string                          `json:"periodEnd"`
	Summaries   []FinancialStatementSummary     `json:"summaries"`
	Totals      FinancialStatementSummaryTotals `json:"totals"`
	NextCursor  string                          `json:"nextCursor,omitempty"`
	Limit       int                             `json:"limit"`
}

type OfficialWalletDestination struct {
	ID                            string  `json:"id"`
	ActorType                     string  `json:"actorType"`
	ActorID                       string  `json:"actorId"`
	ProviderKey                   string  `json:"providerKey"`
	WalletIdentifierMasked        string  `json:"walletIdentifierMasked"`
	BeneficiaryName               string  `json:"beneficiaryName"`
	BeneficiaryIdentityVersion    int     `json:"beneficiaryIdentityVersion"`
	VerificationStatus            string  `json:"verificationStatus"`
	Status                        string  `json:"status"`
	Version                       int     `json:"version"`
	ChangeReason                  string  `json:"changeReason"`
	SubmittedBy                   string  `json:"submittedBy"`
	SubmittedAt                   string  `json:"submittedAt"`
	VerifiedBy                    *string `json:"verifiedBy"`
	VerifiedAt                    *string `json:"verifiedAt"`
	ApprovedBy                    *string `json:"approvedBy"`
	ApprovedAt                    *string `json:"approvedAt"`
	VerificationEvidenceReference string  `json:"verificationEvidenceReference"`
	ChangeEvidenceReference       string  `json:"changeEvidenceReference"`
	CreatedAt                     string  `json:"createdAt"`
	UpdatedAt                     string  `json:"updatedAt"`
}

type PayoutRequest struct {
	BeneficiaryActorID   string `json:"beneficiaryActorId"`
	ID                   string `json:"id"`
	ActorType            string `json:"actorType"`
	ActorID              string `json:"actorId"`
	AmountMode           string `json:"amountMode"`
	RequestedAmountMinor *int64 `json:"requestedAmountMinor"`
	ResolvedAmountMinor  int64  `json:"resolvedAmountMinor"`
	Currency             string `json:"currency"`
	DestinationID        string `json:"destinationId"`
	DestinationVersion   int    `json:"destinationVersion"`
	Status               string `json:"status"`
	PolicyVersion        string `json:"policyVersion"`
	LedgerTransactionID  string `json:"ledgerTransactionId,omitempty"`
	CreatedAt            string `json:"createdAt"`
}

type SettlementBatch struct {
	ID               string                `json:"id"`
	ProviderKey      string                `json:"providerKey"`
	Currency         string                `json:"currency"`
	Status           string                `json:"status"`
	RowCount         int                   `json:"rowCount"`
	TotalAmountMinor int64                 `json:"totalAmountMinor"`
	CreatedBy        string                `json:"createdBy"`
	CreatedAt        string                `json:"createdAt"`
	ApprovedBy       *string               `json:"approvedBy,omitempty"`
	ApprovedAt       *string               `json:"approvedAt,omitempty"`
	FrozenBy         *string               `json:"frozenBy,omitempty"`
	FrozenAt         *string               `json:"frozenAt,omitempty"`
	BatchHash        string                `json:"batchHash,omitempty"`
	Items            []SettlementBatchItem `json:"items"`
}

type SettlementBatchExport struct {
	ID                 string `json:"id"`
	BatchID            string `json:"batchId"`
	EvidenceDocumentID string `json:"evidenceDocumentId"`
	Filename           string `json:"filename"`
	ContentType        string `json:"contentType"`
	SHA256             string `json:"sha256"`
	SizeBytes          int64  `json:"sizeBytes"`
	RowCount           int    `json:"rowCount"`
	TotalAmountMinor   int64  `json:"totalAmountMinor"`
	Currency           string `json:"currency"`
	GeneratedBy        string `json:"generatedBy"`
	CreatedAt          string `json:"createdAt"`
}

type settlementBatchExportResponse struct {
	Export SettlementBatchExport `json:"export"`
}

type SettlementBatchRegistry struct {
	Batches    []SettlementBatch `json:"batches"`
	NextCursor string            `json:"nextCursor,omitempty"`
	Limit      int               `json:"limit"`
}

type SettlementBatchItem struct {
	PayoutID     string                   `json:"payoutId"`
	ActorType    string                   `json:"actorType"`
	ActorID      string                   `json:"actorId"`
	AmountMinor  int64                    `json:"amountMinor"`
	Currency     string                   `json:"currency"`
	PayoutStatus string                   `json:"payoutStatus"`
	Transfer     *ManualTransferExecution `json:"transfer,omitempty"`
}

type ManualTransferExecution struct {
	ID                   string  `json:"id"`
	BatchID              string  `json:"batchId"`
	PayoutID             string  `json:"payoutId"`
	ApprovedSnapshotHash string  `json:"approvedSnapshotHash"`
	ExecutedBy           string  `json:"executedBy"`
	ExecutedAt           string  `json:"executedAt"`
	ProviderKey          string  `json:"providerKey"`
	ExternalReference    string  `json:"externalTransferReference"`
	AmountMinor          int64   `json:"amountMinor"`
	Currency             string  `json:"currency"`
	DestinationID        string  `json:"destinationId"`
	DestinationVersion   int     `json:"destinationVersion"`
	ReceiptDocumentID    string  `json:"receiptDocumentId"`
	ExecutionStatus      string  `json:"executionStatus"`
	VerifiedBy           *string `json:"verifiedBy,omitempty"`
	VerifiedAt           *string `json:"verifiedAt,omitempty"`
	StatementRowID       *string `json:"statementRowId,omitempty"`
	ReconciledBy         *string `json:"reconciledBy,omitempty"`
	ReconciledAt         *string `json:"reconciledAt,omitempty"`
}

type FinanceEvidenceDocument struct {
	ID          string `json:"id"`
	Purpose     string `json:"purpose"`
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	SHA256      string `json:"sha256"`
	SizeBytes   int64  `json:"sizeBytes"`
	UploadedBy  string `json:"uploadedBy"`
	CreatedAt   string `json:"createdAt"`
}

type CustomerWithdrawalIntake struct {
	ID                         string     `json:"id"`
	CustomerActorID            string     `json:"customerActorId"`
	ProviderKey                string     `json:"providerKey"`
	WalletIdentifierMasked     string     `json:"walletIdentifierMasked"`
	BeneficiaryName            string     `json:"beneficiaryName"`
	BeneficiaryIdentityVersion int        `json:"beneficiaryIdentityVersion"`
	RequestReason              string     `json:"requestReason"`
	RequestEvidenceDocumentID  string     `json:"requestEvidenceDocumentId"`
	Status                     string     `json:"status"`
	DestinationID              *string    `json:"destinationId,omitempty"`
	PayoutID                   *string    `json:"payoutId,omitempty"`
	PayoutStatus               *string    `json:"payoutStatus,omitempty"`
	PayoutAmountMinor          *int64     `json:"payoutAmountMinor,omitempty"`
	PayoutCurrency             *string    `json:"payoutCurrency,omitempty"`
	RequestedBy                string     `json:"requestedBy"`
	RequestedAt                time.Time  `json:"requestedAt"`
	FinanceActorID             *string    `json:"financeActorId,omitempty"`
	ResolvedAt                 *time.Time `json:"resolvedAt,omitempty"`
	ResolutionReason           *string    `json:"resolutionReason,omitempty"`
}

type customerWithdrawalIntakeResponse struct {
	Intake CustomerWithdrawalIntake `json:"intake"`
}
type customerWithdrawalIntakeListResponse struct {
	Intakes    []CustomerWithdrawalIntakeSummary `json:"intakes"`
	NextCursor string                            `json:"nextCursor,omitempty"`
	Limit      int                               `json:"limit"`
}

type CustomerWithdrawalIntakeSummary struct {
	ID                            string    `json:"id"`
	CustomerActorID               string    `json:"customerActorId"`
	ProviderKey                   string    `json:"providerKey"`
	WalletIdentifierMasked        string    `json:"walletIdentifierMasked"`
	BeneficiaryName               string    `json:"beneficiaryName"`
	Status                        string    `json:"status"`
	DestinationID                 *string   `json:"destinationId,omitempty"`
	DestinationStatus             *string   `json:"destinationStatus,omitempty"`
	DestinationVerificationStatus *string   `json:"destinationVerificationStatus,omitempty"`
	PayoutID                      *string   `json:"payoutId,omitempty"`
	PayoutStatus                  *string   `json:"payoutStatus,omitempty"`
	PayoutAmountMinor             *int64    `json:"payoutAmountMinor,omitempty"`
	PayoutCurrency                *string   `json:"payoutCurrency,omitempty"`
	RequestedAt                   time.Time `json:"requestedAt"`
}

type CustomerWithdrawalIntakeList struct {
	Intakes    []CustomerWithdrawalIntakeSummary `json:"intakes"`
	NextCursor string                            `json:"nextCursor,omitempty"`
	Limit      int                               `json:"limit"`
}

type FinanceEvidenceFile struct {
	Filename    string
	ContentType string
	Content     []byte
}

type financeEvidenceDocumentResponse struct {
	Document FinanceEvidenceDocument `json:"document"`
}

type SettlementStatement struct {
	ID                 string  `json:"id"`
	BatchID            *string `json:"batchId,omitempty"`
	ProviderKey        string  `json:"providerKey"`
	Currency           string  `json:"currency"`
	PeriodStart        string  `json:"periodStart"`
	PeriodEnd          string  `json:"periodEnd"`
	EvidenceDocumentID string  `json:"evidenceDocumentId"`
	Filename           string  `json:"filename"`
	ArtifactSHA256     string  `json:"artifactSha256"`
	UploadedBy         string  `json:"uploadedBy"`
	CreatedAt          string  `json:"createdAt"`
}

type SettlementStatementRow struct {
	ID                        string  `json:"id"`
	StatementID               string  `json:"statementId"`
	RowSequence               int     `json:"rowSequence"`
	ExternalTransferReference string  `json:"externalTransferReference"`
	AmountMinor               int64   `json:"amountMinor"`
	Currency                  string  `json:"currency"`
	TransactionAt             string  `json:"transactionAt"`
	RecordedBy                string  `json:"recordedBy"`
	MatchedTransferID         *string `json:"matchedTransferId,omitempty"`
}

type settlementStatementResponse struct {
	Statement SettlementStatement `json:"statement"`
}
type settlementStatementRowResponse struct {
	Row SettlementStatementRow `json:"row"`
}

type PayoutState struct {
	ActorType              string                     `json:"actorType"`
	ActorID                string                     `json:"actorId"`
	Currency               string                     `json:"currency"`
	EligibleAvailableMinor int64                      `json:"eligibleAvailableMinor"`
	HeldMinor              int64                      `json:"heldMinor"`
	AcquiredStoreCount     *int64                     `json:"acquiredStoreCount,omitempty"`
	EarnedMinor            *int64                     `json:"earnedMinor,omitempty"`
	Destination            *OfficialWalletDestination `json:"destination"`
	LatestPayout           *PayoutRequest             `json:"latestPayout"`
}

type PayoutStateRegistry struct {
	Beneficiaries []PayoutState `json:"beneficiaries"`
	NextCursor    string        `json:"nextCursor,omitempty"`
	Limit         int           `json:"limit"`
}

type FieldFinanceSummary struct {
	Currency               string `json:"currency"`
	FieldActorCount        int64  `json:"fieldActorCount"`
	AcquiredStoreCount     int64  `json:"acquiredStoreCount"`
	EarnedMinor            int64  `json:"earnedMinor"`
	EligibleAvailableMinor int64  `json:"eligibleAvailableMinor"`
	HeldMinor              int64  `json:"heldMinor"`
	PayoutRequestCount     int64  `json:"payoutRequestCount"`
	ActiveDestinationCount int64  `json:"activeDestinationCount"`
}

type FieldPayoutStatesBatch struct {
	Beneficiaries       []PayoutState       `json:"beneficiaries"`
	FieldFinanceSummary FieldFinanceSummary `json:"fieldFinanceSummary"`
}
