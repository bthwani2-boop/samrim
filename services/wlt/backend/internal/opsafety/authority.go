package opsafety

import (
	"fmt"
	"net/url"
	"strings"
)

type DatabaseTarget struct {
	Host string
	Port string
	Name string
	User string
}

func RequireOrdinaryCLIEnvironment(rawEnvironment, operation string) (string, error) {
	environment := strings.ToLower(strings.TrimSpace(rawEnvironment))
	switch environment {
	case "development", "test":
		return environment, nil
	case "staging", "production":
		return "", fmt.Errorf("%s is blocked in %s from ordinary service CLI", operation, environment)
	default:
		return "", fmt.Errorf("BTHWANI_ENV must be development, test, staging, or production")
	}
}

func RequireExpectedDatabaseTarget(raw string, getenv func(string) string) (DatabaseTarget, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.Hostname() == "" || parsed.User == nil || strings.TrimSpace(parsed.User.Username()) == "" || strings.Trim(strings.TrimSpace(parsed.Path), "/") == "" {
		return DatabaseTarget{}, fmt.Errorf("database URL must be a valid explicit postgres target")
	}
	port := parsed.Port()
	if port == "" {
		port = "5432"
	}
	target := DatabaseTarget{Host: strings.ToLower(parsed.Hostname()), Port: port, Name: strings.Trim(parsed.Path, "/"), User: parsed.User.Username()}
	expected := DatabaseTarget{Host: strings.ToLower(strings.TrimSpace(getenv("BTHWANI_EXPECTED_DATABASE_HOST"))), Port: strings.TrimSpace(getenv("BTHWANI_EXPECTED_DATABASE_PORT")), Name: strings.TrimSpace(getenv("BTHWANI_EXPECTED_DATABASE_NAME")), User: strings.TrimSpace(getenv("BTHWANI_EXPECTED_DATABASE_USER"))}
	if expected.Host == "" || expected.Port == "" || expected.Name == "" || expected.User == "" || target != expected {
		return DatabaseTarget{}, fmt.Errorf("database target identity mismatch")
	}
	return target, nil
}
