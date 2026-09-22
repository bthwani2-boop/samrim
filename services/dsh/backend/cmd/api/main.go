package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	financialhandoff "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/financialhandoff"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	serviceruntime "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/runtime"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/serviceability"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storepublication"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
)

func main() {
	identityEndpoint, err := identityintegration.ResolveBaseURL(os.Getenv("DSH_IDENTITY_API_BASE_URL"), os.Getenv("BTHWANI_ENV"), os.Getenv("DSH_IDENTITY_API_ALLOWED_HOSTS"))
	if err != nil {
		log.Fatal(err)
	}
	identityClient, err := identityintegration.New(identityEndpoint, os.Getenv("IDENTITY_DSH_SERVICE_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	paymentClient, err := wlt.New(os.Getenv("DSH_WLT_API_BASE_URL"), os.Getenv("BTHWANI_ENV"), os.Getenv("WLT_DSH_SERVICE_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	mediaStore, _, err := media.NewFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	mediaContext, mediaCancel := context.WithTimeout(context.Background(), 15*time.Second)
	if err := mediaStore.EnsureBucket(mediaContext); err != nil {
		mediaCancel()
		log.Fatal(err)
	}
	mediaCancel()
	database, err := postgres.Open(os.Getenv("DSH_DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	financialHandoff, err := financialhandoff.New(database, paymentClient)
	if err != nil {
		log.Fatal(err)
	}
	records, err := loadMigrations()
	if err != nil {
		log.Fatal(err)
	}
	storePublication, err := storepublication.New(identityClient, database, paymentClient)
	if err != nil {
		log.Fatal(err)
	}
	joiningCaseServer, err := transporthttp.NewJoiningCase(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), database, storePublication, paymentClient)
	if err != nil {
		log.Fatal(err)
	}
	catalogServer, err := transporthttp.NewCatalogWithMediaStore(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), database, mediaStore)
	if err != nil {
		log.Fatal(err)
	}
	cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
	if err := catalogServer.ReconcileMediaStorage(cleanupContext); err != nil {
		log.Printf("catalog media reconciliation deferred: %v", err)
	}
	cleanupCancel()
	storePublicationServer, err := transporthttp.NewStorePublication(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), database, paymentClient)
	if err != nil {
		log.Fatal(err)
	}
	locationCoreServer, err := transporthttp.NewLocationCore(identityClient, database)
	if err != nil {
		log.Fatal(err)
	}
	serviceCityServer, err := transporthttp.NewServiceCity(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), database)
	if err != nil {
		log.Fatal(err)
	}
	serviceabilityService, err := serviceability.New(identityClient, database)
	if err != nil {
		log.Fatal(err)
	}
	serviceabilityServer, err := transporthttp.NewServiceabilityWithService(serviceabilityService)
	if err != nil {
		log.Fatal(err)
	}
	deliveryFeeServer, err := transporthttp.NewDeliveryFee(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), paymentClient)
	if err != nil {
		log.Fatal(err)
	}
	partnerFinanceServer, err := transporthttp.NewPartnerFinance(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), paymentClient)
	if err != nil {
		log.Fatal(err)
	}
	fieldFinanceServer, err := transporthttp.NewFieldFinance(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), paymentClient)
	if err != nil {
		log.Fatal(err)
	}
	beneficiaryFinanceServer, err := transporthttp.NewBeneficiaryFinance(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), paymentClient)
	if err != nil {
		log.Fatal(err)
	}
	cartServer, err := transporthttp.NewCart(identityClient, database, serviceabilityService, paymentClient)
	if err != nil {
		log.Fatal(err)
	}
	orderServer, err := transporthttp.NewOrder(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), database, paymentClient)
	if err != nil {
		log.Fatal(err)
	}
	multiStoreCheckoutServer, err := transporthttp.NewMultiStoreCheckout(identityClient, database, cartServer.Service(), orderServer.Service())
	if err != nil {
		log.Fatal(err)
	}
	captainServer, err := transporthttp.NewCaptain(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), database, paymentClient)
	if err != nil {
		log.Fatal(err)
	}
	notificationServer, err := transporthttp.NewNotification(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), database)
	if err != nil {
		log.Fatal(err)
	}
	fieldServer, err := transporthttp.NewField(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), database, mediaStore)
	if err != nil {
		log.Fatal(err)
	}
	clientFavoritesServer, err := transporthttp.NewClientFavorites(identityClient, database)
	if err != nil {
		log.Fatal(err)
	}
	marketingServer, err := transporthttp.NewMarketingWithDependencies(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), database, mediaStore)
	if err != nil {
		log.Fatal(err)
	}
	register := func(mux *http.ServeMux) {
		joiningCaseServer.Register(mux)
		catalogServer.Register(mux)
		storePublicationServer.Register(mux)
		locationCoreServer.Register(mux)
		serviceCityServer.Register(mux)
		serviceabilityServer.Register(mux)
		deliveryFeeServer.Register(mux)
		partnerFinanceServer.Register(mux)
		fieldFinanceServer.Register(mux)
		beneficiaryFinanceServer.Register(mux)
		cartServer.Register(mux)
		orderServer.Register(mux)
		multiStoreCheckoutServer.Register(mux)
		captainServer.Register(mux)
		notificationServer.Register(mux)
		fieldServer.Register(mux)
		clientFavoritesServer.Register(mux)
		marketingServer.Register(mux)
	}
	readiness := func(ctx context.Context) error {
		if err := postgres.VerifySchema(ctx, database, records); err != nil {
			return err
		}
		return nil
	}
	if err := serviceruntime.RunWithRoutesAndReadinessAndWorker("dsh", "/dsh", "18080", register, readiness, func(ctx context.Context) {
		go runFinancialProfileReconciliationLoop(ctx, time.Minute, joiningCaseServer.ReconcileFinancialProfiles)
		go runFieldCommissionReconciliationLoop(ctx, time.Minute, storePublication.ReconcileFieldCommissions)
		go runFinancialHandoffReconciliationLoop(ctx, 5*time.Second, financialHandoff.Reconcile)
		runMediaReconciliationLoop(ctx, time.Minute, catalogServer.ReconcileMediaStorage)
	}); err != nil {
		log.Fatal(err)
	}
}

func loadMigrations() ([]postgres.MigrationRecord, error) {
	directory := strings.TrimSpace(os.Getenv("DSH_MIGRATION_DIR"))
	if directory == "" {
		directory = filepath.Clean("../database/migrations")
		if _, err := os.Stat(directory); err != nil {
			directory = "/app/migrations"
		}
	}
	records, _, err := postgres.LoadMigrations(directory)
	return records, err
}
