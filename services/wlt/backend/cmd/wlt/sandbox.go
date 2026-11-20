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

func runSandboxFunding(ctx context.Context, args []string, input io.Reader, output io.Writer, getenv func(string) string) error {
	dsn := getenv("WLT_SANDBOX_DATABASE_URL")
	if getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" || !isolatedDatabaseURL(dsn, "bthwani_wlt_sandbox") {
		return errors.New("sandbox funding requires the dedicated isolated loopback database role")
	}
	if len(args) != 2 {
		return errors.New("usage: wlt post-sandbox-funding <reference> <whole-yemeni-riyals>; provide the session token on stdin")
	}
	amount, err := strconv.ParseInt(args[1], 10, 64)
	if err != nil || amount < 1 || strconv.FormatInt(amount, 10) != args[1] {
		return errors.New("sandbox funding amount must be positive whole YER")
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
	state, err := wallet.PostSandboxFunding(ctx, db, getenv("WLT_TEST_IDENTITY_ORIGIN"), token, args[0], amount)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(output, state)
	return err
}
