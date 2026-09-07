package main

import (
	"log"
	"os"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityboundary"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/managedaccess"
	serviceruntime "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/runtime"
)

func main() {
	identityBaseURL, err := identityboundary.ResolveBaseURL(os.Getenv("DSH_IDENTITY_API_BASE_URL"), os.Getenv("BTHWANI_ENV"))
	if err != nil {
		log.Fatal(err)
	}
	identityClient, err := identityboundary.New(identityBaseURL, os.Getenv("IDENTITY_DSH_SERVICE_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	managedAccess, err := managedaccess.New(identityClient, os.Getenv("DSH_PLATFORM_CONTROL_SERVICE_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	if err := serviceruntime.RunWithRoutesAndReadiness("dsh", "/dsh", "58080", managedAccess.Register, managedAccess.Ready); err != nil {
		log.Fatal(err)
	}
}
