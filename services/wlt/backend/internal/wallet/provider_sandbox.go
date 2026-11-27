package wallet

import (
	"context"
	"database/sql"
	"errors"
	"net"
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

func verifySandboxProviderEvidence(ctx context.Context, origin, reference, actor string, amount int64) error {
	if !validLoopbackOwnerOrigin(origin) || !sandboxReference.MatchString(reference) {
		return errors.New("sandbox provider requires explicit isolated loopback configuration")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/sandbox/v1/funding/"+reference, nil)
	if err != nil {
		return errors.New("invalid sandbox provider request")
	}
	client := &http.Client{
		Timeout: 1500 * time.Millisecond,
		Transport: &http.Transport{
			Proxy:             nil,
			DialContext:       (&net.Dialer{Timeout: 500 * time.Millisecond}).DialContext,
			DisableKeepAlives: true,
		},
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
	response, err := client.Do(request)
	if err != nil {
		return errors.New("sandbox provider response unconfirmed; reconcile same reference")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.ContentLength > 1024 {
		return errors.New("sandbox provider response unconfirmed; reconcile same reference")
	}
	var evidence sandboxProviderEvidence
	if err := decodeBoundedOwnerReply(response, &evidence, 1024); err != nil {
		return errors.New("invalid sandbox provider evidence")
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
