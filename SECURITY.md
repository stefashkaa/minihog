# Security policy

Report vulnerabilities privately to [hello@stefanpopov.dev](mailto:hello@stefanpopov.dev). Include the affected package and version, a minimal reproduction, and the expected impact. Remove credentials, project tokens, and personal data from examples.

The latest minor version receives fixes. Do not disclose a vulnerability publicly before coordinating with the maintainers.

MiniHog handles browser telemetry and session recordings. Security reports should include consent bypasses, unintended collection of private content, proxy request forwarding, unsafe remote configuration handling, or dependency vulnerabilities.

The Nuxt proxy accepts only supported public ingestion routes. Runtime configuration must use public PostHog project tokens, never personal API keys. Applications remain responsible for consent requirements, masking displayed content, and reviewing console output before enabling console recording.
