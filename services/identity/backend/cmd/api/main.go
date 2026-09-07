package main

import (
	"log"

	serviceruntime "github.com/bthwani2-boop/samrim/services/identity/backend/internal/runtime"
)

func main() {
	if err := serviceruntime.Run("identity", "/identity", "18082"); err != nil {
		log.Fatal(err)
	}
}
