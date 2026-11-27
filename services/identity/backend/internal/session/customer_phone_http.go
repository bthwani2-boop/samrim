package session

import (
	"context"
	"encoding/hex"
	"encoding/json"
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
	smtp   string
	phones map[string]struct{}
}

// NewCustomerPhoneHandler admits only the isolated synthetic phone owner.
// Neither the recipient nor the transport destination is supplied by callers.
func NewCustomerPhoneHandler(owner *PostgresReader, keyHex, address string, containerMode bool, approvedPhones string) (http.Handler, error) {
	key, err := hex.DecodeString(keyHex)
	host, port, addrErr := net.SplitHostPort(address)
	if owner == nil || err != nil || len(key) != 32 || addrErr != nil || port == "" ||
		!(host == "127.0.0.1" || (containerMode && host == "mailpit" && port == "1025")) {
		return nil, errors.New("invalid isolated phone verification configuration")
	}
	phones := make(map[string]struct{})
	for _, value := range strings.Split(approvedPhones, ",") {
		phone := strings.TrimSpace(value)
		if !syntheticPhone.MatchString(phone) {
			return nil, errors.New("invalid isolated Yemeni phone allowlist")
		}
		phones[phone] = struct{}{}
	}
	return &customerPhoneHandler{owner: owner, key: key, smtp: address, phones: phones}, nil
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
	if errors.Is(err, errPhoneLimit) {
		phoneError(w, http.StatusTooManyRequests, "PHONE_CHALLENGE_LIMIT")
		return
	}
	if err != nil {
		phoneError(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
		return
	}

	// A cancelled or ambiguous delivery must never release the ticket.
	// Cleanup has an independent bounded lifetime and keeps the send counter.
	if err := deliverPhoneCode(ctx, h.smtp, input.Phone, code); err != nil || ctx.Err() != nil {
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
	if errors.Is(err, ErrUnauthorized) {
		phoneError(w, http.StatusUnauthorized, "UNAUTHORIZED")
		return
	}
	if err != nil {
		phoneError(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
		return
	}
	respond(w, http.StatusOK, issued)
}

// deliverPhoneCode owns the complete lifetime of one isolated SMTP exchange.
// Dial cancellation alone does not interrupt a connected socket. Bind the
// connection to the context until DATA acknowledgement, including all reads.
func deliverPhoneCode(ctx context.Context, address, phone, code string) error {
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

	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", address)
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
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	client, err := smtp.NewClient(conn, host)
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
	// Reconstruct both values from integers, never from request text.
	if _, err := fmt.Fprintf(payload, "From: %s\r\nTo: %s\r\nSubject: BThwani synthetic phone verification\r\n\r\nPhone: +967%09d\r\nCode: %06d\r\n", sender, inbox, phoneSuffix, verificationCode); err != nil {
		return err
	}
	if err := payload.Close(); err != nil {
		return err
	}
	return ctx.Err()
}
