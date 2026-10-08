package actor

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	_ "github.com/lib/pq"
)

func TestProvisionFirstOperatorBootstrapIsCanonicalAndIdempotent(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	service := New(db, "")
	input := domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"}

	first, err := service.ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", input)
	if err != nil {
		t.Fatalf("provision first operator: %v", err)
	}
	if first.ActorID == "" || first.PhoneE164 != "+15555550123" || !first.SecurityEnabled || !first.Enabled || first.ActivatedAt != nil {
		t.Fatalf("unexpected initial operator view: %+v", first)
	}
	canonicalID, err := ReadInitialOperatorActorID(ctx, db)
	if err != nil || canonicalID != first.ActorID {
		t.Fatalf("canonical actor read = %q, err=%v; want %q", canonicalID, err, first.ActorID)
	}
	bootstrapStatus, err := ReadInitialOperatorBootstrapStatus(ctx, db)
	if err != nil || bootstrapStatus.ActorID != first.ActorID || bootstrapStatus.CanCreate {
		t.Fatalf("bootstrap status = %+v, err=%v; want existing canonical actor", bootstrapStatus, err)
	}
	var permissionCount, enabledCount, auditCount int
	if err := db.QueryRowContext(ctx, `SELECT count(*),count(*) FILTER (WHERE enabled) FROM identity_operator_permissions WHERE actor_id=$1`, first.ActorID).Scan(&permissionCount, &enabledCount); err != nil {
		t.Fatalf("read initial grants: %v", err)
	}
	if permissionCount != len(domain.OperatorPermissions()) || enabledCount != permissionCount {
		t.Fatalf("initial grant state = %d total, %d enabled; want all %d enabled", permissionCount, enabledCount, len(domain.OperatorPermissions()))
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_security_audit WHERE subject_actor_id=$1", first.ActorID).Scan(&auditCount); err != nil {
		t.Fatalf("read bootstrap audit: %v", err)
	}
	if auditCount != 2+len(domain.OperatorPermissions()) {
		t.Fatalf("initial bootstrap audit count = %d; want actor, role, and six grant events", auditCount)
	}

	if _, err := db.ExecContext(ctx, `UPDATE identity_operator_permissions SET enabled=false,version=version+1,reason='isolated revocation proof'
		WHERE actor_id=$1 AND permission=$2`, first.ActorID, domain.OperatorPermissionFinance); err != nil {
		t.Fatalf("revoke isolated grant: %v", err)
	}
	repeated, err := service.ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{})
	if err != nil {
		t.Fatalf("repeat bootstrap without a phone: %v", err)
	}
	if repeated.ActorID != first.ActorID || repeated.PhoneE164 != first.PhoneE164 {
		t.Fatalf("repeat bootstrap changed canonical actor: first=%+v repeated=%+v", first, repeated)
	}
	var financeEnabled bool
	var financeVersion int
	if err := db.QueryRowContext(ctx, `SELECT enabled,version FROM identity_operator_permissions WHERE actor_id=$1 AND permission=$2`, first.ActorID, domain.OperatorPermissionFinance).Scan(&financeEnabled, &financeVersion); err != nil {
		t.Fatalf("read revoked grant after repeated bootstrap: %v", err)
	}
	if financeEnabled || financeVersion != 2 {
		t.Fatalf("repeated bootstrap restored revoked grant: enabled=%t version=%d", financeEnabled, financeVersion)
	}
	var auditAfterRepeat int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_security_audit WHERE subject_actor_id=$1", first.ActorID).Scan(&auditAfterRepeat); err != nil {
		t.Fatalf("read audit after repeated bootstrap: %v", err)
	}
	if auditAfterRepeat != auditCount {
		t.Fatalf("repeated bootstrap wrote audit events: before=%d after=%d", auditCount, auditAfterRepeat)
	}

	for _, tc := range []struct {
		name        string
		actorID     string
		development string
		want        bool
	}{
		{name: "canonical owner", actorID: first.ActorID, want: true},
		{name: "matching development pin", actorID: first.ActorID, development: first.ActorID, want: true},
		{name: "mismatched development pin", actorID: first.ActorID, development: "act_wrong_development_operator", want: false},
		{name: "different actor", actorID: "act_other_operator", want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := IsOperatorPermissionAdministrator(ctx, db, tc.actorID, tc.development)
			if err != nil || got != tc.want {
				t.Fatalf("administrator authorization = %t, err=%v; want %t", got, err, tc.want)
			}
		})
	}
}

func TestProvisionFirstOperatorBootstrapSerializesConcurrentCalls(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	status, err := ReadInitialOperatorBootstrapStatus(ctx, db)
	if err != nil || !status.CanCreate || status.ActorID != "" {
		t.Fatalf("empty Identity bootstrap status = %+v err=%v; want eligible", status, err)
	}
	service := New(db, "")
	const callers = 8
	type result struct {
		actorID string
		err     error
	}
	results := make(chan result, callers)
	start := make(chan struct{})
	for range callers {
		go func() {
			<-start
			view, err := service.ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"})
			results <- result{actorID: view.ActorID, err: err}
		}()
	}
	close(start)
	canonicalID := ""
	for range callers {
		result := <-results
		if result.err != nil {
			t.Fatalf("concurrent bootstrap failed: %v", result.err)
		}
		if canonicalID == "" {
			canonicalID = result.actorID
		} else if result.actorID != canonicalID {
			t.Fatalf("concurrent bootstrap returned multiple actor IDs: %q and %q", canonicalID, result.actorID)
		}
	}
	var actors, roots, grants int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_actors").Scan(&actors); err != nil {
		t.Fatalf("count actors: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_bootstrap_state").Scan(&roots); err != nil {
		t.Fatalf("count bootstrap roots: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_operator_permissions").Scan(&grants); err != nil {
		t.Fatalf("count operator grants: %v", err)
	}
	if actors != 1 || roots != 1 || grants != len(domain.OperatorPermissions()) {
		t.Fatalf("concurrent bootstrap state = actors:%d roots:%d grants:%d", actors, roots, grants)
	}
}

func TestProvisionFirstOperatorBootstrapFailsClosedForOccupiedOrIncompleteState(t *testing.T) {
	t.Run("existing actor without canonical root", func(t *testing.T) {
		ctx, db := newIsolatedIdentityDatabase(t)
		if _, err := db.ExecContext(ctx, "INSERT INTO identity_actors(id,phone_e164) VALUES('actor_existing_without_root','+15555550123')"); err != nil {
			t.Fatalf("create isolated existing actor: %v", err)
		}
		_, err := New(db, "").ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"})
		if !errors.Is(err, domain.ErrConflict) {
			t.Fatalf("bootstrap error = %v; want conflict", err)
		}
		if _, err := ReadInitialOperatorBootstrapStatus(ctx, db); !errors.Is(err, domain.ErrConflict) {
			t.Fatalf("bootstrap status error = %v; want conflict for occupied database", err)
		}
		var actors, roles int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_actors").Scan(&actors); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_actor_roles WHERE role='operator'").Scan(&roles); err != nil {
			t.Fatal(err)
		}
		if actors != 1 || roles != 0 {
			t.Fatalf("bootstrap modified occupied state: actors=%d operator roles=%d", actors, roles)
		}
	})

	t.Run("existing challenge state without actors", func(t *testing.T) {
		ctx, db := newIsolatedIdentityDatabase(t)
		if _, err := db.ExecContext(ctx, `INSERT INTO identity_challenges(id,role,purpose,phone_e164,code_hash,request_ip_hash,admissible,status,attempts,expires_at)
			VALUES('decoy-challenge-without-actor','client','client_register','+15555550124',repeat('a',64),repeat('b',64),false,'pending',0,clock_timestamp()+interval '1 hour')`); err != nil {
			t.Fatalf("create isolated challenge history: %v", err)
		}
		if _, err := ReadInitialOperatorBootstrapStatus(ctx, db); !errors.Is(err, domain.ErrConflict) {
			t.Fatalf("bootstrap status with preexisting challenge history = %v; want conflict", err)
		}
		if _, err := New(db, "").ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"}); !errors.Is(err, domain.ErrConflict) {
			t.Fatalf("bootstrap with preexisting challenge history = %v; want conflict", err)
		}
		var actors int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_actors").Scan(&actors); err != nil {
			t.Fatal(err)
		}
		if actors != 0 {
			t.Fatalf("bootstrap created an actor in non-empty Identity state: %d", actors)
		}
	})

	t.Run("existing WebAuthn ceremony without an actor", func(t *testing.T) {
		ctx, db := newIsolatedIdentityDatabase(t)
		if _, err := db.ExecContext(ctx, `INSERT INTO identity_webauthn_ceremonies(id,kind,challenge,session_data,expires_at)
			VALUES('orphan-registration-ceremony','operator_registration','orphan-challenge','{}'::jsonb,clock_timestamp()+interval '1 hour')`); err != nil {
			t.Fatalf("create isolated WebAuthn ceremony without an actor: %v", err)
		}
		if _, err := ReadInitialOperatorBootstrapStatus(ctx, db); !errors.Is(err, domain.ErrConflict) {
			t.Fatalf("bootstrap status with preexisting WebAuthn ceremony = %v; want conflict", err)
		}
		if _, err := New(db, "").ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"}); !errors.Is(err, domain.ErrConflict) {
			t.Fatalf("bootstrap with preexisting WebAuthn ceremony = %v; want conflict", err)
		}
		var actors int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_actors").Scan(&actors); err != nil {
			t.Fatal(err)
		}
		if actors != 0 {
			t.Fatalf("bootstrap created an actor over preexisting WebAuthn state: %d", actors)
		}
	})

	t.Run("existing root with missing grant", func(t *testing.T) {
		ctx, db := newIsolatedIdentityDatabase(t)
		view, err := New(db, "").ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"})
		if err != nil {
			t.Fatalf("create isolated initial operator: %v", err)
		}
		if _, err := db.ExecContext(ctx, "DELETE FROM identity_operator_permissions WHERE actor_id=$1 AND permission=$2", view.ActorID, domain.OperatorPermissionFinance); err != nil {
			t.Fatalf("create incomplete grant fixture: %v", err)
		}
		_, err = New(db, "").ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{})
		if !errors.Is(err, domain.ErrConflict) {
			t.Fatalf("bootstrap error = %v; want conflict for incomplete root", err)
		}
		var grants int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_operator_permissions WHERE actor_id=$1", view.ActorID).Scan(&grants); err != nil {
			t.Fatal(err)
		}
		if grants != len(domain.OperatorPermissions())-1 {
			t.Fatalf("bootstrap repaired missing grant unexpectedly: count=%d", grants)
		}
	})

	t.Run("disabled root state remains disabled", func(t *testing.T) {
		ctx, db := newIsolatedIdentityDatabase(t)
		view, err := New(db, "").ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"})
		if err != nil {
			t.Fatalf("create isolated initial operator: %v", err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE identity_actors SET security_enabled=false WHERE id=$1`, view.ActorID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE identity_actor_roles SET enabled=false WHERE actor_id=$1 AND role='operator'`, view.ActorID); err != nil {
			t.Fatal(err)
		}
		repeated, err := New(db, "").ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{})
		if err != nil {
			t.Fatalf("read disabled canonical operator: %v", err)
		}
		if repeated.SecurityEnabled || repeated.Enabled {
			t.Fatalf("bootstrap re-enabled disabled state: %+v", repeated)
		}
	})
}

func TestInitialOperatorPermissionAdministrationEnforcesScopeVersionAuditAndSessionRevocation(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	service := New(db, "")
	root, err := service.ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"})
	if err != nil {
		t.Fatalf("provision initial operator: %v", err)
	}
	createdProfile, err := service.CreateOperatorProfile(ctx, "control-panel", root.ActorID, "profile-create-proof", "profile-create-key", domain.OperatorProfileCreateRequest{FullNameAr: "مشغل اختبار", PhoneE164: "+15555550124"})
	if err != nil {
		t.Fatalf("create isolated operator profile: %v", err)
	}
	approvedProfile, err := service.ApproveOperatorProfile(ctx, "control-panel", root.ActorID, "profile-approve-proof", "profile-approve-key", createdProfile.Profile.ID, createdProfile.Profile.Version)
	if err != nil {
		t.Fatalf("approve isolated operator profile: %v", err)
	}
	target, err := service.GrantOperatorProfile(ctx, "control-panel", root.ActorID, "profile-grant-proof", "profile-grant-key", approvedProfile.Profile.ID, approvedProfile.Profile.Version)
	if err != nil {
		t.Fatalf("admit isolated operator profile: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_sessions(id,actor_id,role,access_token_hash,refresh_token_hash,client_instance_id_hash,access_expires_at,refresh_expires_at,absolute_expires_at)
		VALUES('permission-revocation-session',$1,'operator',repeat('a',64),repeat('b',64),repeat('c',64),clock_timestamp()+interval '15 minutes',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours')`, target.Role.ActorID); err != nil {
		t.Fatalf("create isolated active session fixture: %v", err)
	}

	granted, err := service.SetOperatorPermission(ctx, "control-panel", target.Role.ActorID, root.ActorID, domain.OperatorPermissionCatalog, true, "permission-proof", "approved catalog access", 1)
	if err != nil || !granted.Enabled || granted.Version != 2 || granted.ChangedByActorID == nil || *granted.ChangedByActorID != root.ActorID {
		t.Fatalf("initial operator grant = %+v err=%v", granted, err)
	}
	if _, err := service.SetOperatorPermission(ctx, "control-panel", root.ActorID, root.ActorID, domain.OperatorPermissionFinance, false, "self-grant-proof", "attempt self change", 1); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("initial operator self-change error = %v; want conflict", err)
	}
	if _, err := service.SetOperatorPermission(ctx, "control-panel", root.ActorID, target.Role.ActorID, domain.OperatorPermissionFinance, false, "unauthorized-proof", "attempt unauthorized change", 1); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-root permission change error = %v; want forbidden", err)
	}
	if _, err := service.SetOperatorPermission(ctx, "control-panel", target.Role.ActorID, root.ActorID, domain.OperatorPermissionCatalog, false, "stale-version-proof", "stale expected version", 1); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("stale expectedVersion error = %v; want conflict", err)
	}
	var revokedAt sql.NullTime
	var sessionVersion int
	if err := db.QueryRowContext(ctx, "SELECT revoked_at,version FROM identity_sessions WHERE id='permission-revocation-session'").Scan(&revokedAt, &sessionVersion); err != nil {
		t.Fatalf("read permission-change session outcome: %v", err)
	}
	if !revokedAt.Valid || sessionVersion != 2 {
		t.Fatalf("permission change did not revoke target sessions: revoked=%t version=%d", revokedAt.Valid, sessionVersion)
	}

	revoked, err := service.SetOperatorPermission(ctx, "control-panel", target.Role.ActorID, root.ActorID, domain.OperatorPermissionCatalog, false, "permission-revoke", "catalog access removed", 2)
	if err != nil || revoked.Enabled || revoked.Version != 3 {
		t.Fatalf("initial operator revocation = %+v err=%v", revoked, err)
	}
	var auditCount int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM identity_security_audit WHERE event_type='operator.permission_changed' AND subject_actor_id=$1`, target.Role.ActorID).Scan(&auditCount); err != nil {
		t.Fatalf("read permission audit trail: %v", err)
	}
	if auditCount != 2 {
		t.Fatalf("permission change audit count = %d; want one grant and one revocation", auditCount)
	}
}

func TestUpdateInitialOperatorPhoneForLocalPreservesCanonicalIdentityAndRevokesOnlyItsSessions(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	service := New(db, "")
	root, err := service.ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"})
	if err != nil {
		t.Fatalf("provision initial operator: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_actors(id,phone_e164) VALUES('unrelated_phone_update_actor','+15555550126')`); err != nil {
		t.Fatalf("create unrelated actor fixture: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_actor_roles(actor_id,role) VALUES('unrelated_phone_update_actor','client')`); err != nil {
		t.Fatalf("create unrelated actor role fixture: %v", err)
	}
	for _, session := range []struct {
		id, actorID, role, tokenA, tokenB, tokenC string
	}{
		{"phone-update-root-session", root.ActorID, "operator", "d", "e", "f"},
		{"phone-update-unrelated-session", "unrelated_phone_update_actor", "client", "1", "2", "3"},
	} {
		if _, err := db.ExecContext(ctx, `INSERT INTO identity_sessions(id,actor_id,role,access_token_hash,refresh_token_hash,client_instance_id_hash,access_expires_at,refresh_expires_at,absolute_expires_at)
			VALUES($1,$2,$3,repeat($4,64),repeat($5,64),repeat($6,64),clock_timestamp()+interval '15 minutes',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours')`, session.id, session.actorID, session.role, session.tokenA, session.tokenB, session.tokenC); err != nil {
			t.Fatalf("create session fixture %s: %v", session.id, err)
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_challenges(id,actor_id,role,purpose,phone_e164,code_hash,request_ip_hash,admissible,status,attempts,expires_at)
		VALUES('phone-update-stale-challenge',$1,'operator',$2,$3,repeat('a',64),repeat('b',64),true,'pending',0,clock_timestamp()+interval '1 hour'),
		('phone-update-current-challenge',$1,'operator',$2,'+15555550125',repeat('c',64),repeat('d',64),true,'pending',0,clock_timestamp()+interval '1 hour')`, root.ActorID, domain.ChallengeOperatorRecover, root.PhoneE164); err != nil {
		t.Fatalf("create phone-bound challenge fixtures: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_challenge_deliveries(challenge_id,provider,status)
		VALUES('phone-update-stale-challenge','mailpit','pending'),('phone-update-current-challenge','mailpit','pending')`); err != nil {
		t.Fatalf("create challenge delivery fixtures: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_operator_enrollment_tokens(id,actor_id,role,phone_e164,code_hash,status,attempts,expires_at,created_by)
		VALUES('phone-update-stale-enrollment-token',$1,'operator',$2,repeat('e',64),'pending',0,clock_timestamp()+interval '1 hour','isolated-proof')`, root.ActorID, root.PhoneE164); err != nil {
		t.Fatalf("create stale enrollment token fixture: %v", err)
	}
	proofStatusBefore, err := ReadInitialOperatorPhoneUpdateStatus(ctx, db, "+15555550125")
	if err != nil || proofStatusBefore.ActorID != root.ActorID || proofStatusBefore.PhoneMatchesRequested || proofStatusBefore.PendingChallengesForOtherPhone != 1 || proofStatusBefore.PendingEnrollmentTokensForOtherPhone != 1 {
		t.Fatalf("initial phone update status = %+v err=%v", proofStatusBefore, err)
	}
	var grantsBefore string
	if err := db.QueryRowContext(ctx, `SELECT string_agg(permission||':'||enabled||':'||version,',' ORDER BY permission)
		FROM identity_operator_permissions WHERE actor_id=$1`, root.ActorID).Scan(&grantsBefore); err != nil {
		t.Fatalf("read initial operator grants: %v", err)
	}

	updated, err := service.UpdateInitialOperatorPhoneForLocal(ctx, "operator-bootstrap", "+15555550125")
	if err != nil {
		t.Fatalf("update canonical initial operator phone: %v", err)
	}
	if updated.ActorID != root.ActorID || updated.PhoneE164 != "+15555550125" || updated.ActorVersion != root.ActorVersion+1 || updated.Enabled != root.Enabled || updated.SecurityEnabled != root.SecurityEnabled {
		t.Fatalf("phone update changed more than the canonical phone: before=%+v after=%+v", root, updated)
	}
	canonicalID, err := ReadInitialOperatorActorID(ctx, db)
	if err != nil || canonicalID != root.ActorID {
		t.Fatalf("canonical actor after phone update = %q, err=%v; want %q", canonicalID, err, root.ActorID)
	}
	var grantsAfter string
	if err := db.QueryRowContext(ctx, `SELECT string_agg(permission||':'||enabled||':'||version,',' ORDER BY permission)
		FROM identity_operator_permissions WHERE actor_id=$1`, root.ActorID).Scan(&grantsAfter); err != nil {
		t.Fatalf("read grants after phone update: %v", err)
	}
	if grantsAfter != grantsBefore {
		t.Fatalf("phone update changed operator grants: before=%s after=%s", grantsBefore, grantsAfter)
	}
	var staleChallengeStatus, currentChallengeStatus, staleDeliveryStatus, staleTokenStatus string
	if err := db.QueryRowContext(ctx, "SELECT status FROM identity_challenges WHERE id='phone-update-stale-challenge'").Scan(&staleChallengeStatus); err != nil {
		t.Fatalf("read stale challenge outcome: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT status FROM identity_challenges WHERE id='phone-update-current-challenge'").Scan(&currentChallengeStatus); err != nil {
		t.Fatalf("read current phone challenge outcome: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT status FROM identity_challenge_deliveries WHERE challenge_id='phone-update-stale-challenge'").Scan(&staleDeliveryStatus); err != nil {
		t.Fatalf("read stale challenge delivery outcome: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT status FROM identity_operator_enrollment_tokens WHERE id='phone-update-stale-enrollment-token'").Scan(&staleTokenStatus); err != nil {
		t.Fatalf("read stale enrollment token outcome: %v", err)
	}
	if staleChallengeStatus != "revoked" || currentChallengeStatus != "pending" || staleDeliveryStatus != "suppressed" || staleTokenStatus != "revoked" {
		t.Fatalf("phone update proof cleanup: stale challenge=%s current challenge=%s stale delivery=%s stale token=%s", staleChallengeStatus, currentChallengeStatus, staleDeliveryStatus, staleTokenStatus)
	}
	proofStatusAfter, err := ReadInitialOperatorPhoneUpdateStatus(ctx, db, "+15555550125")
	if err != nil || proofStatusAfter.ActorID != root.ActorID || !proofStatusAfter.PhoneMatchesRequested || proofStatusAfter.PendingChallengesForOtherPhone != 0 || proofStatusAfter.PendingEnrollmentTokensForOtherPhone != 0 {
		t.Fatalf("phone update readback status = %+v err=%v", proofStatusAfter, err)
	}
	var rootRevoked, unrelatedRevoked sql.NullTime
	var rootSessionVersion, unrelatedSessionVersion int
	if err := db.QueryRowContext(ctx, "SELECT revoked_at,version FROM identity_sessions WHERE id='phone-update-root-session'").Scan(&rootRevoked, &rootSessionVersion); err != nil {
		t.Fatalf("read initial operator session: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT revoked_at,version FROM identity_sessions WHERE id='phone-update-unrelated-session'").Scan(&unrelatedRevoked, &unrelatedSessionVersion); err != nil {
		t.Fatalf("read unrelated session: %v", err)
	}
	if !rootRevoked.Valid || rootSessionVersion != 2 || unrelatedRevoked.Valid || unrelatedSessionVersion != 1 {
		t.Fatalf("phone update session scope: root revoked=%t version=%d, unrelated revoked=%t version=%d", rootRevoked.Valid, rootSessionVersion, unrelatedRevoked.Valid, unrelatedSessionVersion)
	}
	var metadata string
	if err := db.QueryRowContext(ctx, `SELECT metadata::text FROM identity_security_audit
		WHERE event_type='actor.phone_changed' AND subject_actor_id=$1 ORDER BY id DESC LIMIT 1`, root.ActorID).Scan(&metadata); err != nil {
		t.Fatalf("read phone-change audit: %v", err)
	}
	if !strings.Contains(metadata, identitysecurity.MaskPhone(root.PhoneE164)) || !strings.Contains(metadata, identitysecurity.MaskPhone(updated.PhoneE164)) || strings.Contains(metadata, root.PhoneE164) || strings.Contains(metadata, updated.PhoneE164) {
		t.Fatalf("phone-change audit did not keep phone values masked: %s", metadata)
	}

	if _, err := db.ExecContext(ctx, `INSERT INTO identity_sessions(id,actor_id,role,access_token_hash,refresh_token_hash,client_instance_id_hash,access_expires_at,refresh_expires_at,absolute_expires_at)
		VALUES('phone-update-noop-session',$1,'operator',repeat('7',64),repeat('8',64),repeat('9',64),clock_timestamp()+interval '15 minutes',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours')`, root.ActorID); err != nil {
		t.Fatalf("create no-op session fixture: %v", err)
	}
	noOp, err := service.UpdateInitialOperatorPhoneForLocal(ctx, "operator-bootstrap", "+15555550125")
	if err != nil || noOp.ActorVersion != updated.ActorVersion {
		t.Fatalf("same-phone update = %+v err=%v; want no-op", noOp, err)
	}
	var noOpRevoked sql.NullTime
	if err := db.QueryRowContext(ctx, "SELECT revoked_at FROM identity_sessions WHERE id='phone-update-noop-session'").Scan(&noOpRevoked); err != nil {
		t.Fatalf("read no-op session: %v", err)
	}
	if noOpRevoked.Valid {
		t.Fatal("same-phone no-op revoked a newly-created session")
	}
}

func TestUpdateInitialOperatorPhoneForLocalRejectsUnauthorizedAndCollidingPhone(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	service := New(db, "")
	root, err := service.ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"})
	if err != nil {
		t.Fatalf("provision initial operator: %v", err)
	}
	if _, err := service.UpdateInitialOperatorPhoneForLocal(ctx, "control-panel", "+15555550124"); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-bootstrap phone update error = %v; want forbidden", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_actors(id,phone_e164) VALUES('phone_collision_actor','+15555550124')`); err != nil {
		t.Fatalf("create collision actor fixture: %v", err)
	}
	if _, err := service.UpdateInitialOperatorPhoneForLocal(ctx, "operator-bootstrap", "+15555550124"); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("colliding phone update error = %v; want conflict", err)
	}
	var phone string
	var version int
	if err := db.QueryRowContext(ctx, "SELECT phone_e164,version FROM identity_actors WHERE id=$1", root.ActorID).Scan(&phone, &version); err != nil {
		t.Fatalf("read canonical actor after rejected update: %v", err)
	}
	if phone != root.PhoneE164 || version != root.ActorVersion {
		t.Fatalf("rejected phone update changed canonical actor: phone=%s version=%d", phone, version)
	}
	var audits int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM identity_security_audit WHERE event_type='actor.phone_changed' AND subject_actor_id=$1`, root.ActorID).Scan(&audits); err != nil {
		t.Fatalf("read phone update audit after rejection: %v", err)
	}
	if audits != 0 {
		t.Fatalf("rejected phone update wrote audit events: %d", audits)
	}
}

func newIsolatedIdentityDatabase(t *testing.T) (context.Context, *sql.DB) {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("IDENTITY_DATABASE_URL is required for isolated Identity PostgreSQL proof")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open Identity PostgreSQL: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("Identity PostgreSQL is not reachable: %v", err)
	}
	databaseName := fmt.Sprintf("identity_bootstrap_%d", time.Now().UnixNano())
	if _, err := rootDB.ExecContext(ctx, "CREATE DATABASE "+databaseName); err != nil {
		t.Fatalf("create isolated Identity database: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if _, err := rootDB.ExecContext(cleanupCtx, "DROP DATABASE IF EXISTS "+databaseName+" WITH (FORCE)"); err != nil {
			t.Errorf("drop isolated Identity database: %v", err)
		}
	})
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse Identity database URL: %v", err)
	}
	parsedURL.Path = "/" + databaseName
	db, err := sql.Open("postgres", parsedURL.String())
	if err != nil {
		t.Fatalf("open isolated Identity database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	migrationDirectory := filepath.Join("..", "..", "..", "database", "migrations")
	entries, err := os.ReadDir(migrationDirectory)
	if err != nil {
		t.Fatalf("read Identity migrations: %v", err)
	}
	var migrations []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			migrations = append(migrations, entry.Name())
		}
	}
	sort.Strings(migrations)
	for _, name := range migrations {
		script, err := os.ReadFile(filepath.Join(migrationDirectory, name))
		if err != nil {
			t.Fatalf("read Identity migration %s: %v", name, err)
		}
		if _, err := db.ExecContext(ctx, string(script)); err != nil {
			t.Fatalf("apply Identity migration %s: %v", name, err)
		}
	}
	return ctx, db
}
