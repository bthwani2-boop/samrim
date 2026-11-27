package wallet

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/lib/pq"
)

// MerchantDecision identifies exact immutable terms and an idempotent decision.
// Actor and Store relation are derived exclusively from the current owners.
type MerchantDecision struct {
	StoreID             string
	Version             int64
	ProposalOperationID string
	OperationID         string
	Decision            string
	Reason              string
}

var (
	ErrAgreementInvalid      = errors.New("invalid agreement decision")
	ErrAgreementUnauthorized = errors.New("current Merchant session required")
	ErrAgreementForbidden    = errors.New("current Store ownership and relation required")
	ErrAgreementConflict     = errors.New("agreement decision conflicts with recorded terms")
	ErrAgreementUnconfirmed  = errors.New("agreement decision unconfirmed; retry the same operation and payload")
	agreementOperationID     = regexp.MustCompile(`^[A-Za-z0-9._-]{8,128}$`)
)

// Only the admitted command principal may execute a review. This does not
// grant privileges or activate the serving reader.
const agreementCommandAdmissionSQL = `
WITH owner_schema AS (
 SELECT oid,nspowner FROM pg_catalog.pg_namespace WHERE nspname='wlt'
), commands AS (
 SELECT to_regprocedure('wlt.append_commercial_agreement_proposal(text,bigint,text,text,text,text,integer,bigint,integer,text[],timestamptz,text,text)') AS oid
 UNION ALL
 SELECT to_regprocedure('wlt.record_commercial_agreement_decision(text,bigint,text,text,text,text,text)')
)
SELECT current_database()='bthwani_wlt_test'
 AND current_user='bthwani_wlt_command' AND session_user=current_user
 AND current_setting('transaction_isolation')='read committed'
 AND r.rolcanlogin AND NOT(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r.oid OR roleid=r.oid)
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datname=current_database() AND pg_get_userbyid(datdba)='bthwani_wlt_owner')
 AND has_database_privilege(current_database(),'CONNECT')
 AND NOT has_database_privilege(current_database(),'CREATE,TEMP,CONNECT WITH GRANT OPTION')
 AND EXISTS(SELECT 1 FROM owner_schema WHERE pg_get_userbyid(nspowner)='bthwani_wlt_owner')
 AND has_schema_privilege('wlt','USAGE')
 AND NOT has_schema_privilege('wlt','USAGE WITH GRANT OPTION')
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE has_schema_privilege(oid,'CREATE'))
 AND has_table_privilege('wlt.latest_commercial_agreement_reviews','SELECT')
 AND NOT EXISTS(
 SELECT 1 FROM pg_catalog.pg_class c JOIN owner_schema s ON c.relnamespace=s.oid
 WHERE c.relkind IN ('r','p','v','m','f','S')
 AND (pg_get_userbyid(c.relowner)<>'bthwani_wlt_owner'
 OR CASE WHEN c.relkind='S' THEN has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE')
 ELSE has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN,SELECT WITH GRANT OPTION')
 OR has_any_column_privilege(c.oid,'INSERT,UPDATE,REFERENCES,SELECT WITH GRANT OPTION')
 OR (c.relname<>'latest_commercial_agreement_reviews' AND has_any_column_privilege(c.oid,'SELECT')) END))
 AND (SELECT count(*) FROM commands c JOIN pg_catalog.pg_proc p ON p.oid=c.oid
 WHERE p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']
 AND pg_get_userbyid(p.proowner)='bthwani_wlt_owner' AND has_function_privilege(p.oid,'EXECUTE'))=2
 AND NOT EXISTS(
 SELECT 1 FROM pg_catalog.pg_proc p JOIN owner_schema s ON p.pronamespace=s.oid
 WHERE pg_get_userbyid(p.proowner)<>'bthwani_wlt_owner'
 OR has_function_privilege(p.oid,'EXECUTE WITH GRANT OPTION')
 OR (has_function_privilege(p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM commands c WHERE c.oid=p.oid)))
FROM pg_catalog.pg_roles r WHERE r.rolname=current_user
`

func validMerchantDecision(d MerchantDecision) bool {
	return storeIDRule.MatchString(d.StoreID) && d.Version >= 1 && d.Version <= 9007199254740991 &&
		agreementOperationID.MatchString(d.ProposalOperationID) && agreementOperationID.MatchString(d.OperationID) &&
		(d.Decision == "ACCEPTED" || d.Decision == "DECLINED") && utf8.ValidString(d.Reason) &&
		utf8.RuneCountInString(d.Reason) >= 1 && utf8.RuneCountInString(d.Reason) <= 300 &&
		strings.TrimSpace(d.Reason) == d.Reason && !strings.ContainsFunc(d.Reason, unicode.IsControl)
}

func agreementAuthorityError(status int) error {
	switch status {
	case http.StatusUnauthorized:
		return ErrAgreementUnauthorized
	case http.StatusForbidden:
		return ErrAgreementForbidden
	default:
		return ErrAgreementUnconfirmed
	}
}

func merchantDecisionAuthority(ctx context.Context, identity identityReader, endpoint, auth, store string) (principal, string, error) {
	actor, status := identity.readRole(ctx, auth, "merchant")
	if status != http.StatusOK {
		return principal{}, "", agreementAuthorityError(status)
	}
	relation, status := ownedStoreRelation(ctx, identity, endpoint, auth, actor.ActorID, store)
	if status != http.StatusOK {
		return principal{}, "", agreementAuthorityError(status)
	}
	return actor, relation, nil
}

// RecordMerchantAgreementDecision runs only on a separately admitted isolated
// command connection. It never accepts a caller-provided actor or relation,
// never activates terms and never writes the ledger. The same operation ID
// and payload resolve an uncertain commit without duplicating consent.
func RecordMerchantAgreementDecision(ctx context.Context, db *sql.DB, identityOrigin, dshOrigin, token string, d MerchantDecision) (string, error) {
	if db == nil || !validMerchantDecision(d) {
		return "", ErrAgreementInvalid
	}
	auth := "Bearer " + token
	if !validBearer(auth) {
		return "", ErrAgreementUnauthorized
	}
	identity, err := newIdentityReader(identityOrigin)
	if err != nil {
		return "", ErrAgreementUnconfirmed
	}
	endpoint, err := merchantStandingEndpoint(false, []string{dshOrigin})
	if err != nil || endpoint == "" {
		return "", ErrAgreementUnconfirmed
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	actor, relation, err := merchantDecisionAuthority(ctx, identity, endpoint, auth, d.StoreID)
	if err != nil {
		return "", err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return "", ErrAgreementUnconfirmed
	}
	defer tx.Rollback()
	var admitted bool
	if err = tx.QueryRowContext(ctx, agreementCommandAdmissionSQL).Scan(&admitted); err != nil || !admitted {
		return "", ErrAgreementUnconfirmed
	}
	// Match the owner's serialization key before reading current Store terms.
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('wlt:commercial-proposal:'||$1,0))", d.StoreID); err != nil {
		return "", ErrAgreementUnconfirmed
	}
	var storedRelation string
	if err = tx.QueryRowContext(ctx, "SELECT store_relation FROM wlt.latest_commercial_agreement_reviews WHERE store_id=$1", d.StoreID).Scan(&storedRelation); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrAgreementConflict
		}
		return "", ErrAgreementUnconfirmed
	}
	if storedRelation != relation {
		return "", ErrAgreementForbidden
	}
	var state string
	err = tx.QueryRowContext(ctx, "SELECT wlt.record_commercial_agreement_decision($1,$2,$3,$4,$5,$6,$7)", d.StoreID, d.Version, d.ProposalOperationID, d.OperationID, d.Decision, actor.ActorID, d.Reason).Scan(&state)
	if err != nil {
		var pg *pq.Error
		if errors.As(err, &pg) && (pg.Code == "23514" || pg.Code == "23505" || pg.Code == "40001") {
			return "", ErrAgreementConflict
		}
		return "", ErrAgreementUnconfirmed
	}
	if state != "RECORDED" && state != "REPLAYED" {
		return "", ErrAgreementUnconfirmed
	}
	current, currentRelation, err := merchantDecisionAuthority(ctx, identity, endpoint, auth, d.StoreID)
	if err != nil {
		return "", err
	}
	now := time.Now()
	if current.ActorID != actor.ActorID || !actor.Expires.After(now) || !current.Expires.After(now) {
		return "", ErrAgreementUnauthorized
	}
	if relation != currentRelation {
		return "", ErrAgreementForbidden
	}
	if ctx.Err() != nil || tx.Commit() != nil {
		return "", ErrAgreementUnconfirmed
	}
	return state, nil
}
