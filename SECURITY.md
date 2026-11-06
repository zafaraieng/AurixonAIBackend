# Security Policy

## Reporting a vulnerability

Please do not disclose security vulnerabilities in public issues. Report them privately to the repository maintainers through GitHub's private vulnerability reporting feature, if enabled, or another private channel agreed with the maintainers. Include the affected component, impact, reproduction steps, and relevant logs with secrets removed.

Do not access, modify, or exfiltrate data that is not yours while validating a report.

## Secrets and credentials

- Never commit API keys, OAuth client secrets, access or refresh tokens, database credentials, session secrets, private keys, or personal data.
- Load secrets from environment variables or a managed secret store. Keep local environment files out of version control.
- If a secret is exposed, revoke or rotate it immediately. Removing it from the current file is not sufficient; assess repository history, forks, caches, CI logs, and deployed systems.
- Use least-privilege credentials and separate development, staging, and production credentials.
- Do not include credentials, authorization headers, cookies, OAuth codes, or token-bearing query parameters in logs.

## Authentication and session handling

- Verify signed tokens cryptographically, including issuer, audience, expiry, and permitted algorithms; never treat a user identifier alone as a bearer credential.
- Sign and protect session cookies, use secure cookie attributes in production, and rotate session identifiers after authentication or privilege changes.
- Validate OAuth state on callbacks and use established OAuth libraries and flows.
- Encrypt sensitive provider tokens at rest, restrict access to them, and support revocation and deletion.
- Apply authorization checks on every resource access and rate-limit authentication and sensitive endpoints.

## Secure development and releases

- Review dependency and vulnerability alerts regularly.
- Add automated tests for authentication, authorization, OAuth callbacks, input validation, and secret redaction.
- Review changes for accidental secrets and sensitive logging before merging.
- Keep production error responses free of stack traces and internal configuration.
- Document security-relevant configuration without including live secret values.

## Scope

This policy applies to this repository and its maintained deployments. It does not guarantee that every deployment has been independently assessed or certified as secure.
