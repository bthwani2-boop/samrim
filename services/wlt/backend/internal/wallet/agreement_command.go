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

// AgreementDecision binds one immutable proposal and one retry identity.
// The actor is obtained from Identity; clients cannot supply it.
type AgreementDecision struct {
	StoreID             string
	Version             int64
	ProposalOperationID string
	OperationID         string
	Decision            string
	Reason              string
}

var (
	ErrAgreementInvalid      = errors.New("invalid agreement decision")
	ErrAgreementUnauthorized = errors.New("current authenticated session required")
	ErrAgreementForbidden    = errors.New("current agreement authority required")
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

type decisionStage uint8

const (
	merchantStage decisionStage = iota
	financeStage
)

func validAgreementDecision(d AgreementDecision, stage decisionStage) bool {
	validMode := (stage == merchantStage && (d.Decision == "ACCEPTED" || d.Decision == "DECLINED")) ||
		(stage == financeStage && (d.Decision == "FINANCE_APPROVED" || d.Decision == "FINANCE_REJECTED"))
	return validMode && storeIDRule.MatchString(d.StoreID) && d.Version >= 1 && d.Version <= 9007199254740991 &&
		agreementOperationID.MatchString(d.ProposalOperationID) && agreementOperationID.MatchString(d.OperationID) &&
		validAgreementReason(d.Reason)
}

func validAgreementReason(reason string) bool {
	return utf8.ValidString(reason) && reason != "" && utf8.RuneCountInString(reason) <= 300 &&
		strings.TrimSpace(reason) == reason && !strings.ContainsFunc(reason, unicode.IsControl)
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

type financialStanding struct {
	ActorID      string `json:"actorId"`
	StoreID      string `json:"storeId"`
	Relation     string `json:"relation"`
	OwnerActorID string `json:"ownerActorId"`
}

func validStandingActor(actor string) bool {
	return actor != "" && utf8.RuneCountInString(actor) <= 128 && strings.TrimSpace(actor) == actor &&
		!strings.ContainsFunc(actor, unicode.IsControl)
}

// Shared DSH authority read for isolated proposal and decision commands.
// An unpublished Store is eligible for review but conveys no checkout rights.
func financeStoreStanding(ctx context.Context, identity identityReader, origin, auth, actorID, storeID string) (financialStanding, int) {
	var standing financialStanding
	if !validLoopbackOwnerOrigin(origin) || !storeIDRule.MatchString(storeID) {
		return standing, http.StatusServiceUnavailable
	}
	endpoint := origin + "/v1/operators/stores/" + storeID + "/financial-standing"
	status := identity.readBoundedOwner(ctx, auth, endpoint, &standing, identityReplyLimit)
	if status != http.StatusOK {
		return financialStanding{}, status
	}
	if standing.ActorID != actorID || standing.StoreID != storeID || !validStandingActor(standing.OwnerActorID) ||
		(standing.Relation != "DIRECT" && standing.Relation != "MARKETPLACE") {
		return financialStanding{}, http.StatusServiceUnavailable
	}
	return standing, http.StatusOK
}

type decisionAuthority struct {
	identity    identityReader
	stage       decisionStage
	dshOrigin   string
	dshEndpoint string
	auth        string
	store       string
}

func (a decisionAuthority) current(ctx context.Context) (principal, financialStanding, error) {
	var actor principal
	var standing financialStanding
	var status int
	if a.stage == financeStage {
		actor, status = a.identity.finance(ctx, a.auth)
		if status != http.StatusOK {
			return principal{}, financialStanding{}, agreementAuthorityError(status)
		}
		standing, status = financeStoreStanding(ctx, a.identity, a.dshOrigin, a.auth, actor.ActorID, a.store)
	} else {
		actor, status = a.identity.readRole(ctx, a.auth, "merchant")
		if status != http.StatusOK {
			return principal{}, financialStanding{}, agreementAuthorityError(status)
		}
		var relation string
		relation, status = ownedStoreRelation(ctx, a.identity, a.dshEndpoint, a.auth, actor.ActorID, a.store)
		standing = financialStanding{ActorID: actor.ActorID, StoreID: a.store, Relation: relation, OwnerActorID: actor.ActorID}
	}
	if status != http.StatusOK {
		return principal{}, financialStanding{}, agreementAuthorityError(status)
	}
	// Revalidate the current Identity authority after the cross-owner read.
	var verified principal
	if a.stage == financeStage {
		verified, status = a.identity.finance(ctx, a.auth)
	} else {
		verified, status = a.identity.readRole(ctx, a.auth, "merchant")
	}
	if status != http.StatusOK {
		return principal{}, financialStanding{}, agreementAuthorityError(status)
	}
	if verified.ActorID != actor.ActorID || !actor.Expires.After(time.Now()) {
		return principal{}, financialStanding{}, ErrAgreementUnauthorized
	}
	return verified, standing, nil
}

// RecordMerchantAgreementDecision requires current Store ownership and relation.
// It cannot approve on behalf of Finance or activate terms.
func RecordMerchantAgreementDecision(ctx context.Context, db *sql.DB, identityOrigin, dshOrigin, token string, d AgreementDecision) (string, error) {
	return recordAgreementDecision(ctx, db, identityOrigin, dshOrigin, token, d, merchantStage)
}

// RecordFinanceAgreementDecision requires the current explicit Finance grant,
// actual DSH Store standing and distinct accepted consent on the exact proposal.
// Review approval is not activation, a payment authorization or a ledger write.
func RecordFinanceAgreementDecision(ctx context.Context, db *sql.DB, identityOrigin, dshOrigin, token string, d AgreementDecision) (string, error) {
	return recordAgreementDecision(ctx, db, identityOrigin, dshOrigin, token, d, financeStage)
}

// Both stages share the same isolated command principal, owner lock, durable
// operation identity and authority recheck. Unknown commit results are retried
// only using the original operation ID and identical payload.
func agreementCommandAuthority(identityOrigin, dshOrigin, token, store string, stage decisionStage) (decisionAuthority, error) {
	auth := "Bearer " + token
	if !validBearer(auth) {
		return decisionAuthority{}, ErrAgreementUnauthorized
	}
	identity, err := newIdentityReader(identityOrigin, false)
	if err != nil || !validLoopbackOwnerOrigin(dshOrigin) {
		return decisionAuthority{}, ErrAgreementUnconfirmed
	}
	authority := decisionAuthority{identity: identity, stage: stage, dshOrigin: dshOrigin, auth: auth, store: store}
	if stage == merchantStage {
		endpoint, err := merchantStandingEndpoint(false, []string{dshOrigin})
		if err != nil || endpoint == "" {
			return decisionAuthority{}, ErrAgreementUnconfirmed
		}
		authority.dshEndpoint = endpoint
	}
	return authority, nil
}

func executeAgreementCommand[T any](ctx context.Context, db *sql.DB, authority decisionAuthority,
	write func(context.Context, *sql.Tx, principal, financialStanding) (T, error)) (T, error) {
	var empty T
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	actor, standing, err := authority.current(ctx)
	if err != nil {
		return empty, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return empty, ErrAgreementUnconfirmed
	}
	defer tx.Rollback()
	var admitted bool
	if err = tx.QueryRowContext(ctx, agreementCommandAdmissionSQL).Scan(&admitted); err != nil || !admitted {
		return empty, ErrAgreementUnconfirmed
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('wlt:commercial-proposal:'||$1,0))", authority.store); err != nil {
		return empty, ErrAgreementUnconfirmed
	}
	result, outcome := write(ctx, tx, actor, standing)
	if outcome != nil && !errors.Is(outcome, ErrAgreementConflict) {
		return empty, outcome
	}
	// A conflict also discloses the outcome of a Store-scoped owner read.
	// Recheck authority for it before disclosing it, then roll it back.
	current, currentStanding, err := authority.current(ctx)
	if err != nil {
		return empty, err
	}
	now := time.Now()
	if current.ActorID != actor.ActorID || !actor.Expires.After(now) || !current.Expires.After(now) {
		return empty, ErrAgreementUnauthorized
	}
	if standing != currentStanding {
		return empty, ErrAgreementForbidden
	}
	if outcome != nil {
		return empty, outcome
	}
	if ctx.Err() != nil || tx.Commit() != nil {
		return empty, ErrAgreementUnconfirmed
	}
	return result, nil
}

func agreementWriteError(err error) error {
	var pg *pq.Error
	if errors.As(err, &pg) && (pg.Code == "23514" || pg.Code == "23505" || pg.Code == "40001") {
		return ErrAgreementConflict
	}
	return ErrAgreementUnconfirmed
}

func recordAgreementDecision(ctx context.Context, db *sql.DB, identityOrigin, dshOrigin, token string, d AgreementDecision, stage decisionStage) (string, error) {
	if db == nil || !validAgreementDecision(d, stage) {
		return "", ErrAgreementInvalid
	}
	authority, err := agreementCommandAuthority(identityOrigin, dshOrigin, token, d.StoreID, stage)
	if err != nil {
		return "", err
	}
	return executeAgreementCommand(ctx, db, authority, func(ctx context.Context, tx *sql.Tx, actor principal, standing financialStanding) (string, error) {
		var storedRelation string
		err := tx.QueryRowContext(ctx, "SELECT store_relation FROM wlt.latest_commercial_agreement_reviews WHERE store_id=$1", d.StoreID).Scan(&storedRelation)
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrAgreementConflict
		}
		if err != nil {
			return "", ErrAgreementUnconfirmed
		}
		if storedRelation != standing.Relation {
			return "", ErrAgreementForbidden
		}
		var state string
		err = tx.QueryRowContext(ctx, "SELECT wlt.record_commercial_agreement_decision($1,$2,$3,$4,$5,$6,$7)", d.StoreID, d.Version, d.ProposalOperationID, d.OperationID, d.Decision, actor.ActorID, d.Reason).Scan(&state)
		if err != nil {
			return "", agreementWriteError(err)
		}
		if state != "RECORDED" && state != "REPLAYED" {
			return "", ErrAgreementUnconfirmed
		}
		return state, nil
	})
}
