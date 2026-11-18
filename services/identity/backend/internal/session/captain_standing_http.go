package session

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var (
	ErrCaptainStandingNotApproved      = errors.New("captain standing not approved by DSH")
	ErrCaptainStandingOwnerUnavailable = errors.New("current DSH standing unavailable")
)

type CaptainStandingVerifier interface {
	Approved(context.Context, string, string) error
}

type CaptainStandingHTTP struct {
	endpoint string
	client   *http.Client
}

func NewCaptainStandingHTTP(base string) (*CaptainStandingHTTP, error) {
	root, err := url.Parse(base)
	if err != nil || root.Host == "" || root.User != nil || root.Opaque != "" ||
		root.Fragment != "" || root.RawQuery != "" || (root.Path != "" && root.Path != "/") ||
		(root.Scheme != "https" && !(root.Scheme == "http" &&
			(root.Hostname() == "localhost" || root.Hostname() == "127.0.0.1"))) {
		return nil, errors.New("unsafe DSH Captain standing origin")
	}
	root.Path = "/v1/actors/me/captain-eligibility"
	return &CaptainStandingHTTP{endpoint: root.String(), client: &http.Client{
		Timeout:       3 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

// Approved compares the current DSH owner decision with the exact Identity
// actor locked by the admission transaction; no client-supplied ID is trusted.
func (s *CaptainStandingHTTP) Approved(ctx context.Context, bearer, actorID string) error {
	if s == nil || s.client == nil || bearer == "" || strings.TrimSpace(bearer) != bearer ||
		strings.ContainsAny(bearer, "\r\n\t ") || actorID == "" {
		return ErrCaptainStandingNotApproved
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.endpoint, nil)
	if err != nil {
		return ErrCaptainStandingNotApproved
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cache-Control", "no-store")
	resp, err := s.client.Do(req)
	if err != nil {
		return ErrCaptainStandingNotApproved
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotFound {
			return ErrCaptainStandingNotApproved
		}
		return ErrCaptainStandingOwnerUnavailable
	}
	media, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return ErrCaptainStandingNotApproved
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4097))
	if err != nil || len(raw) > 4096 {
		return ErrCaptainStandingNotApproved
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var body struct {
		ActorID string `json:"actorId"`
		Status  string `json:"status"`
		Version int64  `json:"version"`
	}
	if decoder.Decode(&body) != nil || decoder.Decode(new(any)) != io.EOF ||
		body.ActorID != actorID || body.Status != "APPROVED" || body.Version < 1 {
		return ErrCaptainStandingNotApproved
	}
	return nil
}
