package main

import (
	"log"

	serviceruntime "github.com/bthwani2-boop/samrim/services/workforce/backend/internal/runtime"
)

func main() {
	if err := serviceruntime.Run("workforce", "/workforce", "18086"); err != nil {
		log.Fatal(err)
	}
}
