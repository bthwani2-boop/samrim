package session

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
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
	t.Log("IDENTITY_PHONE_ADMISSION_DURABLE_RACE_PASS")
}
