# Stogas Catalog

The signed fact catalog used by the Stogas gateway and public model directory.

The graph has five node types: author, model, provider, route, and deployment. Aliases are
deployment pointers, not nodes. The compiler emits a flattened runtime bundle and an
evidence-bearing public bundle. Provider request conversion, credentials, endpoint hosts, and
executable routing behavior remain in the gateway.

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run editor
```

Generated runtime and public JSON are committed so catalog changes remain reviewable.

Fixed aliases cannot be removed or retargeted. Releases have a monotonically increasing sequence,
content-addressed bundles, an Ed25519-signed manifest, and GitHub build provenance.
