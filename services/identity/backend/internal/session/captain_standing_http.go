package session

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	json "encoding/json/v2"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"strconv"
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

// The local integration constructor admits only an explicit loopback origin.
func NewCaptainStandingHTTP(base string) (*CaptainStandingHTTP, error) {
	return newCaptainStandingHTTP(base, nil)
}

// Container admission binds the exact private DSH peer to its dedicated trust anchor.
func NewContainerCaptainStandingHTTP(base, caPath string) (*CaptainStandingHTTP, error) {
	if base != "https://dsh:3344" || caPath == "" {
		return nil, errors.New("Captain standing requires the isolated DSH TLS peer")
	}
	pem, err := os.ReadFile(caPath)
	if err != nil {
		return nil, errors.New("Captain standing trust anchor unavailable")
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(pem) {
		return nil, errors.New("Captain standing trust anchor invalid")
	}
	return newCaptainStandingHTTP(base, &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots})
}

func newCaptainStandingHTTP(base string, config *tls.Config) (*CaptainStandingHTTP, error) {
	root, err := url.Parse(base)
	if err != nil || root.Host == "" || root.User != nil || root.Opaque != "" || strings.ContainsAny(base, "?#") || root.RawPath != "" || (root.Path != "" && root.Path != "/") {
		return nil, errors.New("unsafe DSH Captain standing origin")
	}
	port, portErr := strconv.ParseUint(root.Port(), 10, 16)
	loopback := root.Hostname() == "127.0.0.1" || root.Hostname() == "localhost" || root.Hostname() == "::1"
	local := loopback && portErr == nil && port != 0 && ((root.Scheme == "http" && config == nil) || (root.Scheme == "https" && config != nil))
	container := base == "https://dsh:3344" && config != nil
	if !local && !container {
		return nil, errors.New("unsafe DSH Captain standing origin")
	}
	root.Path = "/v1/actors/me/captain-eligibility"
	// Never inherit ambient proxies or transparent decompression for a bearer read.
	transport := &http.Transport{TLSClientConfig: config, DisableCompression: true}
	return &CaptainStandingHTTP{endpoint: root.String(), client: &http.Client{
		Transport: transport, Timeout: 3 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

// Approved accepts only the exact current, uncached DSH owner document for the
// Identity actor. It does not confer authority from a caller-provided role.
func (s *CaptainStandingHTTP) Approved(ctx context.Context, bearer, actorID string) error {
	if s == nil || s.client == nil || bearer == "" || strings.TrimSpace(bearer) != bearer || strings.ContainsAny(bearer, "\r\n\t ") || actorID == "" {
		return ErrCaptainStandingNotApproved
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.endpoint, nil)
	if err != nil {
		return ErrCaptainStandingOwnerUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("Cache-Control", "no-store")
	resp, err := s.client.Do(req)
	if err != nil {
		return ErrCaptainStandingOwnerUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotFound {
			return ErrCaptainStandingNotApproved
		}
		return ErrCaptainStandingOwnerUnavailable
	}
	const limit int64 = 4096
	length := resp.ContentLength
	media := resp.Header.Values("Content-Type")
	cache := resp.Header.Values("Cache-Control")
	if resp.Uncompressed || length < -1 || length == 0 || length > limit ||
		(len(resp.TransferEncoding) != 0 && (len(resp.TransferEncoding) != 1 || resp.TransferEncoding[0] != "chunked" || length != -1)) ||
		len(media) != 1 || len(cache) != 1 || !strings.EqualFold(strings.TrimSpace(cache[0]), "no-store") || len(resp.Header.Values("Content-Encoding")) != 0 {
		return ErrCaptainStandingNotApproved
	}
	kind, params, err := mime.ParseMediaType(media[0])
	if err != nil || kind != "application/json" {
		return ErrCaptainStandingNotApproved
	}
	for key, value := range params {
		if key != "charset" || !strings.EqualFold(value, "utf-8") {
			return ErrCaptainStandingNotApproved
		}
	}
	ceiling := limit
	if length >= 0 {
		ceiling = length
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, ceiling+1))
	if err != nil || ctx.Err() != nil {
		return ErrCaptainStandingOwnerUnavailable
	}
	if int64(len(raw)) > ceiling || (length >= 0 && int64(len(raw)) != length) {
		return ErrCaptainStandingNotApproved
	}
	// Read through EOF before admitting the response. RFC 9110 section 6.5.1
	// forbids late fields from redefining the response controls or content
	// format on which an authorization decision depends.
	for _, field := range []string{"Cache-Control", "Content-Type", "Content-Encoding"} {
		if _, present := resp.Trailer[field]; present {
			return ErrCaptainStandingNotApproved
		}
	}
	// Go JSON v2 rejects duplicate names, malformed Unicode, nonexact member
	// spelling and trailing data. The contract's required nonzero values also
	// reject missing and null members without a second parser.
	var body struct {
		ActorID string `json:"actorId"`
		Status  string `json:"status"`
		Version int64  `json:"version"`
	}
	if json.Unmarshal(raw, &body, json.RejectUnknownMembers(true)) != nil || body.ActorID != actorID || body.Status != "APPROVED" || body.Version < 1 {
		return ErrCaptainStandingNotApproved
	}
	return nil
}
