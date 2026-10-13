# Stogas Catalog

The signed catalog of models, providers, deployments, prices, and data-handling facts used by the Stogas gateway and public model directory.

[Field reference](https://stogas.ai/docs/policies/routing-fields) · [Security](SECURITY.md)

## Repository

- `source/`: reviewable catalog records, CUE schema, and build scripts
- `generated/`: committed runtime, public, and archive bundles, so every change stays reviewable
- `editor/`: the local catalog editor

The catalog has six record types: author, group, model, provider, route, and deployment. The compiler resolves inheritance and emits flattened bundles. Request conversion, credentials, and routing stay in the gateway. Prices are decimal USD strings; `retentionDays: null` means unknown, not zero.

## Develop

```sh
bun install --frozen-lockfile
bun run check
bun run editor
```

## Releases

Each release has an increasing sequence number and a manifest with the source commit, a source digest, and each artifact's hash and size. The source digest is the SHA-256 of the canonical JSON list of every committed file's path, executable mode (493 or 420) and SHA-256, sorted by path. GitHub attests the manifest and artifacts. Stogas rebuilds the same bytes from its own copy of the source, then approves the manifest in its signed evidence. Gateways load only approved catalogs.

## License

[Apache-2.0](LICENSE).
