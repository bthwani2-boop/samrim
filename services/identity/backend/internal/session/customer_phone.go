package session

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"regexp"
)

var (
	syntheticPhone = regexp.MustCompile(`^\+120255501[0-9]{2}$`)
	phoneTicket    = regexp.MustCompile(`^[a-f0-9]{48}$`)
	phoneCode      = regexp.MustCompile(`^[0-9]{6}$`)
	errPhoneLimit  = errors.New("phone challenge rate limited")
)

func digestPhoneCode(key []byte, ticket, code string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(ticket + ":" + code))
	return mac.Sum(nil)
}

func (r *PostgresReader) issuePhoneChallenge(ctx context.Context, key []byte, phone string) (string, string, error) {
	random := make([]byte, 24)
	if _, err := rand.Read(random); err != nil {
		return "", "", err
	}
	ticket := hex.EncodeToString(random)
	number, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", "", err
	}
	code := fmt.Sprintf("%06d", number.Int64())
	tx, err := r.begin(ctx, false)
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback()
	// One row per phone bounds generation across concurrent senders and
	// invalidates old tickets on resend. Use database time after contention.
	err = tx.QueryRowContext(ctx, `
		INSERT INTO customer_phone_challenges AS c
		  (phone,ticket,code_digest,window_started_at,sends,issued_at,expires_at)
		VALUES ($1,$2,$3,clock_timestamp(),1,clock_timestamp(),clock_timestamp()+interval '5 minutes')
		ON CONFLICT (phone) DO UPDATE SET
		  ticket=EXCLUDED.ticket, code_digest=EXCLUDED.code_digest,
		  window_started_at=CASE WHEN c.window_started_at<=clock_timestamp()-interval '15 minutes'
		    THEN clock_timestamp() ELSE c.window_started_at END,
		  sends=CASE WHEN c.window_started_at<=clock_timestamp()-interval '15 minutes' THEN 1 ELSE c.sends+1 END,
		  attempts=0, consumed=false, issued_at=clock_timestamp(), expires_at=clock_timestamp()+interval '5 minutes'
		WHERE c.issued_at<=clock_timestamp()-interval '1 minute'
		  AND (c.sends<3 OR c.window_started_at<=clock_timestamp()-interval '15 minutes')
		RETURNING ticket`, phone, ticket, digestPhoneCode(key, ticket, code)).Scan(&ticket)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", errPhoneLimit
	}
	if err != nil {
		return "", "", err
	}
	if err = tx.Commit(); err != nil {
		return "", "", err
	}
	return ticket, code, nil
}

// A delivery failure occurs after the durable challenge insert but before the
// caller receives the ticket. Invalidate that orphaned proof, permitting a
// prompt retry without refunding the send count or weakening rate limits.
// The ticket predicate prevents a delayed cleanup from cancelling a resend.
func (r *PostgresReader) cancelUndeliveredPhoneChallenge(ctx context.Context, ticket string) error {
	tx, err := r.begin(ctx, false)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `UPDATE customer_phone_challenges
		SET consumed=true, issued_at=clock_timestamp()-interval '2 minutes',
		    expires_at=clock_timestamp()
		WHERE ticket=$1 AND NOT consumed`, ticket)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresReader) verifyPhoneChallenge(ctx context.Context, key []byte, ticket, code string) (MerchantAdmission, error) {
	tx, err := r.begin(ctx, false)
	if err != nil {
		return MerchantAdmission{}, err
	}
	defer tx.Rollback()
	var phone string
	var digest []byte
	err = tx.QueryRowContext(ctx, `SELECT phone,code_digest FROM customer_phone_challenges
		WHERE ticket=$1 FOR UPDATE`, ticket).Scan(&phone, &digest)
	if errors.Is(err, sql.ErrNoRows) {
		return MerchantAdmission{}, ErrUnauthorized
	}
	if err != nil {
		return MerchantAdmission{}, err
	}
	valid := hmac.Equal(digest, digestPhoneCode(key, ticket, code))
	res, err := tx.ExecContext(ctx, `UPDATE customer_phone_challenges SET attempts=attempts+1,consumed=$2
		WHERE ticket=$1 AND NOT consumed AND attempts<5 AND expires_at>clock_timestamp()`, ticket, valid)
	if err != nil {
		return MerchantAdmission{}, err
	}
	count, err := res.RowsAffected()
	if err != nil {
		return MerchantAdmission{}, err
	}
	if count == 0 {
		return MerchantAdmission{}, ErrUnauthorized
	}
	if !valid {
		return commitPhoneDenial(tx)
	}

	// The verified phone is unique. Existing actors keep their ID and standing.
	// An actor with an old unbound record cannot be claimed by a caller-provided ID.
	var actorID string
	err = tx.QueryRowContext(ctx, `INSERT INTO actors(id,status,verified_phone,verified_at)
		VALUES (gen_random_uuid()::text,'ACTIVE',$1,clock_timestamp())
		ON CONFLICT (verified_phone) DO NOTHING RETURNING id`, phone).Scan(&actorID)
	if err == nil {
		_, err = tx.ExecContext(ctx, `INSERT INTO actor_roles(actor_id,role,status) VALUES ($1,'customer','ACTIVE')`, actorID)
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return MerchantAdmission{}, err
	}
	var actorVersion, roleVersion int64
	err = tx.QueryRowContext(ctx, `SELECT a.id,a.auth_version,r.version FROM actors a
		JOIN actor_roles r ON r.actor_id=a.id AND r.role='customer'
		WHERE a.verified_phone=$1 AND a.verified_at<=clock_timestamp()
		  AND a.status='ACTIVE' AND r.status='ACTIVE' FOR UPDATE OF a,r`, phone).
		Scan(&actorID, &actorVersion, &roleVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return commitPhoneDenial(tx)
	}
	if err != nil {
		return MerchantAdmission{}, err
	}
	var stillCurrent bool
	err = tx.QueryRowContext(ctx, `SELECT expires_at>clock_timestamp()
		FROM customer_phone_challenges WHERE ticket=$1`, ticket).Scan(&stillCurrent)
	if err != nil {
		return MerchantAdmission{}, err
	}
	if !stillCurrent {
		return MerchantAdmission{}, ErrUnauthorized
	}
	return issueRoleSessionTx(ctx, tx, actorID, "customer", actorVersion, roleVersion)
}

func commitPhoneDenial(tx *sql.Tx) (MerchantAdmission, error) {
	if err := tx.Commit(); err != nil {
		return MerchantAdmission{}, err
	}
	return MerchantAdmission{}, ErrUnauthorized
}
