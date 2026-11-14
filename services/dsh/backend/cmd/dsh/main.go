package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/discovery"
)

func main() {
	mode := flag.String("mode", "serve", "serve, migrate, or isolated-seed")
	migrations := flag.String("migration", "database/migrations/001_public_discovery.sql", "explicit reviewed SQL migration path")
	flag.Parse()
	schema := os.Getenv("DSH_DB_SCHEMA")
	if schema == "" {
		schema = "dsh"
	}
	db, err := discovery.OpenFromEnvironment()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(12)
	db.SetConnMaxLifetime(5 * time.Minute)
	owner, err := discovery.New(db, schema)
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		log.Fatal("DSH owner DB unavailable")
	}
	switch *mode {
	case "migrate":
		if !strings.HasPrefix(schema, "dsh_test_") {
			log.Fatal("migration denied: choose a verified isolated dsh_test_* schema for this development slice")
		}
		data, err := os.ReadFile(*migrations)
		if err != nil {
			log.Fatal(err)
		}
		if err = owner.Migrate(ctx, data); err != nil {
			log.Fatal(err)
		}
		fmt.Println("DSH_PUBLIC_MIGRATION_PASS schema=" + schema)
	case "isolated-seed":
		if err := owner.ImportSynthetic(ctx); err != nil {
			log.Fatal(err)
		}
		fmt.Println("DSH_ISOLATED_OWNER_IMPORT_PASS schema=" + schema)
	case "serve":
		origins := map[string]bool{}
		for _, origin := range strings.Split(os.Getenv("DSH_PUBLIC_CORS_ORIGINS"), ",") {
			if v := strings.TrimSpace(origin); v != "" {
				origins[v] = true
			}
		}
		addr := os.Getenv("DSH_LISTEN_ADDR")
		if addr == "" {
			addr = ":8080"
		}
		server := &http.Server{
			Addr:              addr,
			Handler:           &discovery.Server{Owner: owner, AllowedOrigins: origins},
			ReadHeaderTimeout: 5 * time.Second,
			IdleTimeout:       30 * time.Second,
		}
		log.Printf("DSH public discovery listening on %s (schema %s)", addr, schema)
		log.Fatal(server.ListenAndServe())
	default:
		log.Fatal("unsupported mode")
	}
}
