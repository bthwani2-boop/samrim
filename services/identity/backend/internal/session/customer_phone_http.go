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
	"time"
)

const (
	PhoneChallengePath = "/v1/customer-auth/phone-challenges"
	PhoneVerifyPath    = "/v1/customer-auth/phone-verification"
)

type customerPhoneHandler struct {
	owner *PostgresReader
	key   []byte
	smtp  string
}

// This delivery adapter is available only to Identity's isolated development
// binary. It sends proof for reserved fictional numbers to the Mailpit inbox.
func NewCustomerPhoneHandler(owner *PostgresReader, keyHex, address string, containerMode bool) (http.Handler, error) {
	key, err := hex.DecodeString(keyHex)
	host, port, addrErr := net.SplitHostPort(address)
	if owner == nil || err != nil || len(key) != 32 || addrErr != nil || port == "" ||
		!(host == "127.0.0.1" || (containerMode && host == "mailpit" && port == "1025")) {
		return nil, errors.New("invalid isolated phone verification configuration")
	}
	return &customerPhoneHandler{owner: owner, key: key, smtp: address}, nil
}

func (h *customerPhoneHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	w.Header().Set("Allow", "POST")
	if r.Method != http.MethodPost {
		respond(w, http.StatusMethodNotAllowed, map[string]string{"error": "METHOD_NOT_ALLOWED"})
		return
	}
	invalid := func() {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
	}
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType != "application/json" || r.URL.RawQuery != "" {
		invalid()
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512))
	decoder.DisallowUnknownFields()
	switch r.URL.Path {
	case PhoneChallengePath:
		var input struct {
			Phone string `json:"phone"`
		}
		if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || !syntheticPhone.MatchString(input.Phone) {
			invalid()
			return
		}
		ticket, code, err := h.owner.issuePhoneChallenge(ctx, h.key, input.Phone)
		if errors.Is(err, errPhoneLimit) {
			respond(w, http.StatusTooManyRequests, map[string]string{"error": "PHONE_CHALLENGE_LIMIT"})
			return
		}
		if err == nil {
			err = deliverPhoneCode(ctx, h.smtp, input.Phone, code)
			if err != nil {
				// SMTP acceptance may be unknown after a timeout. The client never
				// received this ticket, so invalidate it even if the request was
				// cancelled. Preserve the durable send counter for abuse limits.
				cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Second)
				_ = h.owner.cancelUndeliveredPhoneChallenge(cleanupCtx, ticket)
				cleanupCancel()
			}
		}
		if err == nil {
			respond(w, http.StatusCreated, map[string]string{"ticket": ticket})
			return
		}
	case PhoneVerifyPath:
		var input struct {
			Ticket string `json:"ticket"`
			Code   string `json:"code"`
		}
		if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF ||
			!phoneTicket.MatchString(input.Ticket) || !phoneCode.MatchString(input.Code) {
			invalid()
			return
		}
		issued, err := h.owner.verifyPhoneChallenge(ctx, h.key, input.Ticket, input.Code)
		if errors.Is(err, ErrUnauthorized) {
			respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
			return
		}
		if err == nil {
			respond(w, http.StatusOK, issued)
			return
		}
	default:
		respond(w, http.StatusNotFound, map[string]string{"error": "NOT_FOUND"})
		return
	}
	respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
}

func deliverPhoneCode(ctx context.Context, address, phone, code string) error {
	// Only numeric values reconstructed from the reserved synthetic formats
	// may reach SMTP DATA; no caller-controlled text is interpolated.
	if !syntheticPhone.MatchString(phone) || !phoneCode.MatchString(code) {
		return errors.New("invalid synthetic phone verification payload")
	}
	phoneSuffix, err := strconv.ParseUint(phone[len(phone)-2:], 10, 8)
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
	deadline, _ := ctx.Deadline()
	if err = conn.SetDeadline(deadline); err != nil {
		return err
	}
	host, _, _ := net.SplitHostPort(address)
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()
	const sender, inbox = "identity@identity.test", "verification@identity.test"
	if err = client.Mail(sender); err != nil {
		return err
	}
	if err = client.Rcpt(inbox); err != nil {
		return err
	}
	payload, err := client.Data()
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(payload, "From: %s\r\nTo: %s\r\nSubject: BThwani synthetic phone verification\r\n\r\nPhone: +120255501%02d\r\nCode: %06d\r\n", sender, inbox, phoneSuffix, verificationCode)
	if err != nil {
		return err
	}
	return payload.Close()
}
