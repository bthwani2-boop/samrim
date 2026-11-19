package session

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func verifyPhoneAdmissionIntegration(t *testing.T, ctx context.Context, independent *sql.DB,
	owner *PostgresReader, schema string, exec func(string, ...any)) {
	t.Helper()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	const phone = "+12025550132"
	ticket, code, err := owner.issuePhoneChallenge(ctx, key, phone)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = owner.issuePhoneChallenge(ctx, key, phone); !errors.Is(err, errPhoneLimit) {
		t.Fatal("phone cooldown did not reject:", err)
	}
	badCode := "000000"
	if code == badCode {
		badCode = "000001"
	}
	if _, err = owner.verifyPhoneChallenge(ctx, key, ticket, badCode); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("incorrect proof did not reject:", err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 12)
	for range cap(results) {
		wg.Go(func() {
			_, err := owner.verifyPhoneChallenge(ctx, key, ticket, code)
			results <- err
		})
	}
	wg.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		} else if !errors.Is(err, ErrUnauthorized) {
			t.Fatal(err)
		}
	}
	if winners != 1 {
		t.Fatalf("one phone proof must issue one Customer credential: got %d", winners)
	}
	var actor string
	var sessions, attempts int
	if err = independent.QueryRowContext(ctx, "SELECT id FROM "+schema+".actors WHERE verified_phone=$1 AND verified_at IS NOT NULL", phone).Scan(&actor); err != nil {
		t.Fatal("verified actor missing in durable readback:", err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".auth_sessions WHERE actor_id=$1 AND role='customer'", actor).Scan(&sessions); err != nil || sessions != 1 {
		t.Fatalf("unexpected durable session count %d: %v", sessions, err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT attempts FROM "+schema+".customer_phone_challenges WHERE phone=$1 AND consumed", phone).Scan(&attempts); err != nil || attempts != 2 {
		t.Fatalf("unexpected durable attempt count %d: %v", attempts, err)
	}

	exec("UPDATE "+schema+".customer_phone_challenges SET issued_at=clock_timestamp()-interval '2 minutes' WHERE phone=$1", phone)
	reentry, reentryCode, err := owner.issuePhoneChallenge(ctx, key, phone)
	if err != nil {
		t.Fatal(err)
	}
	issued, err := owner.verifyPhoneChallenge(ctx, key, reentry, reentryCode)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := NewPostgresReader(independent, schema)
	if err != nil {
		t.Fatal(err)
	}
	principal, err := NewVerifier(reader).Verify(ctx, "Bearer "+issued.AccessToken)
	if err != nil || principal.ActorID != actor || principal.Role != "customer" {
		t.Fatal("repeat phone proof selected a different actor or role")
	}

	exec("UPDATE "+schema+".actor_roles SET status='SUSPENDED' WHERE actor_id=$1 AND role='customer'", actor)
	exec("UPDATE "+schema+".customer_phone_challenges SET issued_at=clock_timestamp()-interval '2 minutes' WHERE phone=$1", phone)
	suspended, suspendedCode, err := owner.issuePhoneChallenge(ctx, key, phone)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = owner.verifyPhoneChallenge(ctx, key, suspended, suspendedCode); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("suspended Customer regained a session:", err)
	}
	// An SMTP error occurs after the challenge was committed but before its
	// ticket was returned. The unknown-delivery ticket must be unusable, and
	// the caller must be able to retry promptly without evading send limits.
	const undeliveredPhone = "+12025550133"
	failedTicket, failedCode, err := owner.issuePhoneChallenge(ctx, key, undeliveredPhone)
	if err != nil {
		t.Fatal(err)
	}
	if err = owner.cancelUndeliveredPhoneChallenge(ctx, failedTicket); err != nil {
		t.Fatal("failed SMTP delivery could not invalidate its ticket:", err)
	}
	if _, err = owner.verifyPhoneChallenge(ctx, key, failedTicket, failedCode); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("undelivered challenge was still usable:", err)
	}
	retryTicket, retryCode, err := owner.issuePhoneChallenge(ctx, key, undeliveredPhone)
	if err != nil {
		t.Fatal("failed delivery unnecessarily blocks a prompt bounded retry:", err)
	}
	if retryTicket == failedTicket {
		t.Fatal("retry unexpectedly reused an invalidated ticket")
	}
	// A delayed cleanup from the failed send must not cancel the newer ticket.
	if err = owner.cancelUndeliveredPhoneChallenge(ctx, failedTicket); err != nil {
		t.Fatal("late cleanup of old ticket failed:", err)
	}
	var sends int
	if err = independent.QueryRowContext(ctx, "SELECT sends FROM "+schema+".customer_phone_challenges WHERE phone=$1", undeliveredPhone).Scan(&sends); err != nil || sends != 2 {
		t.Fatalf("send-rate bound bypassed on delivery failure: sends=%d err=%v", sends, err)
	}
	if _, err = owner.verifyPhoneChallenge(ctx, key, retryTicket, retryCode); err != nil {
		t.Fatal("fresh delivered proof failed:", err)
	}

	// Exercise the HTTP transport as well, not just the SQL compensation
	// command. Delivery is forced to fail on an unused loopback SMTP port.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	deliveryTarget := listener.Addr().String()
	_ = listener.Close()
	handler, err := NewCustomerPhoneHandler(owner, hex.EncodeToString(key), deliveryTarget, false)
	if err != nil {
		t.Fatal(err)
	}
	const unavailablePhone = "+12025550134"
	req := httptest.NewRequest(http.MethodPost, PhoneChallengePath,
		strings.NewReader(`{"phone":"`+unavailablePhone+`"}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusServiceUnavailable ||
		strings.Contains(recorder.Body.String(), "ticket") ||
		strings.Contains(recorder.Body.String(), "accessToken") {
		t.Fatalf("SMTP delivery error revealed a usable proof or wrong status: %d %s", recorder.Code, recorder.Body.String())
	}
	var abandonedTicket string
	var abandonedConsumed bool
	var abandonedSends int
	if err = independent.QueryRowContext(ctx, "SELECT ticket,consumed,sends FROM "+schema+
		".customer_phone_challenges WHERE phone=$1", unavailablePhone).
		Scan(&abandonedTicket, &abandonedConsumed, &abandonedSends); err != nil ||
		!abandonedConsumed || abandonedSends != 1 {
		t.Fatalf("HTTP SMTP failure did not persist invalidation or bounded send: consumed=%t sends=%d err=%v",
			abandonedConsumed, abandonedSends, err)
	}
	if _, _, err = owner.issuePhoneChallenge(ctx, key, unavailablePhone); err != nil {
		t.Fatal("failed HTTP delivery prevented prompt retry:", err)
	}
	t.Log("IDENTITY_PHONE_ADMISSION_DURABLE_RACE_PASS")
}
