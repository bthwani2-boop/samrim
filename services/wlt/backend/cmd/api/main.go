package main

import (
	"log"

	serviceruntime "github.com/bthwani2-boop/samrim/services/wlt/backend/internal/runtime"
)

func main() {
	if err := serviceruntime.Run("wlt", "/wlt", "18083"); err != nil {
		log.Fatal(err)
	}
}
