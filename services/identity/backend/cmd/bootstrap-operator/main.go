package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/opsafety"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	_ "github.com/lib/pq"
)

func main() {
	if strings.ToLower(strings.TrimSpace(os.Getenv("BTHWANI_ENV"))) != "development" || strings.TrimSpace(os.Getenv("IDENTITY_BOOTSTRAP_DOCKER_LOCAL_ONLY")) != "1" {
		log.Fatal("initial operator bootstrap is restricted to the explicit local Docker development service")
	}
	databaseURL := strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	if databaseURL == "" {
		log.Fatal("IDENTITY_DATABASE_URL is required")
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		log.Fatal(err)
	}

	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		log.Fatalf("open Identity database: %v", err)
	}
	defer func() { _ = db.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("connect to Identity database: %v", err)
	}

	mode := ""
	if len(os.Args) == 2 {
		mode = os.Args[1]
	} else if len(os.Args) != 1 {
		log.Fatal("usage: bootstrap-operator [status|update-phone]")
	}
	phone := strings.TrimSpace(os.Getenv("IDENTITY_INITIAL_OPERATOR_PHONE"))
	configuredActorID := strings.TrimSpace(os.Getenv("IDENTITY_DEVELOPMENT_OPERATOR_ACTOR_ID"))
	status, err := actor.ReadInitialOperatorBootstrapStatus(ctx, db)
	if err != nil {
		log.Fatalf("read initial operator bootstrap status: %v", err)
	}
	if mode == "status" {
		if status.ActorID != "" {
			fmt.Printf("canonical initial operator actor_id=%s\n", status.ActorID)
			if phone != "" {
				phoneStatus, err := actor.ReadInitialOperatorPhoneUpdateStatus(ctx, db, phone)
				if err != nil {
					log.Fatalf("read initial operator phone update status: %v", err)
				}
				fmt.Printf("phone_matches_requested=%t pending_stale_challenges=%d pending_stale_enrollment_tokens=%d\n", phoneStatus.PhoneMatchesRequested, phoneStatus.PendingChallengesForOtherPhone, phoneStatus.PendingEnrollmentTokensForOtherPhone)
			}
		} else if status.CanCreate {
			fmt.Println("Identity database is empty and eligible for initial operator creation")
		}
		return
	}

	if mode == "update-phone" {
		if status.ActorID == "" {
			log.Fatal("update-phone requires an existing canonical initial operator")
		}
		if configuredActorID != "" && configuredActorID != status.ActorID {
			log.Fatal("IDENTITY_DEVELOPMENT_OPERATOR_ACTOR_ID does not match the canonical initial operator")
		}
		if phone == "" {
			log.Fatal("IDENTITY_INITIAL_OPERATOR_PHONE is required for update-phone")
		}
		view, err := actor.New(db, configuredActorID).UpdateInitialOperatorPhoneForLocal(ctx, "operator-bootstrap", phone)
		if err != nil {
			log.Fatalf("update canonical initial operator phone: %v", err)
		}
		normalizedPhone, err := identitysecurity.NormalizePhoneE164(phone)
		if err != nil || view.PhoneE164 != normalizedPhone {
			log.Fatal("updated phone did not match the normalized requested phone")
		}
		phoneStatus, err := actor.ReadInitialOperatorPhoneUpdateStatus(ctx, db, phone)
		if err != nil || phoneStatus.ActorID != view.ActorID || !phoneStatus.PhoneMatchesRequested || phoneStatus.PendingChallengesForOtherPhone != 0 || phoneStatus.PendingEnrollmentTokensForOtherPhone != 0 {
			log.Fatal("canonical initial operator phone proof state did not read back cleanly")
		}
		fmt.Printf("canonical initial operator phone confirmed actor_id=%s phone_matches_requested=true pending_stale_challenges=0 pending_stale_enrollment_tokens=0\n", view.ActorID)
		return
	}
	if mode != "" {
		log.Fatal("usage: bootstrap-operator [status|update-phone]")
	}
	if status.ActorID != "" && configuredActorID != "" && configuredActorID != status.ActorID {
		log.Fatal("IDENTITY_DEVELOPMENT_OPERATOR_ACTOR_ID does not match the canonical initial operator")
	}
	if status.CanCreate && configuredActorID != "" {
		log.Fatal("clear IDENTITY_DEVELOPMENT_OPERATOR_ACTOR_ID before creating the initial operator")
	}
	if status.CanCreate && phone == "" {
		log.Fatal("IDENTITY_INITIAL_OPERATOR_PHONE is required for a new empty Identity database")
	}
	service := actor.New(db, configuredActorID)
	view, err := service.ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: phone})
	if err != nil {
		log.Fatalf("provision initial operator: %v", err)
	}
	if configuredActorID != "" && configuredActorID != view.ActorID {
		log.Fatal("IDENTITY_DEVELOPMENT_OPERATOR_ACTOR_ID does not match the canonical initial operator")
	}
	if status.ActorID != "" && phone != "" {
		normalizedPhone, normalizeErr := identitysecurity.NormalizePhoneE164(phone)
		fmt.Printf("canonical initial operator reused actor_id=%s phone_matches_requested=%t\n", view.ActorID, normalizeErr == nil && normalizedPhone == view.PhoneE164)
		return
	}
	fmt.Printf("canonical initial operator reused actor_id=%s\n", view.ActorID)
}
