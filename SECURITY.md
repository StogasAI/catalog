# Security Policy

Report vulnerabilities through GitHub private vulnerability reporting. Do not disclose security
issues in public issues.

Catalog releases are data, never executable configuration. The gateway verifies the release
signature, content digest, monotonically increasing sequence, bounded response size, and semantic
invariants before atomic activation. Network endpoint hosts, credentials, authentication, and
request transformations are deliberately outside this repository.
