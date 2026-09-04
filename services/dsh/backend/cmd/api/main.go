package main

import (
	"log"

	serviceruntime "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/runtime"
)

func main() {
	if err := serviceruntime.Run("dsh", "/dsh", "58080"); err != nil {
		log.Fatal(err)
	}
}
