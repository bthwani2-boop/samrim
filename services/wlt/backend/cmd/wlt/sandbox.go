package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/wallet"
)

func runSandboxFunding(ctx context.Context, command string, args []string, input io.Reader, output io.Writer, getenv func(string) string) error {
	dsn := getenv("WLT_SANDBOX_DATABASE_URL")
	if getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" || !isolatedDatabaseURL(dsn, "bthwani_wlt_sandbox") {
		return errors.New("sandbox funding requires the dedicated isolated loopback database role")
	}
	var amount int64
	switch command {
	case "post-sandbox-funding":
		if len(args) != 2 {
			return errors.New("usage: wlt post-sandbox-funding <reference> <whole-yemeni-riyals>; provide the session token on stdin")
		}
		value, err := strconv.ParseInt(args[1], 10, 64)
		if err != nil || value < 1 || strconv.FormatInt(value, 10) != args[1] {
			return errors.New("sandbox funding amount must be positive whole YER")
		}
		amount = value
	case "reverse-sandbox-funding":
		if len(args) != 1 {
			return errors.New("usage: wlt reverse-sandbox-funding <original-reference>; provide the session token on stdin")
		}
	default:
		return errors.New("unknown WLT command")
	}
	raw, err := io.ReadAll(io.LimitReader(input, 46))
	if err != nil || len(raw) > 45 {
		return errors.New("invalid sandbox session input")
	}
	token := strings.TrimSuffix(strings.TrimSuffix(string(raw), "\n"), "\r")
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return errors.New("sandbox database connection rejected")
	}
	defer db.Close()
	origin := getenv("WLT_TEST_IDENTITY_ORIGIN")
	var state string
	if command == "reverse-sandbox-funding" {
		state, err = wallet.ReverseSandboxFunding(ctx, db, origin, token, args[0])
	} else {
		state, err = wallet.PostSandboxFunding(ctx, db, origin, token, args[0], amount)
	}
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(output, state)
	return err
}
