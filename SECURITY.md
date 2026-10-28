# Security Policy

Report vulnerabilities through GitHub private vulnerability reporting. Do not disclose security
issues in public issues.

Catalog releases are data, never executable configuration. The gateway loads only releases that
Stogas's signed evidence approves, and verifies their content digest, monotonically increasing
sequence, bounded response size, and semantic invariants before atomic activation. A route may
describe its endpoint, but the catalog cannot configure network hosts, credentials,
authentication, or request transformations, which the gateway's own code sets.
