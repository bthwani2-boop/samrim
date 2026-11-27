package wallet

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"time"
)

// VerifySandboxProviderFunding confirms a synthetic provider record before
// invoking WLT's immutable idempotent sandbox journal posting. It never
// admits an external payment rail.
func VerifySandboxProviderFunding(ctx context.Context, db *sql.DB, identityOrigin, providerOrigin, token, reference string, amount int64) (string, error) {
	if amount < 1 || !sandboxReference.MatchString(reference) || !validBearer("Bearer "+token) {
		return "", errors.New("invalid sandbox provider funding input")
	}
	reader, err := newIdentityReader(identityOrigin)
	if err != nil {
		return "", err
	}
	actor, status := reader.read(ctx, "Bearer "+token)
	if status != http.StatusOK {
		return "", errors.New("sandbox provider funding requires a current Customer session")
	}
	if err := verifySandboxProviderEvidence(ctx, providerOrigin, reference, actor.ActorID, amount); err != nil {
		return "", err
	}
	// Identity is revalidated before the existing sandbox posting and commit.
	return writeSandboxFunding(ctx, db, identityOrigin, token, reference, actor.ActorID, sandboxPosting, amount)
}

type sandboxProviderEvidence struct {
	Reference string `json:"reference"`
	ActorID   string `json:"actorId"`
	AmountYer string `json:"amountYer"`
	Currency  string `json:"currency"`
	Status    string `json:"status"`
}

var sandboxProviderClient = ownerHTTPClient(500*time.Millisecond, 1500*time.Millisecond, false)

func verifySandboxProviderEvidence(ctx context.Context, origin, reference, actor string, amount int64) error {
	if !validLoopbackOwnerOrigin(origin) || !sandboxReference.MatchString(reference) {
		return errors.New("sandbox provider requires explicit isolated loopback configuration")
	}
	var evidence sandboxProviderEvidence
	status, err := requestOwnerDocument(ctx, sandboxProviderClient, origin+"/sandbox/v1/funding/"+reference, "", &evidence, 1024)
	if err != nil || status != http.StatusOK {
		return errors.New("sandbox provider response unconfirmed; reconcile same reference")
	}
	if evidence.Reference != reference || evidence.ActorID != actor ||
		evidence.AmountYer != strconv.FormatInt(amount, 10) || evidence.Currency != "YER" {
		return errors.New("sandbox provider evidence does not match the authorized funding")
	}
	switch evidence.Status {
	case "SUCCEEDED":
		return nil
	case "FAILED", "PENDING":
		return errors.New("sandbox provider funding not confirmed; no credit posted")
	default:
		return errors.New("sandbox provider status unrecognized; no credit posted")
	}
}
