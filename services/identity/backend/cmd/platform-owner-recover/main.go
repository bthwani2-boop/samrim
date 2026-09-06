package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	_ "github.com/lib/pq"
)

func main() {
	var (
		databaseURL = flag.String("database-url", "", "PostgreSQL database URL (defaults to IDENTITY_DATABASE_URL)")
		phone       = flag.String("phone", "", "New verified phone number in E.164 format (optional)")
		password    = flag.String("password", "", "New high-entropy password (at least 15 characters)")
	)
	flag.Parse()

	dbURL := strings.TrimSpace(*databaseURL)
	if dbURL == "" {
		dbURL = strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	}
	if dbURL == "" {
		log.Fatal("database URL is required via -database-url flag or IDENTITY_DATABASE_URL environment variable")
	}

	pwd := strings.TrimSpace(*password)
	if pwd == "" {
		pwd = strings.TrimSpace(os.Getenv("IDENTITY_RECOVERY_PASSWORD"))
	}
	if len(pwd) < 15 {
		log.Fatal("password must be at least 15 characters long")
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer func() { _ = db.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("connect to database: %v", err)
	}

	actors := actor.New(db)
	actorID, err := actors.RecoverPlatformOwner(ctx, strings.TrimSpace(*phone), pwd)
	if err != nil {
		log.Fatalf("platform owner recovery failed: %v", err)
	}

	fmt.Println("==================================================")
	fmt.Println("PLATFORM OWNER EMERGENCY RECOVERY SUCCESSFUL")
	fmt.Printf("Actor ID: %s\n", actorID)
	if strings.TrimSpace(*phone) != "" {
		fmt.Printf("Phone updated to: %s\n", strings.TrimSpace(*phone))
	}
	fmt.Println("All previous sessions and pending challenges have been revoked.")
	fmt.Println("Log into Control Panel immediately to complete MFA and verify state.")
	fmt.Println("==================================================")
}
