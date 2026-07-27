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

Fixed aliases cannot be removed or retargeted. Releases have a monotonically increasing sequence,
30-day metadata validity, content-addressed bundles, an Ed25519-signed manifest, and GitHub build
provenance. GitHub Actions creates an attested unsigned draft. The Stogas release command then
independently rebuilds and compares the bytes before signing and conditionally advancing the R2
channel. Public verification keys are committed under `keys/`; private release and R2 credentials
remain outside GitHub Actions.
