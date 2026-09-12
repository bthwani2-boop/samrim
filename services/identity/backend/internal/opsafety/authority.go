package opsafety

import (
	"fmt"
	"net/url"
	"strings"
)

const (
	expectedDatabaseHostEnv = "BTHWANI_EXPECTED_DATABASE_HOST"
	expectedDatabasePortEnv = "BTHWANI_EXPECTED_DATABASE_PORT"
	expectedDatabaseNameEnv = "BTHWANI_EXPECTED_DATABASE_NAME"
	expectedDatabaseUserEnv = "BTHWANI_EXPECTED_DATABASE_USER"
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
		return "", fmt.Errorf("%s is blocked in %s from ordinary service CLI; a controlled deployment or break-glass authority is required", operation, environment)
	default:
		return "", fmt.Errorf("BTHWANI_ENV must be development, test, staging, or production")
	}
}

func ParseDatabaseTarget(raw string) (DatabaseTarget, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.Hostname() == "" {
		return DatabaseTarget{}, fmt.Errorf("database URL must be a valid postgres target")
	}
	if parsed.User == nil || strings.TrimSpace(parsed.User.Username()) == "" {
		return DatabaseTarget{}, fmt.Errorf("database URL must include a named database principal")
	}
	name := strings.Trim(strings.TrimSpace(parsed.Path), "/")
	if name == "" {
		return DatabaseTarget{}, fmt.Errorf("database URL must include an explicit database name")
	}
	port := strings.TrimSpace(parsed.Port())
	if port == "" {
		port = "5432"
	}
	return DatabaseTarget{
		Host: strings.ToLower(strings.TrimSpace(parsed.Hostname())),
		Port: port,
		Name: name,
		User: strings.TrimSpace(parsed.User.Username()),
	}, nil
}

func RequireExpectedDatabaseTarget(raw string, getenv func(string) string) (DatabaseTarget, error) {
	target, err := ParseDatabaseTarget(raw)
	if err != nil {
		return DatabaseTarget{}, err
	}
	expected := DatabaseTarget{
		Host: strings.ToLower(strings.TrimSpace(getenv(expectedDatabaseHostEnv))),
		Port: strings.TrimSpace(getenv(expectedDatabasePortEnv)),
		Name: strings.TrimSpace(getenv(expectedDatabaseNameEnv)),
		User: strings.TrimSpace(getenv(expectedDatabaseUserEnv)),
	}
	if expected.Host == "" || expected.Port == "" || expected.Name == "" || expected.User == "" {
		return DatabaseTarget{}, fmt.Errorf(
			"explicit database target identity is required via %s, %s, %s and %s",
			expectedDatabaseHostEnv,
			expectedDatabasePortEnv,
			expectedDatabaseNameEnv,
			expectedDatabaseUserEnv,
		)
	}
	if target != expected {
		return DatabaseTarget{}, fmt.Errorf(
			"database target identity mismatch: observed host=%s port=%s database=%s user=%s; expected host=%s port=%s database=%s user=%s",
			target.Host, target.Port, target.Name, target.User,
			expected.Host, expected.Port, expected.Name, expected.User,
		)
	}
	return target, nil
}
