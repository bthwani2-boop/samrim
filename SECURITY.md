# Security Policy

DOCUMENT_CLASS: SECURITY_REPORTING_AND_SECRET_HANDLING_GUIDANCE
EXECUTION_AUTHORITY: NONE
PRODUCT_AUTHORITY: NONE

## Authority boundary

This file owns vulnerability-reporting and repository secret-handling guidance only. Durable application/security engineering requirements are owned by `governance/policies/security.md`; current implementation/security state is proven from executable source, configuration, runtime and evidence.

## Reporting a vulnerability

Do not report security vulnerabilities, credentials, tokens, private keys, personal data, or exploit details in public issues or pull requests.

Use GitHub Private Vulnerability Reporting for this repository. The repository owner will triage the report and coordinate remediation before public disclosure when appropriate.

## Secrets

Repository history must not contain secret values. Mobile signing material, Firebase service configuration, provider credentials, tokens, private keys and machine-local environment values are maintained outside Git.
