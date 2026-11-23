package wallet

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// VerifySandboxProviderFunding confirms a synthetic provider record before
// invoking WLT's existing immutable, idempotent sandbox journal posting.
// This route is development-only: it must never become an external rail adapter.
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
	// Revalidate Identity at the write boundary and immediately before commit.
	// The sandbox SQL function, not this provider response, owns persistence.
	return PostSandboxFunding(ctx, db, identityOrigin, token, reference, amount)
}

type sandboxProviderEvidence struct {
	Reference string `json:"reference"`
	ActorID   string `json:"actorId"`
	AmountYer string `json:"amountYer"`
	Currency  string `json:"currency"`
	Status    string `json:"status"`
}

func validSandboxProviderOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.User != nil ||
		u.Port() == "" || u.Path != "" || u.RawPath != "" || u.RawQuery != "" ||
		u.Fragment != "" || u.Opaque != "" || u.ForceQuery || u.String() != origin {
		return false
	}
	port, err := strconv.ParseUint(u.Port(), 10, 16)
	return err == nil && port > 0
}

func verifySandboxProviderEvidence(ctx context.Context, origin, reference, actor string, amount int64) error {
	if !validSandboxProviderOrigin(origin) || !sandboxReference.MatchString(reference) {
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
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return errors.New("invalid sandbox provider evidence")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1025))
	if err != nil || len(raw) > 1024 {
		return errors.New("invalid sandbox provider evidence")
	}
	var evidence sandboxProviderEvidence
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&evidence); err != nil {
		return errors.New("invalid sandbox provider evidence")
	}
	if err = decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
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
