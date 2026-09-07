package main

import (
	"bufio"
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
	"golang.org/x/term"
)

func main() {
	var (
		phone = flag.String("phone", "", "New verified phone number in E.164 format (optional)")
	)
	flag.Parse()

	dbURL := strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	if dbURL == "" {
		log.Fatal("database URL is required via IDENTITY_DATABASE_URL environment variable")
	}

	pwd := strings.TrimSpace(os.Getenv("IDENTITY_RECOVERY_PASSWORD"))
	if pwd == "" {
		if term.IsTerminal(int(os.Stdin.Fd())) {
			fmt.Fprint(os.Stderr, "Enter new platform owner recovery password: ")
			bytePassword, err := term.ReadPassword(int(os.Stdin.Fd()))
			fmt.Fprintln(os.Stderr)
			if err != nil {
				log.Fatalf("read password: %v", err)
			}
			pwd = strings.TrimSpace(string(bytePassword))
		} else {
			reader := bufio.NewReader(os.Stdin)
			line, err := reader.ReadString('\n')
			if err != nil && line == "" {
				log.Fatalf("read password from stdin: %v", err)
			}
			pwd = strings.TrimSpace(line)
		}
	}
	if pwd == "" {
		log.Fatal("password is required via interactive prompt, IDENTITY_RECOVERY_PASSWORD, or stdin")
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
