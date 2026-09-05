package main

import (
	"log"
	"os"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityboundary"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/managedaccess"
	serviceruntime "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/runtime"
)

func main() {
	identityBaseURL := strings.TrimSpace(os.Getenv("DSH_IDENTITY_API_BASE_URL"))
	if identityBaseURL == "" {
		identityBaseURL = "http://identity:8082"
	}
	identityClient, err := identityboundary.New(identityBaseURL, os.Getenv("IDENTITY_DSH_SERVICE_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	managedAccess, err := managedaccess.New(identityClient, os.Getenv("DSH_PLATFORM_CONTROL_SERVICE_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	if err := serviceruntime.RunWithRoutes("dsh", "/dsh", "58080", managedAccess.Register); err != nil {
		log.Fatal(err)
	}
}
