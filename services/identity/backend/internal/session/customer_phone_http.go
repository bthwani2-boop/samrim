package session

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

const (
	PhoneChallengePath = "/v1/customer-auth/phone-challenges"
	PhoneVerifyPath    = "/v1/customer-auth/phone-verification"
)

type customerPhoneHandler struct {
	owner  *PostgresReader
	key    []byte
	smtp   *phoneSMTP
	phones map[string]struct{}
}

// NewCustomerPhoneHandler admits only isolated synthetic phone verification.
// Destination, dedicated trust roots and recipient are never caller-controlled.
func NewCustomerPhoneHandler(owner *PostgresReader, keyHex, address string, containerMode bool, approvedPhones string, caPEM []byte) (http.Handler, error) {
	key, err := hex.DecodeString(keyHex)
	if owner == nil || err != nil || len(key) != 32 {
		return nil, errors.New("invalid isolated phone verification configuration")
	}
	delivery, err := newPhoneSMTP(address, containerMode, caPEM)
	if err != nil {
		return nil, err
	}
	phones := make(map[string]struct{})
	for _, value := range strings.Split(approvedPhones, ",") {
		phone := strings.TrimSpace(value)
		if !syntheticPhone.MatchString(phone) {
			return nil, errors.New("invalid isolated Yemeni phone allowlist")
		}
		phones[phone] = struct{}{}
	}
	return &customerPhoneHandler{owner: owner, key: key, smtp: delivery, phones: phones}, nil
}

func phoneError(w http.ResponseWriter, status int, code string) {
	respond(w, status, map[string]string{"error": code})
}

func (h *customerPhoneHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	w.Header().Set("Allow", "POST")
	if r.Method != http.MethodPost {
		phoneError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
		return
	}
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType != "application/json" || r.URL.RawQuery != "" {
		phoneError(w, http.StatusBadRequest, "INVALID_REQUEST")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512))
	decoder.DisallowUnknownFields()
	switch r.URL.Path {
	case PhoneChallengePath:
		h.challenge(ctx, w, decoder)
	case PhoneVerifyPath:
		h.verify(ctx, w, decoder)
	default:
		phoneError(w, http.StatusNotFound, "NOT_FOUND")
	}
}

func (h *customerPhoneHandler) challenge(ctx context.Context, w http.ResponseWriter, decoder *json.Decoder) {
	var input struct {
		Phone string `json:"phone"`
	}
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF {
		phoneError(w, http.StatusBadRequest, "INVALID_REQUEST")
		return
	}
	if _, allowed := h.phones[input.Phone]; !allowed {
		phoneError(w, http.StatusBadRequest, "INVALID_REQUEST")
		return
	}
	ticket, code, err := h.owner.issuePhoneChallenge(ctx, h.key, input.Phone)
	switch {
	case errors.Is(err, errPhoneLimit):
		phoneError(w, http.StatusTooManyRequests, "PHONE_CHALLENGE_LIMIT")
		return
	case err != nil:
		phoneError(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
		return
	}

	// Never release a challenge ticket without authenticated delivery and a
	// live request. Compensation retains the send count and has its own bound.
	if err := h.smtp.deliver(ctx, input.Phone, code); err != nil || ctx.Err() != nil {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = h.owner.cancelUndeliveredPhoneChallenge(cleanupCtx, ticket)
		phoneError(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
		return
	}
	respond(w, http.StatusCreated, map[string]string{"ticket": ticket})
}

func (h *customerPhoneHandler) verify(ctx context.Context, w http.ResponseWriter, decoder *json.Decoder) {
	var input struct {
		Ticket string `json:"ticket"`
		Code   string `json:"code"`
	}
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF ||
		!phoneTicket.MatchString(input.Ticket) || !phoneCode.MatchString(input.Code) {
		phoneError(w, http.StatusBadRequest, "INVALID_REQUEST")
		return
	}
	issued, err := h.owner.verifyPhoneChallenge(ctx, h.key, input.Ticket, input.Code)
	switch {
	case errors.Is(err, ErrUnauthorized):
		phoneError(w, http.StatusUnauthorized, "UNAUTHORIZED")
	case err != nil:
		phoneError(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
	default:
		respond(w, http.StatusOK, issued)
	}
}

// phoneSMTP owns destination admission and the complete authenticated exchange.
// The same implicit TLS protocol is mandatory for the container and loopback.
type phoneSMTP struct {
	address string
	tls     *tls.Config
}

func newPhoneSMTP(address string, containerMode bool, caPEM []byte) (*phoneSMTP, error) {
	host, port, err := net.SplitHostPort(address)
	number, portErr := strconv.ParseUint(port, 10, 16)
	if err != nil || portErr != nil || number == 0 ||
		!(host == "127.0.0.1" || (containerMode && address == "mailpit:1025")) {
		return nil, errors.New("invalid isolated phone SMTP destination")
	}

	// Only the explicitly provisioned CA bundle is trusted. Never inherit
	// machine roots or silently accept a leaf certificate as a trust anchor.
	roots := x509.NewCertPool()
	rest := bytes.TrimSpace(caPEM)
	count := 0
	for len(rest) != 0 {
		if !bytes.HasPrefix(rest, []byte("-----BEGIN CERTIFICATE-----")) {
			return nil, errors.New("invalid isolated phone SMTP trust anchor")
		}
		block, next := pem.Decode(rest)
		if block == nil || block.Type != "CERTIFICATE" || len(block.Headers) != 0 {
			return nil, errors.New("invalid isolated phone SMTP trust anchor")
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil || !cert.BasicConstraintsValid || !cert.IsCA ||
			(cert.KeyUsage != 0 && cert.KeyUsage&x509.KeyUsageCertSign == 0) {
			return nil, errors.New("invalid isolated phone SMTP trust anchor")
		}
		roots.AddCert(cert)
		count++
		rest = bytes.TrimSpace(next)
	}
	if count == 0 {
		return nil, errors.New("missing isolated phone SMTP trust anchor")
	}
	return &phoneSMTP{address: address, tls: &tls.Config{
		MinVersion: tls.VersionTLS12,
		ServerName: host,
		RootCAs:    roots,
	}}, nil
}

func (s *phoneSMTP) deliver(ctx context.Context, phone, code string) error {
	if !syntheticPhone.MatchString(phone) || !phoneCode.MatchString(code) {
		return errors.New("invalid synthetic phone verification payload")
	}
	phoneSuffix, err := strconv.ParseUint(phone[4:], 10, 32)
	if err != nil {
		return errors.New("invalid synthetic phone verification payload")
	}
	verificationCode, err := strconv.ParseUint(code, 10, 32)
	if err != nil {
		return errors.New("invalid synthetic phone verification payload")
	}

	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", s.address)
	if err != nil {
		return err
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	if deadline, ok := ctx.Deadline(); ok {
		if err := conn.SetDeadline(deadline); err != nil {
			return err
		}
	}

	// Authenticate the peer before any SMTP command or verification payload.
	// No STARTTLS negotiation, downgrade, plaintext fallback or retry exists.
	secured := tls.Client(conn, s.tls)
	if err := secured.HandshakeContext(ctx); err != nil {
		return err
	}
	client, err := smtp.NewClient(secured, s.tls.ServerName)
	if err != nil {
		return err
	}
	defer client.Close()
	const sender, inbox = "identity@identity.test", "verification@identity.test"
	if err := client.Mail(sender); err != nil {
		return err
	}
	if err := client.Rcpt(inbox); err != nil {
		return err
	}
	payload, err := client.Data()
	if err != nil {
		return err
	}
	// Reconstruct values from integers, never from untrusted header text.
	if _, err := fmt.Fprintf(payload, "From: %s\r\nTo: %s\r\nSubject: BThwani synthetic phone verification\r\n\r\nPhone: +967%09d\r\nCode: %06d\r\n", sender, inbox, phoneSuffix, verificationCode); err != nil {
		return err
	}
	if err := payload.Close(); err != nil {
		return err
	}
	return ctx.Err()
}
