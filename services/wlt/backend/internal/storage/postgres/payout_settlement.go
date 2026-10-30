package postgres

import (
	"errors"
	"time"
)

var (
	ErrPayoutNotFound           = errors.New("payout request was not found")
	ErrPayoutState              = errors.New("payout request state does not allow this operation")
	ErrPayoutApprovalSeparation = errors.New("payout approval must be performed by a different operator")
	ErrSettlementBatchNotFound  = errors.New("settlement batch was not found")
	ErrSettlementBatchState     = errors.New("settlement batch state does not allow this operation")
	ErrSettlementBatchInput     = errors.New("settlement batch input is invalid")
	ErrTransferNotFound         = errors.New("manual transfer execution was not found")
	ErrTransferState            = errors.New("manual transfer state does not allow this operation")
	ErrTransferSeparation       = errors.New("transfer verification must be performed by a different operator")
)

type PayoutSnapshotRecord struct {
	PayoutID                   string
	ActorType                  string
	ActorID                    string
	BeneficiaryName            string
	BeneficiaryIdentityVersion int
	ProviderKey                string
	MaskedDestination          string
	DestinationID              string
	DestinationVersion         int
	AmountMode                 string
	ResolvedAmountMinor        int64
	Currency                   string
	PolicyVersion              string
	SnapshotHash               string
	PreparedBy                 string
	PreparedAt                 time.Time
	ApprovedBy                 *string
	ApprovedAt                 *time.Time
	IdentityActorVersion       int
	IdentityRoleVersion        int
	RoleEnabled                bool
	SecurityEnabled            bool
	OfficialNameStatus         string
	IdentitySnapshotKnown      bool
}

type SettlementBatchRecord struct {
	ID               string
	ProviderKey      string
	Currency         string
	Status           string
	RowCount         int
	TotalAmountMinor int64
	CreatedBy        string
	CreatedAt        time.Time
	ApprovedBy       *string
	ApprovedAt       *time.Time
	FrozenBy         *string
	FrozenAt         *time.Time
	BatchHash        string
	Items            []SettlementBatchItemRecord
}

type SettlementBatchItemRecord struct {
	PayoutID     string
	ActorType    string
	ActorID      string
	AmountMinor  int64
	Currency     string
	PayoutStatus string
	Transfer     *ManualTransferExecutionRecord
}

type ManualTransferExecutionRecord struct {
	ID                   string
	BatchID              string
	PayoutID             string
	ApprovedSnapshotHash string
	ExecutedBy           string
	ExecutedAt           time.Time
	ProviderKey          string
	ExternalReference    string
	AmountMinor          int64
	Currency             string
	DestinationID        string
	DestinationVersion   int
	ReceiptDocumentID    string
	ExecutionStatus      string
	VerifiedBy           *string
	VerifiedAt           *time.Time
	StatementRowID       *string
	ReconciledBy         *string
	ReconciledAt         *time.Time
}

type PreparePayoutInput struct {
	PayoutID       string
	ActorID        string
	Reason         string
	Evidence       string
	IdentityFacts  IdentityFacts
	IdempotencyKey string
	CorrelationID  string
}

type ApprovePayoutInput struct {
	PayoutID       string
	ActorID        string
	Reason         string
	IdentityFacts  IdentityFacts
	IdempotencyKey string
	CorrelationID  string
}

type CancelPayoutInput struct {
	PayoutID       string
	ActorID        string
	Reason         string
	IdempotencyKey string
	CorrelationID  string
}

type CreateSettlementBatchInput struct {
	PayoutIDs                  []string
	ActorID                    string
	IdentityFactsByBeneficiary []IdentityFacts
	DestinationCipher          *DestinationCipher
	IdempotencyKey             string
	CorrelationID              string
}

type BatchActionInput struct {
	BatchID                    string
	ActorID                    string
	Reason                     string
	IdentityFactsByBeneficiary []IdentityFacts
	DestinationCipher          *DestinationCipher
	IdempotencyKey             string
	CorrelationID              string
}

type RecordTransferInput struct {
	BatchID           string
	PayoutID          string
	ActorID           string
	ExternalReference string
	ReceiptDocumentID string
	IdempotencyKey    string
	CorrelationID     string
}

type VerifyTransferInput struct {
	TransferID     string
	ActorID        string
	IdempotencyKey string
	CorrelationID  string
}

type ReconcileTransferInput struct {
	TransferID     string
	StatementRowID string
	ActorID        string
	IdempotencyKey string
	CorrelationID  string
}

type SettlementStatementInput struct {
	BatchID            string
	ProviderKey        string
	Currency           string
	PeriodStart        time.Time
	PeriodEnd          time.Time
	EvidenceDocumentID string
	ActorID            string
	IdempotencyKey     string
	CorrelationID      string
}

type SettlementStatementRecord struct {
	ID                 string
	BatchID            *string
	ProviderKey        string
	Currency           string
	PeriodStart        time.Time
	PeriodEnd          time.Time
	EvidenceDocumentID string
	Filename           string
	ArtifactSHA256     string
	UploadedBy         string
	CreatedAt          time.Time
}

type SettlementStatementRowInput struct {
	StatementID       string
	RowSequence       int
	ExternalReference string
	WalletIdentifier  string
	AmountMinor       int64
	Currency          string
	TransactionAt     time.Time
	ActorID           string
	IdempotencyKey    string
	CorrelationID     string
}

type SettlementStatementRowRecord struct {
	ID                string
	StatementID       string
	RowSequence       int
	ExternalReference string
	AmountMinor       int64
	Currency          string
	TransactionAt     time.Time
	RecordedBy        string
	MatchedTransferID *string
}
