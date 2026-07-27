# Stogas Catalog

The signed fact catalog used by the Stogas gateway and public model directory.

The graph has five node types: author, model, provider, route, and deployment. Aliases are
deployment pointers, not nodes. The compiler emits a flattened runtime bundle and an
evidence-bearing public bundle. Provider request conversion, credentials, endpoint hosts, and
executable routing behavior remain in the gateway.

Deployments keep provider selection literal under a closed `upstream` block. The compiler permits
only provider selectors already implemented by the gateway; it never accepts arbitrary request
patches or treats provider labels such as fast, priority, and turbo as one abstraction. Reasoning
lists are admission facts, while Bifrost owns provider wire conversion.

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run editor
```

Generated runtime and public JSON are committed so catalog changes remain reviewable.

Fixed aliases cannot be removed or retargeted. A release is one monotonically increasing sequence,
the runtime and public SHA-256 values, and one Ed25519 authorization signature. The release command
checks and builds the committed source, publishes immutable content-addressed artifacts and a
GitHub release, then conditionally advances `latest.json` in R2. Public verification keys are
committed under `keys/`; private release and R2 credentials remain outside GitHub Actions.
